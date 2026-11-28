import { randomUUID } from 'node:crypto';
import { InMemoryGraphProvider } from '@repolens/core';
import { analysisResultSchema } from '@repolens/shared';
import type { AnalysisProgress, AnalysisResult } from '@repolens/shared';
import type { ProjectManagementService } from './project-management.service.js';
import { safeErrorDetails } from './diagnostic-logging.js';
import { ServiceError } from './service-error.js';
import type { ScanManagementService } from './scan-management.service.js';
import {
  ElectronAnalysisWorkerSession,
  type AnalysisWorkerSession,
  type WorkerAnalysisInput,
} from './analysis-worker-session.js';

const MAX_IN_MEMORY_ANALYSES = 50;

interface ActiveAnalysis {
  readonly analysisId: string;
  readonly projectId: string;
  readonly scanId: string;
  readonly worker: AnalysisWorkerSession;
}

export type AnalysisWorkerFactory = () => AnalysisWorkerSession;
export type AnalysisProgressSink = (progress: AnalysisProgress) => void;

/** Coordinates worker analysis and retains only the latest validated result per project in memory. */
export class AnalysisManagementService {
  private activeAnalysis: ActiveAnalysis | null = null;
  private startingAnalysis = false;
  private startingProjectId: string | null = null;
  private readonly removingProjectIds = new Set<string>();
  private readonly latestResults = new Map<string, AnalysisResult>();

  constructor(
    private readonly projects: ProjectManagementService,
    private readonly scans: ScanManagementService,
    private readonly createWorker: AnalysisWorkerFactory = () =>
      new ElectronAnalysisWorkerSession(),
    private readonly graphProvider: InMemoryGraphProvider = new InMemoryGraphProvider(),
  ) {}

  async start(
    projectId: string,
    scanId: string,
    progressSink: AnalysisProgressSink,
  ): Promise<AnalysisResult> {
    if (
      this.startingAnalysis ||
      this.activeAnalysis !== null ||
      this.removingProjectIds.has(projectId)
    ) {
      throw new ServiceError(
        'ANALYSIS_ALREADY_RUNNING',
        'A static-analysis or project operation is already running.',
      );
    }
    this.startingAnalysis = true;
    this.startingProjectId = projectId;

    let worker: AnalysisWorkerSession | null = null;
    const analysisId = randomUUID();
    try {
      const project = await this.projects.getById(projectId);
      if (project === null) {
        throw new ServiceError('PROJECT_NOT_FOUND', 'That project is no longer registered.');
      }
      if (project.status === 'unavailable') {
        throw new ServiceError(
          'PROJECT_UNAVAILABLE',
          'Restore the project folder before analyzing it.',
        );
      }

      const scan = this.scans.getCurrentResult(projectId, scanId);
      if (scan === null) {
        throw new ServiceError(
          'ANALYSIS_SCAN_UNAVAILABLE',
          'Run a new project scan before starting static analysis.',
        );
      }

      this.latestResults.delete(projectId);
      this.graphProvider.disposeProject(projectId);

      try {
        worker = this.createWorker();
      } catch (error) {
        console.error(
          'RepoLens could not create the analysis worker.',
          safeErrorDetails(error, [project.rootPath]),
        );
        throw new ServiceError('INTERNAL_ERROR', 'RepoLens could not start the analysis worker.');
      }

      this.activeAnalysis = {
        analysisId,
        projectId,
        scanId,
        worker,
      };
      this.startingAnalysis = false;
      this.startingProjectId = null;
      try {
        progressSink({
          analysisId,
          scanId,
          projectId,
          phase: 'initializing',
          filesTotal: 0,
          filesProcessed: 0,
        });
      } catch {
        // A progress observer cannot prevent worker startup.
      }
      const input: WorkerAnalysisInput = {
        analysisId,
        projectId,
        scanId,
        rootPath: project.rootPath,
        scan,
      };
      try {
        const result = analysisResultSchema.parse(await worker.run(input, progressSink));
        if (
          result.analysisId !== analysisId ||
          result.projectId !== projectId ||
          result.scanId !== scanId
        ) {
          throw new Error('The analysis worker returned results for a different operation.');
        }
        this.retainLatestResult(projectId, result);
        return result;
      } catch (error) {
        console.error(
          'RepoLens could not finalize static analysis.',
          safeErrorDetails(error, [project.rootPath]),
        );
        throw new ServiceError(
          'INTERNAL_ERROR',
          'RepoLens could not complete static analysis. Run a new scan and try again.',
        );
      }
    } finally {
      if (this.activeAnalysis?.analysisId === analysisId) {
        this.activeAnalysis = null;
      }
      this.startingAnalysis = false;
      this.startingProjectId = null;
      if (worker !== null) {
        await worker.terminate().catch(() => undefined);
      }
    }
  }

  getLatestResult(projectId: string): AnalysisResult | null {
    const result = this.latestResults.get(projectId);
    if (result === undefined) {
      return null;
    }
    const parsed = analysisResultSchema.safeParse(result);
    if (!parsed.success || parsed.data.projectId !== projectId) {
      this.latestResults.delete(projectId);
      return null;
    }
    this.latestResults.delete(projectId);
    this.latestResults.set(projectId, parsed.data);
    return parsed.data;
  }

  private retainLatestResult(projectId: string, result: AnalysisResult): void {
    this.latestResults.delete(projectId);
    this.latestResults.set(projectId, result);
    while (this.latestResults.size > MAX_IN_MEMORY_ANALYSES) {
      const oldestProjectId = this.latestResults.keys().next().value;
      if (oldestProjectId === undefined) {
        break;
      }
      this.latestResults.delete(oldestProjectId);
    }
  }

  getCurrentResult(projectId: string, scanId: string, analysisId: string): AnalysisResult | null {
    const result = this.getLatestResult(projectId);
    return result?.scanId === scanId && result.analysisId === analysisId ? result : null;
  }

  async cancel(analysisId: string): Promise<{ readonly cancelled: true }> {
    const active = this.activeAnalysis;
    if (active === null || active.analysisId !== analysisId || active.worker.finished) {
      throw new ServiceError('ANALYSIS_NOT_RUNNING', 'That static analysis is no longer running.');
    }
    active.worker.cancel();
    return { cancelled: true };
  }

  async removeProject<T>(projectId: string, removeRegistration: () => Promise<T>): Promise<T> {
    if (
      this.startingProjectId === projectId ||
      this.activeAnalysis?.projectId === projectId ||
      this.removingProjectIds.has(projectId)
    ) {
      throw new ServiceError(
        'ANALYSIS_ALREADY_RUNNING',
        'Cancel static analysis before removing this project.',
      );
    }

    this.removingProjectIds.add(projectId);
    try {
      const result = await removeRegistration();
      this.latestResults.delete(projectId);
      this.graphProvider.disposeProject(projectId);
      return result;
    } catch (error) {
      try {
        if ((await this.projects.getById(projectId)) === null) {
          this.latestResults.delete(projectId);
          this.graphProvider.disposeProject(projectId);
        }
      } catch {
        // Preserve the graph when registration status cannot be established safely.
      }
      throw error;
    } finally {
      this.removingProjectIds.delete(projectId);
    }
  }
}
