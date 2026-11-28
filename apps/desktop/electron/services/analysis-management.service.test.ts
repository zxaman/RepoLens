import { buildProjectGraph, InMemoryGraphProvider } from '@repolens/core';
import {
  analysisResultSchema,
  projectSchema,
  scanResultSchema,
  type AnalysisProgress,
  type AnalysisResult,
  type Project,
  type ScanResult,
} from '@repolens/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectManagementService } from './project-management.service.js';
import { AnalysisManagementService } from './analysis-management.service.js';
import type { AnalysisWorkerSession, WorkerAnalysisInput } from './analysis-worker-session.js';
import type { ScanManagementService } from './scan-management.service.js';

const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const scanId = '92370c1b-8755-4057-ae23-0d885ad4d94b';
const project: Project = projectSchema.parse({
  id: projectId,
  name: 'fixture-project',
  rootPath: '/fixture/project',
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
  status: 'registered',
  repositoryType: 'local',
  repositoryIndicators: [],
});
const scan: ScanResult = scanResultSchema.parse({
  id: scanId,
  projectId,
  status: 'completed',
  startedAt: '2026-11-27T00:00:00.000Z',
  completedAt: '2026-11-27T00:00:01.000Z',
  durationMs: 1_000,
  directoriesDiscovered: 1,
  filesDiscovered: 1,
  filesProcessed: 1,
  sourceFiles: 1,
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
  files: [
    {
      relativePath: 'src/index.ts',
      extension: '.ts',
      sizeBytes: 16,
      modifiedAt: '2026-11-27T00:00:00.000Z',
      classification: 'source',
      language: 'TypeScript',
      hashStatus: 'not-attempted',
    },
  ],
  errors: [],
});

class ControlledAnalysisWorker implements AnalysisWorkerSession {
  private input: WorkerAnalysisInput | null = null;
  private resolveStarted: ((value: WorkerAnalysisInput) => void) | null = null;
  private resolveResult: ((result: AnalysisResult) => void) | null = null;
  private done = false;
  readonly started = new Promise<WorkerAnalysisInput>((resolve) => {
    this.resolveStarted = resolve;
  });
  readonly cancel = vi.fn();
  readonly terminate = vi.fn(async () => undefined);
  readonly progress = vi.fn<(value: AnalysisProgress) => void>();

  get finished(): boolean {
    return this.done;
  }

  get wasStarted(): boolean {
    return this.input !== null;
  }

  run(
    input: WorkerAnalysisInput,
    onProgress: (progress: AnalysisProgress) => void,
  ): Promise<AnalysisResult> {
    this.input = input;
    this.resolveStarted?.(input);
    this.progress.mockImplementation(onProgress);
    this.progress({
      analysisId: input.analysisId,
      scanId: input.scanId,
      projectId: input.projectId,
      phase: 'parsing',
      filesTotal: 1,
      filesProcessed: 0,
      currentPath: 'src/index.ts',
    });
    return new Promise<AnalysisResult>((resolve) => {
      this.resolveResult = resolve;
    });
  }

  complete(status: AnalysisResult['status']): void {
    if (this.done || this.input === null || this.resolveResult === null) {
      return;
    }
    this.done = true;
    this.resolveResult(
      analysisResultSchema.parse({
        analysisId: this.input.analysisId,
        scanId: this.input.scanId,
        projectId: this.input.projectId,
        status,
        startedAt: '2026-11-27T00:00:00.000Z',
        completedAt: '2026-11-27T00:00:01.000Z',
        durationMs: 1_000,
        filesSelected: 1,
        filesAnalyzed: 1,
        filesSkipped: 0,
        symbols: [],
        imports: [],
        exports: [],
        dependencies: [],
        diagnostics: [],
      }),
    );
  }
}

function createServices(
  worker: AnalysisWorkerSession,
  currentScan: ScanResult | null,
): {
  readonly service: AnalysisManagementService;
  readonly projects: { getById: ReturnType<typeof vi.fn> };
  readonly scans: { getCurrentResult: ReturnType<typeof vi.fn> };
} {
  const projects = { getById: vi.fn(async () => project) };
  const scans = {
    getCurrentResult: vi.fn((id: string, idForScan: string) =>
      id === projectId && idForScan === scanId ? currentScan : null,
    ),
  };
  return {
    service: new AnalysisManagementService(
      projects as unknown as ProjectManagementService,
      scans as unknown as ScanManagementService,
      () => worker,
    ),
    projects,
    scans,
  };
}

function emptyAnalysis(analysisId: string): AnalysisResult {
  return analysisResultSchema.parse({
    analysisId,
    scanId,
    projectId,
    status: 'completed',
    startedAt: '2026-11-27T00:00:00.000Z',
    completedAt: '2026-11-27T00:00:01.000Z',
    durationMs: 1_000,
    filesSelected: 0,
    filesAnalyzed: 0,
    filesSkipped: 0,
    symbols: [],
    imports: [],
    exports: [],
    dependencies: [],
    diagnostics: [],
  });
}

