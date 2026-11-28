import {
  projectSchema,
  scanHistoryItemSchema,
  scanResultSchema,
  type ScanHistoryItem,
  type ScanProgress,
  type ScanResult,
} from '@repolens/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectManagementService } from './project-management.service.js';
import { ScanManagementService } from './scan-management.service.js';
import type { ScanHistoryRepository } from './scan-history-repository.js';
import type { ScanWorkerSession, WorkerScanInput } from './scan-worker-session.js';

const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const project = projectSchema.parse({
  id: projectId,
  name: 'fixture-project',
  rootPath: '/fixture/project',
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
  status: 'registered',
  repositoryType: 'local',
  repositoryIndicators: [],
});
const otherProjectId = 'b1b2c3d4-e5f6-47a8-9012-abcdef123456';
const otherProject = projectSchema.parse({
  ...project,
  id: otherProjectId,
  name: 'other-project',
  rootPath: '/fixture/other-project',
});

class InMemoryScanHistoryRepository implements ScanHistoryRepository {
  readonly items: ScanHistoryItem[] = [];

  async list(id: string): Promise<readonly ScanHistoryItem[]> {
    return this.items
      .filter((item) => item.projectId === id)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async getLatest(id: string): Promise<ScanHistoryItem | null> {
    return (await this.list(id))[0] ?? null;
  }

  async append(id: string, item: ScanHistoryItem): Promise<ScanHistoryItem> {
    const parsed = scanHistoryItemSchema.parse(item);
    if (parsed.projectId !== id) {
      throw new Error('Project ID did not match the history record.');
    }
    this.items.push(parsed);
    return parsed;
  }

  async removeProject(id: string): Promise<void> {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      if (this.items[index]?.projectId === id) {
        this.items.splice(index, 1);
      }
    }
  }
}

class ControlledScanWorker implements ScanWorkerSession {
  private input: WorkerScanInput | null = null;
  private resolveStarted: ((value: WorkerScanInput) => void) | null = null;
  private resolveResult: ((result: ScanResult) => void) | null = null;
  private done = false;
  readonly started = new Promise<WorkerScanInput>((resolveStarted) => {
    this.resolveStarted = resolveStarted;
  });
  readonly cancel = vi.fn(() => this.complete('cancelled'));
  readonly terminate = vi.fn(async () => undefined);
  readonly progress = vi.fn<(progress: ScanProgress) => void>();

  get finished(): boolean {
    return this.done;
  }

  run(input: WorkerScanInput, onProgress: (progress: ScanProgress) => void): Promise<ScanResult> {
    this.input = input;
    this.resolveStarted?.(input);
    this.progress.mockImplementation(onProgress);
    this.progress({
      scanId: input.scanId,
      projectId: input.projectId,
      phase: 'initializing',
      filesDiscovered: 0,
      filesProcessed: 0,
      directoriesProcessed: 0,
      totalBytesProcessed: 0,
    });
    return new Promise<ScanResult>((resolveResult) => {
      this.resolveResult = resolveResult;
    });
  }

  complete(status: ScanResult['status']): void {
    if (this.done || this.input === null || this.resolveResult === null) {
      return;
    }
    this.done = true;
    this.resolveResult(makeResult(this.input, status));
  }
}

function makeResult(input: WorkerScanInput, status: ScanResult['status']): ScanResult {
  return scanResultSchema.parse({
    id: input.scanId,
    projectId: input.projectId,
    status,
    startedAt: '2026-11-27T00:00:00.000Z',
    completedAt: '2026-11-27T00:00:01.000Z',
    durationMs: 1_000,
    directoriesDiscovered: 1,
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
    files: [],
    errors: [],
  });
}

