import { analysisResultSchema } from '@repolens/shared';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisManagementService } from '../services/analysis-management.service.js';
import { IPC_CHANNELS, IPC_EVENTS } from '../security/ipc-channels.js';
import { registerAnalysisIpc } from './analysis.ipc.js';

type RegisteredHandler = Parameters<IpcMain['handle']>[1];

const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const scanId = '92370c1b-8755-4057-ae23-0d885ad4d94b';
const analysisId = '7d707ca0-312b-4a6f-8950-8df3441d973a';
const analysisResult = analysisResultSchema.parse({
  analysisId,
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

describe('static-analysis IPC', () => {
  it('validates start/cancel requests, guards senders, and scopes progress to the invoking renderer', async () => {
    const handlers = new Map<string, RegisteredHandler>();
    const ipcMain = {
      handle(channel: string, listener: RegisteredHandler) {
        handlers.set(channel, listener);
      },
    } as unknown as Pick<IpcMain, 'handle'>;
    const senderGuard = vi.fn();
    const send = vi.fn();
    const progress = {
      analysisId,
      scanId,
      projectId,
      phase: 'parsing' as const,
      filesTotal: 1,
      filesProcessed: 0,
      currentPath: 'src/index.ts',
    };
    const analyses = {
      start: vi.fn(
        async (_projectId: string, _scanId: string, report: (value: typeof progress) => void) => {
          report(progress);
          return analysisResult;
        },
      ),
      cancel: vi.fn(async () => ({ cancelled: true as const })),
    } as unknown as AnalysisManagementService;
    registerAnalysisIpc(ipcMain, analyses, senderGuard);

    const event = {
      sender: { isDestroyed: () => false, send },
    } as unknown as IpcMainInvokeEvent;
    const startHandler = handlers.get(IPC_CHANNELS.analysisStart);
    const startResult = await startHandler?.(event, { projectId, scanId });
    expect(startResult).toEqual({ ok: true, data: analysisResult });
    expect(analyses.start).toHaveBeenCalledWith(projectId, scanId, expect.any(Function));
    expect(send).toHaveBeenCalledWith(IPC_EVENTS.analysisProgress, progress);

    const invalidResult = await startHandler?.(event, { projectId, scanId: '../escape' });
    expect(invalidResult).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(analyses.start).toHaveBeenCalledOnce();

    const cancelResult = await handlers.get(IPC_CHANNELS.analysisCancel)?.(event, { analysisId });
    expect(cancelResult).toEqual({ ok: true, data: { cancelled: true } });
    expect(analyses.cancel).toHaveBeenCalledWith(analysisId);
    expect(senderGuard).toHaveBeenCalledTimes(3);
  });
});
