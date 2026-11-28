import { graphSummarySchema } from '@repolens/shared';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { GraphManagementService } from '../services/graph-management.service.js';
import { IPC_CHANNELS } from '../security/ipc-channels.js';
import { registerGraphIpc } from './graph.ipc.js';

type RegisteredHandler = Parameters<IpcMain['handle']>[1];

const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const analysisId = '7d707ca0-312b-4a6f-8950-8df3441d973a';
const scanId = '92370c1b-8755-4057-ae23-0d885ad4d94b';
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
      summary: vi.fn(async () => summary),
      query: vi.fn(async () => null),
      dependencies: vi.fn(async () => null),
      shortestPath: vi.fn(async () => null),
      cycles: vi.fn(async () => null),
      exportJson: vi.fn(async () => null),
      dispose: vi.fn(async () => ({ disposed: true as const })),
    } as unknown as GraphManagementService;
    registerGraphIpc(ipcMain, graphs, senderGuard);

    const event = {} as IpcMainInvokeEvent;
    const summaryHandler = handlers.get(IPC_CHANNELS.graphsSummary);
    await expect(summaryHandler?.(event, { projectId })).resolves.toEqual({
      ok: true,
      data: summary,
    });
    expect(graphs.summary).toHaveBeenCalledWith(projectId);

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
    expect(senderGuard).toHaveBeenCalledTimes(3);
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
