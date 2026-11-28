import { graphGenerationReportSchema, graphSummarySchema } from '@repolens/shared';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { GraphBuildProgress } from '@repolens/shared';
import { describe, expect, it, vi } from 'vitest';
import type { GraphManagementService } from '../services/graph-management.service.js';
import { IPC_CHANNELS, IPC_EVENTS } from '../security/ipc-channels.js';
import { registerGraphIpc } from './graph.ipc.js';

type RegisteredHandler = Parameters<IpcMain['handle']>[1];

const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const analysisId = '7d707ca0-312b-4a6f-8950-8df3441d973a';
const scanId = '92370c1b-8755-4057-ae23-0d885ad4d94b';
const generationReport = graphGenerationReportSchema.parse({
  projectId,
  analysisId,
  analysisStatus: 'completed',
  status: 'completed',
  totalNodes: 1,
  totalEdges: 0,
  nodesByType: { project: 1 },
  edgesByType: {},
  resolvedDependencies: 0,
  unresolvedDependencies: 0,
  externalDependencies: 0,
  cycleCount: 0,
  cyclesTruncated: false,
  warnings: [],
});
const summary = graphSummarySchema.parse({
  projectId,
  analysisId,
  scanId,
  analysisStatus: 'completed',
  metrics: {
    nodeCount: 1,
    edgeCount: 0,
    nodesByType: [
      { type: 'project', count: 1 },
      { type: 'folder', count: 0 },
      { type: 'file', count: 0 },
      { type: 'component', count: 0 },
      { type: 'service', count: 0 },
      { type: 'class', count: 0 },
      { type: 'function', count: 0 },
      { type: 'interface', count: 0 },
      { type: 'api-route', count: 0 },
      { type: 'database-model', count: 0 },
    ],
    edgesByType: [
      { type: 'contains', count: 0 },
      { type: 'imports', count: 0 },
      { type: 'exports', count: 0 },
      { type: 'calls', count: 0 },
      { type: 'implements', count: 0 },
      { type: 'extends', count: 0 },
      { type: 'api-call', count: 0 },
      { type: 'uses-model', count: 0 },
    ],
    fileCount: 0,
    folderCount: 0,
    symbolCount: 0,
    analysisFilesAnalyzed: 0,
    dependencyEdgeCount: 0,
    uniqueDependencyPairCount: 0,
    externalDependencyCount: 0,
    unresolvedDependencyCount: 0,
    isolatedFileCount: 0,
    averageDependenciesPerFile: 0,
    maxDependenciesPerFile: 0,
    stronglyConnectedComponentCount: 0,
    cyclicComponentCount: 0,
    selfLoopCount: 0,
  },
});

describe('graph IPC', () => {
  it('validates payloads and graph responses behind the trusted-sender guard', async () => {
    const handlers = new Map<string, RegisteredHandler>();
    const ipcMain = {
      handle(channel: string, listener: RegisteredHandler) {
        handlers.set(channel, listener);
      },
    } as unknown as Pick<IpcMain, 'handle'>;
    const senderGuard = vi.fn();
    const graphs = {
      generate: vi.fn(
        async (
          _projectId: string,
          _scanId: string,
          _analysisId: string,
          reportProgress: (progress: GraphBuildProgress) => void,
        ) => {
          reportProgress({
            analysisId,
            scanId,
            projectId,
            phase: 'nodes',
            processed: 1,
            total: 2,
            percentage: 50,
          });
          return generationReport;
        },
      ),
      summary: vi.fn(async () => summary),
      query: vi.fn(async () => null),
      dependencies: vi.fn(async () => null),
      shortestPath: vi.fn(async () => null),
      cycles: vi.fn(async () => null),
      exportJson: vi.fn(async () => null),
      dispose: vi.fn(async () => ({ disposed: true as const })),
    } as unknown as GraphManagementService;
    registerGraphIpc(ipcMain, graphs, senderGuard);

    const send = vi.fn();
    const event = {
      sender: { isDestroyed: () => false, send },
    } as unknown as IpcMainInvokeEvent;
    const generationHandler = handlers.get(IPC_CHANNELS.graphsGenerate);
    await expect(generationHandler?.(event, { projectId, scanId, analysisId })).resolves.toEqual({
      ok: true,
      data: generationReport,
    });
    expect(graphs.generate).toHaveBeenCalledWith(
      projectId,
      scanId,
      analysisId,
      expect.any(Function),
    );
    expect(send).toHaveBeenCalledWith(
      IPC_EVENTS.graphsProgress,
      expect.objectContaining({ projectId, scanId, analysisId, phase: 'nodes' }),
    );

    const summaryHandler = handlers.get(IPC_CHANNELS.graphsSummary);
    await expect(summaryHandler?.(event, { projectId })).resolves.toEqual({
      ok: true,
      data: summary,
    });
    expect(graphs.summary).toHaveBeenCalledWith(projectId);

    await expect(
      generationHandler?.(event, { projectId, scanId: '../outside', analysisId }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(graphs.generate).toHaveBeenCalledOnce();

    const queryHandler = handlers.get(IPC_CHANNELS.graphsQuery);
    await expect(
      queryHandler?.(event, {
        projectId,
        query: { pathPrefix: '../outside', limit: 100 },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(graphs.query).not.toHaveBeenCalled();

    const strictPayloadResult = await summaryHandler?.(event, {
      projectId,
      rootPath: '/private/path',
    });
    expect(strictPayloadResult).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(senderGuard).toHaveBeenCalledTimes(5);
  });

  it('rejects an invalid graph object returned by a service before IPC resolves', async () => {
    const handlers = new Map<string, RegisteredHandler>();
    const ipcMain = {
      handle(channel: string, listener: RegisteredHandler) {
        handlers.set(channel, listener);
      },
    } as unknown as Pick<IpcMain, 'handle'>;
    const graphs = {
      summary: vi.fn(async () => ({ projectId, analysisId, scanId })),
    } as unknown as GraphManagementService;
    registerGraphIpc(ipcMain, graphs, () => undefined);

    const result = await handlers.get(IPC_CHANNELS.graphsSummary)?.({} as IpcMainInvokeEvent, {
      projectId,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  });
});