describe('scan management service', () => {
  it('runs one worker at a time, forwards progress, cancels, and persists the completed history item', async () => {
    const projects = {
      getById: vi.fn(async (id: string) => (id === projectId ? project : null)),
    } as unknown as ProjectManagementService;
    const history = new InMemoryScanHistoryRepository();
    const worker = new ControlledScanWorker();
    const service = new ScanManagementService(
      projects,
      history,
      () => worker,
      () => new Date('2026-11-27T00:00:00.000Z'),
    );
    const progress = vi.fn();
    const startRequest = service.start(projectId, undefined, progress);
    const input = await worker.started;

    expect(input.config.includeSensitiveFiles).toBe(false);
    expect(progress).toHaveBeenCalledWith({
      scanId: input.scanId,
      projectId,
      phase: 'initializing',
      filesDiscovered: 0,
      filesProcessed: 0,
      directoriesProcessed: 0,
      totalBytesProcessed: 0,
    });
    await expect(service.start(projectId, undefined, vi.fn())).rejects.toMatchObject({
      code: 'SCAN_ALREADY_RUNNING',
    });
    const removeRegistration = vi.fn(async () => ({ removed: true as const }));
    await expect(service.removeProject(projectId, removeRegistration)).rejects.toMatchObject({
      code: 'SCAN_ALREADY_RUNNING',
    });
    expect(removeRegistration).not.toHaveBeenCalled();

    await expect(service.cancel(input.scanId)).resolves.toEqual({ cancelled: true });
    const result = await startRequest;
    expect(result).toMatchObject({ id: input.scanId, projectId, status: 'cancelled', files: [] });
    expect(service.getCurrentResult(projectId, input.scanId)).toEqual(result);
    expect(service.getCurrentResult(projectId, '00000000-0000-4000-8000-000000000000')).toBeNull();
    expect(worker.cancel).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    const historyItem = history.items[0];
    expect(historyItem).toMatchObject({ id: input.scanId, projectId, status: 'cancelled' });
    await expect(service.getHistory(projectId)).resolves.toEqual([historyItem]);
    await expect(service.getLatest(projectId)).resolves.toEqual(historyItem);
    await expect(service.cancel(input.scanId)).rejects.toMatchObject({ code: 'SCAN_NOT_RUNNING' });

    const failedRegistrationRemoval = vi.fn(async () => {
      throw new Error('The project registry could not be written.');
    });
    await expect(service.removeProject(projectId, failedRegistrationRemoval)).rejects.toThrow(
      'The project registry could not be written.',
    );
    expect(history.items).toEqual([historyItem]);
    expect(service.getCurrentResult(projectId, input.scanId)).toEqual(result);

    await expect(service.removeProject(projectId, removeRegistration)).resolves.toEqual({
      removed: true,
    });
    expect(removeRegistration).toHaveBeenCalledOnce();
    expect(service.getCurrentResult(projectId, input.scanId)).toBeNull();
    await expect(service.getHistory(projectId)).resolves.toEqual([]);
  });

  it('keeps each project latest scan inventory isolated and removes only the selected project result', async () => {
    const projects = {
      getById: vi.fn(async (id: string) =>
        id === projectId ? project : id === otherProjectId ? otherProject : null,
      ),
    } as unknown as ProjectManagementService;
    const history = new InMemoryScanHistoryRepository();
    const firstWorker = new ControlledScanWorker();
    const secondWorker = new ControlledScanWorker();
    const workers = [firstWorker, secondWorker];
    const service = new ScanManagementService(projects, history, () => {
      const worker = workers.shift();
      if (worker === undefined) {
        throw new Error('No scan worker was prepared for this test.');
      }
      return worker;
    });

    const firstRequest = service.start(projectId, undefined, vi.fn());
    const firstInput = await firstWorker.started;
    firstWorker.complete('completed');
    const firstResult = await firstRequest;

    const secondRequest = service.start(otherProjectId, undefined, vi.fn());
    const secondInput = await secondWorker.started;
    secondWorker.complete('completed');
    const secondResult = await secondRequest;

    expect(service.getCurrentResult(projectId, firstInput.scanId)).toEqual(firstResult);
    expect(service.getCurrentResult(otherProjectId, secondInput.scanId)).toEqual(secondResult);
    expect(service.getCurrentResult(projectId, secondInput.scanId)).toBeNull();

    await service.removeProject(projectId, async () => ({ removed: true as const }));
    expect(service.getCurrentResult(projectId, firstInput.scanId)).toBeNull();
    expect(service.getCurrentResult(otherProjectId, secondInput.scanId)).toEqual(secondResult);
  });

  it('bounds retained scan inventories to fifty projects and refreshes least-recently-used access', async () => {
    const projectIds = Array.from(
      { length: 51 },
      (_, index) => `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    );
    const projectsById = new Map(
      projectIds.map((id, index) => [
        id,
        projectSchema.parse({
          ...project,
          id,
          name: `retention-project-${index + 1}`,
          rootPath: `/fixture/retention-project-${index + 1}`,
        }),
      ]),
    );
    const projects = {
      getById: vi.fn(async (id: string) => projectsById.get(id) ?? null),
    } as unknown as ProjectManagementService;
    const history = new InMemoryScanHistoryRepository();
    const workers = projectIds.map(() => new ControlledScanWorker());
    let workerIndex = 0;
    const service = new ScanManagementService(projects, history, () => {
      const worker = workers[workerIndex];
      workerIndex += 1;
      if (worker === undefined) {
        throw new Error('No scan worker was prepared for this test.');
      }
      return worker;
    });
    const results: ScanResult[] = [];

    for (let index = 0; index < 50; index += 1) {
      const id = projectIds[index];
      const worker = workers[index];
      if (id === undefined || worker === undefined) {
        throw new Error('A scan retention fixture was missing.');
      }
      const request = service.start(id, undefined, vi.fn());
      const input = await worker.started;
      worker.complete('completed');
      results.push(await request);
      expect(input.projectId).toBe(id);
    }

    const firstProjectId = projectIds[0];
    const firstResult = results[0];
    if (firstProjectId === undefined || firstResult === undefined) {
      throw new Error('The first scan retention fixture was missing.');
    }
    expect(service.getCurrentResult(firstProjectId, firstResult.id)).toEqual(firstResult);

    const newestProjectId = projectIds[50];
    const newestWorker = workers[50];
    if (newestProjectId === undefined || newestWorker === undefined) {
      throw new Error('The newest scan retention fixture was missing.');
    }
    const newestRequest = service.start(newestProjectId, undefined, vi.fn());
    const newestInput = await newestWorker.started;
    newestWorker.complete('completed');
    const newestResult = await newestRequest;
    results.push(newestResult);

    const leastRecentlyUsedProjectId = projectIds[1];
    const leastRecentlyUsedResult = results[1];
    expect(service.getCurrentResult(firstProjectId, firstResult.id)).toEqual(firstResult);
    expect(
      leastRecentlyUsedProjectId === undefined || leastRecentlyUsedResult === undefined
        ? null
        : service.getCurrentResult(leastRecentlyUsedProjectId, leastRecentlyUsedResult.id),
    ).toBeNull();
    expect(service.getCurrentResult(newestProjectId, newestInput.scanId)).toEqual(newestResult);
  });

  it('rejects unknown project IDs before starting a worker', async () => {
    const createWorker = vi.fn(() => new ControlledScanWorker());
    const projects = { getById: vi.fn(async () => null) } as unknown as ProjectManagementService;
    const service = new ScanManagementService(
      projects,
      new InMemoryScanHistoryRepository(),
      createWorker,
    );

    await expect(service.start(projectId, undefined, vi.fn())).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND',
    });
    expect(createWorker).not.toHaveBeenCalled();
  });
});