describe('analysis management service', () => {
  it('uses only the current in-memory ScanResult, forwards progress, supports cancellation, and blocks removal while active', async () => {
    const worker = new ControlledAnalysisWorker();
    const { service, scans } = createServices(worker, scan);
    const progress = vi.fn();
    const startRequest = service.start(projectId, scanId, progress);
    const input = await worker.started;

    expect(input.scan).toEqual(scan);
    expect(input.rootPath).toBe(project.rootPath);
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        scanId,
        projectId,
        phase: 'parsing',
        currentPath: 'src/index.ts',
      }),
    );
    expect(scans.getCurrentResult).toHaveBeenCalledWith(projectId, scanId);
    await expect(service.start(projectId, scanId, vi.fn())).rejects.toMatchObject({
      code: 'ANALYSIS_ALREADY_RUNNING',
    });
    await expect(service.removeProject(projectId, async () => 'removed')).rejects.toMatchObject({
      code: 'ANALYSIS_ALREADY_RUNNING',
    });

    await expect(service.cancel(input.analysisId)).resolves.toEqual({ cancelled: true });
    expect(worker.cancel).toHaveBeenCalledOnce();
    worker.complete('cancelled');
    await expect(startRequest).resolves.toMatchObject({
      analysisId: input.analysisId,
      scanId,
      projectId,
      status: 'cancelled',
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(service.removeProject(projectId, async () => 'removed')).resolves.toBe('removed');
  });

  it('invalidates the previous graph when analysis starts and publishes only the matching newer result', async () => {
    const worker = new ControlledAnalysisWorker();
    const graphProvider = new InMemoryGraphProvider();
    const oldGraph = await buildProjectGraph(emptyAnalysis('8d707ca0-312b-4a6f-8950-8df3441d973a'));
    graphProvider.replace(oldGraph);
    const projects = { getById: vi.fn(async () => project) };
    const scans = { getCurrentResult: vi.fn(() => scan) };
    const service = new AnalysisManagementService(
      projects as unknown as ProjectManagementService,
      scans as unknown as ScanManagementService,
      () => worker,
      graphProvider,
    );

    const request = service.start(projectId, scanId, vi.fn());
    const input = await worker.started;
    expect(graphProvider.get(projectId)).toBeNull();

    worker.complete('completed');
    const result = await request;
    expect(result.analysisId).toBe(input.analysisId);
    const currentGraph = graphProvider.get(projectId);
    expect(currentGraph?.analysisId).toBe(input.analysisId);
    expect(currentGraph?.getSummary().metrics.nodeCount).toBe(1);

    await expect(
      service.removeProject(projectId, async () => {
        throw new Error('The registration could not be removed.');
      }),
    ).rejects.toThrow('The registration could not be removed.');
    expect(graphProvider.get(projectId)).toBe(currentGraph);
    await expect(service.removeProject(projectId, async () => 'removed')).resolves.toBe('removed');
    expect(graphProvider.get(projectId)).toBeNull();
  });

  it('forwards graph progress and cancels graph generation without publishing a partial graph', async () => {
    const worker = new ControlledAnalysisWorker();
    const graphProvider = new InMemoryGraphProvider();
    const projects = { getById: vi.fn(async () => project) };
    const scans = { getCurrentResult: vi.fn(() => scan) };
    const service = new AnalysisManagementService(
      projects as unknown as ProjectManagementService,
      scans as unknown as ScanManagementService,
      () => worker,
      graphProvider,
    );
    let cancelRequested = false;
    const graphProgress = vi.fn(
      (progress: { readonly analysisId: string; readonly phase: string }) => {
        if (progress.phase === 'nodes') {
          cancelRequested = true;
          void service.cancel(progress.analysisId);
        }
      },
    );

    const request = service.start(projectId, scanId, vi.fn(), graphProgress);
    const input = await worker.started;
    worker.complete('completed');

    await expect(request).resolves.toMatchObject({
      analysisId: input.analysisId,
      status: 'completed',
    });
    expect(cancelRequested).toBe(true);
    expect(graphProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: input.analysisId,
        projectId,
        scanId,
        phase: 'cancelled',
      }),
    );
    expect(graphProvider.get(projectId)).toBeNull();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects a scan that is not the current full in-memory result', async () => {
    const worker = new ControlledAnalysisWorker();
    const { service, scans } = createServices(worker, null);

    await expect(service.start(projectId, scanId, vi.fn())).rejects.toMatchObject({
      code: 'ANALYSIS_SCAN_UNAVAILABLE',
    });
    expect(scans.getCurrentResult).toHaveBeenCalledWith(projectId, scanId);
    expect(worker.wasStarted).toBe(false);
  });
});
