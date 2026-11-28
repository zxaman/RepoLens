import {
  analysisResultSchema,
  DEFAULT_SCAN_CONFIG,
  scanHistoryItemSchema,
  scanResultSchema,
  type ScanHistoryItem,
} from '@repolens/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type IpcChannel,
  type IpcEventChannel,
} from '../security/ipc-channels.js';
import { createRepoLensAPI } from './bridge.js';

const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const scanId = '92370c1b-8755-4057-ae23-0d885ad4d94b';
const historyItem: ScanHistoryItem = scanHistoryItemSchema.parse({
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
  bytesHashed: 12,
  languages: [],
  technologies: [],
  warnings: [],
});
const scanResult = scanResultSchema.parse({ ...historyItem, files: [], errors: [] });
const analysisResult = analysisResultSchema.parse({
  analysisId: '7d707ca0-312b-4a6f-8950-8df3441d973a',
  scanId,
  projectId,
  status: 'completed',
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
});

describe('secure analysis and scan preload APIs', () => {
  it('validates scan responses and sends only the approved scan payloads', async () => {
    const invocations: Array<{ channel: IpcChannel; payload?: object }> = [];
    const api = createRepoLensAPI({
      invoke: async (channel, payload) => {
        invocations.push({ channel, ...(payload === undefined ? {} : { payload }) });
        if (channel === IPC_CHANNELS.scansStart) {
          return { ok: true, data: scanResult };
        }
        if (channel === IPC_CHANNELS.scansGetLatest) {
          return { ok: true, data: historyItem };
        }
        if (channel === IPC_CHANNELS.scansGetHistory) {
          return { ok: true, data: [historyItem] };
        }
        if (channel === IPC_CHANNELS.analysisStart) {
          return { ok: true, data: analysisResult };
        }
        if (channel === IPC_CHANNELS.analysisCancel || channel === IPC_CHANNELS.scansCancel) {
          return { ok: true, data: { cancelled: true } };
        }
        return { ok: true, data: null };
      },
    });

    await expect(api.scans.start(projectId, DEFAULT_SCAN_CONFIG)).resolves.toEqual({
      ok: true,
      data: scanResult,
    });
    await expect(api.scans.cancel(scanId)).resolves.toEqual({
      ok: true,
      data: { cancelled: true },
    });
    await expect(api.scans.getHistory(projectId)).resolves.toEqual({
      ok: true,
      data: [historyItem],
    });
    await expect(api.scans.getLatest(projectId)).resolves.toEqual({
      ok: true,
      data: historyItem,
    });
    await expect(api.analysis.start(projectId, scanId)).resolves.toEqual({
      ok: true,
      data: analysisResult,
    });
    await expect(api.analysis.cancel(analysisResult.analysisId)).resolves.toEqual({
      ok: true,
      data: { cancelled: true },
    });
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.scansStart, payload: { projectId, config: DEFAULT_SCAN_CONFIG } },
      { channel: IPC_CHANNELS.scansCancel, payload: { scanId } },
      { channel: IPC_CHANNELS.scansGetHistory, payload: { projectId } },
      { channel: IPC_CHANNELS.scansGetLatest, payload: { projectId } },
      { channel: IPC_CHANNELS.analysisStart, payload: { projectId, scanId } },
      { channel: IPC_CHANNELS.analysisCancel, payload: { analysisId: analysisResult.analysisId } },
    ]);
  });

  it('exposes a narrow graph API with typed payloads and schema-validated JSON export', async () => {
    const invocations: Array<{ channel: IpcChannel; payload?: object }> = [];
    const api = createRepoLensAPI({
      invoke: async (channel, payload) => {
        invocations.push({ channel, ...(payload === undefined ? {} : { payload }) });
        return {
          ok: true,
          data: channel === IPC_CHANNELS.graphsDispose ? { disposed: true } : null,
        };
      },
    });

    await expect(api.graphs.summary(projectId)).resolves.toEqual({ ok: true, data: null });
    await expect(
      api.graphs.query(projectId, { types: ['file'], pathPrefix: 'src', limit: 10 }),
    ).resolves.toEqual({ ok: true, data: null });
    await expect(
      api.graphs.dependencies(projectId, {
        relativePath: 'src/index.ts',
        direction: 'dependencies',
        depth: 2,
      }),
    ).resolves.toEqual({ ok: true, data: null });
    await expect(
      api.graphs.shortestPath(projectId, { fromPath: 'src/index.ts', toPath: 'src/helper.ts' }),
    ).resolves.toEqual({ ok: true, data: null });
    await expect(api.graphs.cycles(projectId)).resolves.toEqual({ ok: true, data: null });
    await expect(api.graphs.exportJson(projectId)).resolves.toEqual({ ok: true, data: null });
    await expect(api.graphs.dispose(projectId)).resolves.toEqual({
      ok: true,
      data: { disposed: true },
    });
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.graphsSummary, payload: { projectId } },
      {
        channel: IPC_CHANNELS.graphsQuery,
        payload: { projectId, query: { types: ['file'], pathPrefix: 'src', limit: 10 } },
      },
      {
        channel: IPC_CHANNELS.graphsDependencies,
        payload: {
          projectId,
          query: { relativePath: 'src/index.ts', direction: 'dependencies', depth: 2 },
        },
      },
      {
        channel: IPC_CHANNELS.graphsShortestPath,
        payload: { projectId, query: { fromPath: 'src/index.ts', toPath: 'src/helper.ts' } },
      },
      { channel: IPC_CHANNELS.graphsCycles, payload: { projectId, query: {} } },
      { channel: IPC_CHANNELS.graphsExportJson, payload: { projectId } },
      { channel: IPC_CHANNELS.graphsDispose, payload: { projectId } },
    ]);

    const invalidExportApi = createRepoLensAPI({
      invoke: async () => ({ ok: true, data: '{"schemaVersion":"1.0.0"}' }),
    });
    await expect(invalidExportApi.graphs.exportJson(projectId)).rejects.toThrow();
  });

  it('validates progress events, isolates listener errors, and releases the subscription', () => {
    let subscribedChannel: IpcEventChannel | null = null;
    let eventListener: ((payload: unknown) => void) | null = null;
    const unsubscribe = vi.fn();
    const callback = vi.fn(() => {
      throw new Error('renderer listener failure');
    });
    const api = createRepoLensAPI(
      { invoke: async () => ({ ok: true, data: null }) },
      {
        subscribe: (channel, listener) => {
          subscribedChannel = channel;
          eventListener = listener;
          return unsubscribe;
        },
      },
    );
    const cleanup = api.scans.onProgress(callback);
    const progress = {
      scanId,
      projectId,
      phase: 'hashing',
      filesDiscovered: 4,
      filesProcessed: 2,
      directoriesProcessed: 3,
      totalBytesProcessed: 128,
    };

    expect(subscribedChannel).toBe(IPC_EVENTS.scansProgress);
    expect(eventListener).not.toBeNull();
    eventListener?.(progress);
    eventListener?.({ ...progress, currentPath: '../escape' });
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(progress);
    expect(() => cleanup()).not.toThrow();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('validates graph-build progress through only its approved event', () => {
    let subscribedChannel: IpcEventChannel | null = null;
    let eventListener: ((payload: unknown) => void) | null = null;
    const cleanup = vi.fn();
    const callback = vi.fn();
    const api = createRepoLensAPI(
      { invoke: async () => ({ ok: true, data: null }) },
      {
        subscribe: (channel, listener) => {
          subscribedChannel = channel;
          eventListener = listener;
          return cleanup;
        },
      },
    );
    const unsubscribe = api.graphs.onProgress(callback);
    const progress = {
      analysisId: analysisResult.analysisId,
      scanId,
      projectId,
      phase: 'nodes',
      processed: 2,
      total: 4,
      percentage: 50,
    };

    expect(subscribedChannel).toBe(IPC_EVENTS.graphsProgress);
    eventListener?.(progress);
    eventListener?.({ ...progress, processed: 5 });
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(progress);
    unsubscribe();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('validates static-analysis progress through only its approved event', () => {
    let subscribedChannel: IpcEventChannel | null = null;
    let eventListener: ((payload: unknown) => void) | null = null;
    const cleanup = vi.fn();
    const callback = vi.fn();
    const api = createRepoLensAPI(
      { invoke: async () => ({ ok: true, data: null }) },
      {
        subscribe: (channel, listener) => {
          subscribedChannel = channel;
          eventListener = listener;
          return cleanup;
        },
      },
    );
    const unsubscribe = api.analysis.onProgress(callback);
    const progress = {
      analysisId: analysisResult.analysisId,
      scanId,
      projectId,
      phase: 'parsing',
      filesTotal: 1,
      filesProcessed: 0,
      currentPath: 'src/index.ts',
    };

    expect(subscribedChannel).toBe(IPC_EVENTS.analysisProgress);
    eventListener?.(progress);
    eventListener?.({ ...progress, currentPath: '../outside.ts' });
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(progress);
    unsubscribe();
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
