import { randomUUID } from 'node:crypto';
import {
  scanConfigSchema,
  scanHistoryItemSchema,
  scanResultSchema,
  type ScanConfig,
  type ScanError,
  type ScanHistoryItem,
  type ScanProgress,
  type ScanResult,
  type ScanWarning,
} from '@repolens/shared';
import type { ProjectManagementService } from './project-management.service.js';
import { safeErrorDetails } from './diagnostic-logging.js';
import { ServiceError } from './service-error.js';
import type { ScanHistoryRepository } from './scan-history-repository.js';
import {
  ElectronScanWorkerSession,
  type ScanWorkerSession,
  type WorkerScanInput,
} from './scan-worker-session.js';

const MAX_IN_MEMORY_SCAN_RESULTS = 50;

interface ActiveScan {
  readonly scanId: string;
  readonly projectId: string;
  readonly worker: ScanWorkerSession;
}

export type ScanWorkerFactory = () => ScanWorkerSession;
export type ScanProgressSink = (progress: ScanProgress) => void;

export class ScanManagementService {
  private activeScan: ActiveScan | null = null;
  private readonly latestResults = new Map<string, ScanResult>();
  private startingScan = false;
  private startingProjectId: string | null = null;
  private readonly removingProjectIds = new Set<string>();

  constructor(
    private readonly projects: ProjectManagementService,
    private readonly history: ScanHistoryRepository,
    private readonly createWorker: ScanWorkerFactory = () => new ElectronScanWorkerSession(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(
    projectId: string,
    config: ScanConfig | undefined,
    progressSink: ScanProgressSink,
  ): Promise<ScanResult> {
    if (this.startingScan || this.activeScan !== null || this.removingProjectIds.has(projectId)) {
      throw new ServiceError(
        'SCAN_ALREADY_RUNNING',
        'A scan or project operation is already running.',
      );
    }
    this.startingScan = true;
    this.startingProjectId = projectId;

    const scanId = randomUUID();
    const startedAt = this.now();
    let worker: ScanWorkerSession | null = null;
    try {
      const parsedConfig = scanConfigSchema.safeParse(config ?? {});
      if (!parsedConfig.success) {
        throw new ServiceError('INVALID_INPUT', 'The supplied scan options are invalid.');
      }

      const project = await this.projects.getById(projectId);
      if (project === null) {
        throw new ServiceError('PROJECT_NOT_FOUND', 'That project is no longer registered.');
      }
      if (project.status === 'unavailable') {
        const failedResult = await this.persistResult(
          createFailedScanResult(
            scanId,
            projectId,
            startedAt,
            this.now(),
            'The project folder is unavailable. Restore it before starting a scan.',
            'ROOT_UNAVAILABLE',
          ),
        );
        this.retainLatestResult(projectId, failedResult);
        return failedResult;
      }

      this.latestResults.delete(projectId);
      try {
        worker = this.createWorker();
      } catch (error) {
        console.error('RepoLens could not create the scan worker.', safeErrorDetails(error));
        const failedResult = await this.persistResult(
          createFailedScanResult(
            scanId,
            projectId,
            startedAt,
            this.now(),
            'RepoLens could not start the scanning worker.',
            'WORKER_FAILED',
          ),
        );
        this.retainLatestResult(projectId, failedResult);
        return failedResult;
      }

      this.activeScan = { scanId, projectId, worker };
      this.startingScan = false;
      this.startingProjectId = null;
      const input: WorkerScanInput = {
        scanId,
        projectId,
        rootPath: project.rootPath,
        config: parsedConfig.data,
      };
      const workerPromise = worker.run(input, progressSink);
      try {
        progressSink({
          scanId,
          projectId,
          phase: 'initializing',
          filesDiscovered: 0,
          filesProcessed: 0,
          directoriesProcessed: 0,
          totalBytesProcessed: 0,
        });
      } catch {
        // Observing progress must never interrupt the worker or history persistence.
      }

      let result: ScanResult;
      try {
        result = scanResultSchema.parse(await workerPromise);
      } catch {
        result = createFailedScanResult(
          scanId,
          projectId,
          startedAt,
          this.now(),
          'The scanning worker stopped before returning a scan result.',
          'WORKER_FAILED',
        );
      }
      const persistedResult = await this.persistResult(result);
      this.retainLatestResult(persistedResult.projectId, persistedResult);
      return persistedResult;
    } finally {
      if (this.activeScan?.scanId === scanId) {
        this.activeScan = null;
      }
      this.startingScan = false;
      this.startingProjectId = null;
      if (worker !== null) {
        await worker.terminate().catch(() => undefined);
      }
    }
  }

  getCurrentResult(projectId: string, scanId: string): ScanResult | null {
    const current = this.latestResults.get(projectId);
    if (current === undefined || current.id !== scanId) {
      return null;
    }
    this.latestResults.delete(projectId);
    this.latestResults.set(projectId, current);
    return current;
  }

  private retainLatestResult(projectId: string, result: ScanResult): void {
    this.latestResults.delete(projectId);
    this.latestResults.set(projectId, result);
    while (this.latestResults.size > MAX_IN_MEMORY_SCAN_RESULTS) {
      const oldestProjectId = this.latestResults.keys().next().value;
      if (oldestProjectId === undefined) {
        break;
      }
      this.latestResults.delete(oldestProjectId);
    }
  }

  async cancel(scanId: string): Promise<{ readonly cancelled: true }> {
    const active = this.activeScan;
    if (active === null || active.scanId !== scanId || active.worker.finished) {
      throw new ServiceError('SCAN_NOT_RUNNING', 'That scan is no longer running.');
    }
    active.worker.cancel();
    return { cancelled: true };
  }

  async removeProject<T>(projectId: string, removeRegistration: () => Promise<T>): Promise<T> {
    if (
      this.startingProjectId === projectId ||
      this.activeScan?.projectId === projectId ||
      this.removingProjectIds.has(projectId)
    ) {
      throw new ServiceError(
        'SCAN_ALREADY_RUNNING',
        'Cancel the project scan before removing this project.',
      );
    }

    this.removingProjectIds.add(projectId);
    try {
      // Keep scan history intact if the registration cannot be removed from the registry.
      const result = await removeRegistration();
      this.latestResults.delete(projectId);
      await this.history.removeProject(projectId);
      return result;
    } finally {
      this.removingProjectIds.delete(projectId);
    }
  }

  async getHistory(projectId: string): Promise<readonly ScanHistoryItem[]> {
    await this.assertProjectExists(projectId);
    return this.history.list(projectId);
  }

  async getLatest(projectId: string): Promise<ScanHistoryItem | null> {
    await this.assertProjectExists(projectId);
    return this.history.getLatest(projectId);
  }

  private async assertProjectExists(projectId: string): Promise<void> {
    if ((await this.projects.getById(projectId)) === null) {
      throw new ServiceError('PROJECT_NOT_FOUND', 'That project is no longer registered.');
    }
  }

  private async persistResult(result: ScanResult): Promise<ScanResult> {
    const historyItem = await this.persist(toHistoryItem(result));
    return scanResultSchema.parse({ ...result, warnings: historyItem.warnings });
  }

  private async persist(item: ScanHistoryItem): Promise<ScanHistoryItem> {
    try {
      return await this.history.append(item.projectId, item);
    } catch (error) {
      console.error('RepoLens could not save scan history.', safeErrorDetails(error));
      const warning: ScanWarning = {
        code: 'HISTORY_SAVE_FAILED',
        message: 'The scan finished, but RepoLens could not save it to scan history.',
      };
      return scanHistoryItemSchema.parse({ ...item, warnings: [...item.warnings, warning] });
    }
  }
}

function toHistoryItem(result: ScanResult): ScanHistoryItem {
  return scanHistoryItemSchema.parse({
    id: result.id,
    projectId: result.projectId,
    status: result.status,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    durationMs: result.durationMs,
    directoriesDiscovered: result.directoriesDiscovered,
    filesDiscovered: result.filesDiscovered,
    filesProcessed: result.filesProcessed,
    sourceFiles: result.sourceFiles,
    configurationFiles: result.configurationFiles,
    packageManifests: result.packageManifests,
    documentationFiles: result.documentationFiles,
    assetFiles: result.assetFiles,
    otherFiles: result.otherFiles,
    ignoredFiles: result.ignoredFiles,
    ignoredDirectories: result.ignoredDirectories,
    sensitiveEntriesExcluded: result.sensitiveEntriesExcluded,
    symlinksSkipped: result.symlinksSkipped,
    bytesHashed: result.bytesHashed,
    languages: result.languages,
    technologies: result.technologies,
    warnings: result.warnings,
    ...(result.errorSummary === undefined ? {} : { errorSummary: result.errorSummary }),
  });
}

function createFailedScanResult(
  scanId: string,
  projectId: string,
  startedAt: Date,
  completedAt: Date,
  errorSummary: string,
  errorCode: ScanError['code'],
): ScanResult {
  return scanResultSchema.parse({
    id: scanId,
    projectId,
    status: 'failed',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    directoriesDiscovered: 0,
    filesDiscovered: 0,
    filesProcessed: 0,
    sourceFiles: 0,
    configurationFiles: 0,
    packageManifests: 0,
    documentationFiles: 0,
    assetFiles: 0,
    otherFiles: 0,
    ignoredFiles: 0,
    ignoredDirectories: 0,
    sensitiveEntriesExcluded: 0,
    symlinksSkipped: 0,
    bytesHashed: 0,
    languages: [],
    technologies: [],
    warnings: [],
    errorSummary,
    files: [],
    errors: [{ code: errorCode, message: errorSummary }],
  });
}
