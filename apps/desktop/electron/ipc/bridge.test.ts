import {
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

describe('secure scan preload API', () => {
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
        return { ok: true, data: { cancelled: true } };
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
    expect(invocations).toEqual([
      { channel: IPC_CHANNELS.scansStart, payload: { projectId, config: DEFAULT_SCAN_CONFIG } },
      { channel: IPC_CHANNELS.scansCancel, payload: { scanId } },
      { channel: IPC_CHANNELS.scansGetHistory, payload: { projectId } },
      { channel: IPC_CHANNELS.scansGetLatest, payload: { projectId } },
    ]);
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
});
