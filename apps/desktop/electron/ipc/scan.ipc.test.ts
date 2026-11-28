import { scanHistoryItemSchema, scanResultSchema } from '@repolens/shared';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { ScanManagementService } from '../services/scan-management.service.js';
import { IPC_CHANNELS, IPC_EVENTS } from '../security/ipc-channels.js';
import { registerScanIpc } from './scan.ipc.js';

type RegisteredHandler = Parameters<IpcMain['handle']>[1];

const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const scanId = '92370c1b-8755-4057-ae23-0d885ad4d94b';
const historyItem = scanHistoryItemSchema.parse({
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

describe('scan IPC', () => {
  it('validates scan requests, forwards safe progress, and exposes only project-scoped history', async () => {
    const handlers = new Map<string, RegisteredHandler>();
    const ipcMain = {
      handle(channel: string, listener: RegisteredHandler) {
        handlers.set(channel, listener);
      },
    } as unknown as Pick<IpcMain, 'handle'>;
    const senderGuard = vi.fn();
    const send = vi.fn();
    const progress = {
      scanId,
      projectId,
      phase: 'walking' as const,
      filesDiscovered: 1,
      filesProcessed: 0,
      directoriesProcessed: 1,
      totalBytesProcessed: 0,
    };
    const scans = {
      start: vi.fn(
        async (_id: string, _config: unknown, report: (value: typeof progress) => void) => {
          report(progress);
          return scanResult;
        },
      ),
      cancel: vi.fn(async () => ({ cancelled: true as const })),
      getHistory: vi.fn(async () => [historyItem]),
      getLatest: vi.fn(async () => historyItem),
    } as unknown as ScanManagementService;
    registerScanIpc(ipcMain, scans, senderGuard);

    const event = {
      sender: { isDestroyed: () => false, send },
    } as unknown as IpcMainInvokeEvent;
    const startHandler = handlers.get(IPC_CHANNELS.scansStart);
    const startResult = await startHandler?.(event, { projectId });
    expect(startResult).toEqual({ ok: true, data: scanResult });
    expect(scans.start).toHaveBeenCalledWith(projectId, undefined, expect.any(Function));
    expect(send).toHaveBeenCalledWith(IPC_EVENTS.scansProgress, progress);

    const invalidResult = await startHandler?.(event, {
      projectId,
      config: { includeSensitiveFiles: true },
    });
    expect(invalidResult).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(scans.start).toHaveBeenCalledOnce();

    const cancelResult = await handlers.get(IPC_CHANNELS.scansCancel)?.(event, { scanId });
    expect(cancelResult).toEqual({ ok: true, data: { cancelled: true } });
    const historyResult = await handlers.get(IPC_CHANNELS.scansGetHistory)?.(event, { projectId });
    expect(historyResult).toEqual({ ok: true, data: [historyItem] });
    const latestResult = await handlers.get(IPC_CHANNELS.scansGetLatest)?.(event, { projectId });
    expect(latestResult).toEqual({ ok: true, data: historyItem });
    expect(senderGuard).toHaveBeenCalledTimes(5);
  });
});
