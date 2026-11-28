import { randomUUID } from 'node:crypto';
import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import {
  buildProjectGraph,
  GraphBuildCancelledError,
  InMemoryGraphProvider,
  type GraphBuildLease,
} from '@repolens/core';
import {
  analysisResultSchema,
  graphBuildProgressSchema,
  type GraphBuildProgress,
} from '@repolens/shared';
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
  readonly graphCancellation: { aborted: boolean };
  graphBuilding: boolean;
}

export type AnalysisWorkerFactory = () => AnalysisWorkerSession;
export type AnalysisProgressSink = (progress: AnalysisProgress) => void;
export type GraphProgressSink = (progress: GraphBuildProgress) => void;

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
    private readonly graphProvider: InMemoryGraphProvider = new InMemoryGraphProvider(),
  ) {}

  async start(
    projectId: string,
    scanId: string,
    progressSink: AnalysisProgressSink,
    graphProgressSink: GraphProgressSink = () => undefined,
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
    let graphBuildLease: GraphBuildLease | null = null;
    let graphPublished = false;
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

      graphBuildLease = this.graphProvider.beginBuild(projectId, analysisId);

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
        graphCancellation: { aborted: false },
        graphBuilding: false,
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
        if (result.status === 'completed' || result.status === 'partial') {
          if (graphBuildLease === null) {
            throw new Error('The graph lifecycle lease was not initialized.');
          }
          const active = this.activeAnalysis;
          if (active === null || active.analysisId !== analysisId) {
            throw new Error('The graph build is no longer associated with the active analysis.');
          }
          active.graphBuilding = true;
          try {
            const graph = await buildProjectGraph(result, {
              signal: active.graphCancellation,
              onProgress: graphProgressSink,
              yieldToEventLoop: () => yieldToEventLoop(),
            });
            graphPublished = this.graphProvider.publish(graphBuildLease, graph);
          } catch (error) {
            if (!(error instanceof GraphBuildCancelledError)) {
              throw error;
            }
            this.graphProvider.fail(graphBuildLease);
            const cancelledProgress = graphBuildProgressSchema.parse({
              analysisId,
              scanId,
              projectId,
              phase: 'cancelled',
              processed: 0,
              total: 0,
              percentage: 0,
            });
            try {
              graphProgressSink(cancelledProgress);
            } catch {
              // A progress observer cannot interfere with graph cleanup.
            }
            return result;
          } finally {
            active.graphBuilding = false;
          }
        }
        return result;
      } catch (error) {
        if (graphBuildLease !== null) {
          this.graphProvider.fail(graphBuildLease);
        }
        console.error(
          'RepoLens could not finalize static analysis and its graph.',
          safeErrorDetails(error, [project.rootPath]),
        );
        throw new ServiceError(
          'INTERNAL_ERROR',
          'RepoLens could not complete static analysis. Run a new scan and try again.',
        );
      }
    } finally {
      if (graphBuildLease !== null && !graphPublished) {
        this.graphProvider.fail(graphBuildLease);
      }
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
    if (active === null || active.analysisId !== analysisId) {
      throw new ServiceError('ANALYSIS_NOT_RUNNING', 'That static analysis is no longer running.');
    }
    if (active.graphBuilding) {
      if (active.graphCancellation.aborted) {
        throw new ServiceError('ANALYSIS_NOT_RUNNING', 'That graph build is already cancelling.');
      }
      active.graphCancellation.aborted = true;
      return { cancelled: true };
    }
    if (active.worker.finished) {
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
      this.graphProvider.disposeProject(projectId);
      return result;
    } catch (error) {
      try {
        if ((await this.projects.getById(projectId)) === null) {
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
