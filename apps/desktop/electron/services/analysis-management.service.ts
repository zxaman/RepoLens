import { randomUUID } from 'node:crypto';
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

interface ActiveAnalysis {
  readonly analysisId: string;
  readonly projectId: string;
  readonly scanId: string;
  readonly worker: AnalysisWorkerSession;
}

export type AnalysisWorkerFactory = () => AnalysisWorkerSession;
export type AnalysisProgressSink = (progress: AnalysisProgress) => void;

/** Coordinates one ephemeral analysis worker; no source or analysis result is persisted. */
export class AnalysisManagementService {
  private activeAnalysis: ActiveAnalysis | null = null;
  private startingAnalysis = false;
  private startingProjectId: string | null = null;
  private readonly removingProjectIds = new Set<string>();

  constructor(
    private readonly projects: ProjectManagementService,
    private readonly scans: ScanManagementService,
    private readonly createWorker: AnalysisWorkerFactory = () =>
      new ElectronAnalysisWorkerSession(),
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

      try {
        worker = this.createWorker();
      } catch (error) {
        console.error(
          'RepoLens could not create the analysis worker.',
          safeErrorDetails(error, [project.rootPath]),
        );
        throw new ServiceError('INTERNAL_ERROR', 'RepoLens could not start the analysis worker.');
      }

      this.activeAnalysis = { analysisId, projectId, scanId, worker };
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
        return analysisResultSchema.parse(await worker.run(input, progressSink));
      } catch {
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
      return await removeRegistration();
    } finally {
      this.removingProjectIds.delete(projectId);
    }
  }
}
