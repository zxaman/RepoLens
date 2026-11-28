import {
  analysisProgressSchema,
  analysisResultSchema,
  graphBuildProgressSchema,
  failureResult,
  successResult,
  type AnalysisResult,
  type AppError,
  type Result,
} from '@repolens/shared';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { toProjectOperationError } from '../services/project-errors.js';
import type { AnalysisManagementService } from '../services/analysis-management.service.js';
import { IPC_CHANNELS, IPC_EVENTS } from '../security/ipc-channels.js';
import {
  invalidPayloadAsResult,
  registerValidatedHandler,
  type IpcSenderGuard,
} from './register-handler.js';
import { analysisIdPayloadSchema, analysisStartPayloadSchema } from './validation.js';

export function registerAnalysisIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  analyses: AnalysisManagementService,
  senderGuard: IpcSenderGuard,
): void {
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.analysisStart,
    senderGuard,
    analysisStartPayloadSchema,
    (payload, event) =>
      safely('static analysis', async () =>
        analysisResultSchema.parse(
          await analyses.start(
            payload.projectId,
            payload.scanId,
            (progress) => sendProgressToSender(event, progress),
            (progress) => sendGraphProgressToSender(event, progress),
          ),
        ),
      ),
    invalidPayloadAsResult<AnalysisResult>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.analysisCancel,
    senderGuard,
    analysisIdPayloadSchema,
    ({ analysisId }) => safely('cancel static analysis', () => analyses.cancel(analysisId)),
    invalidPayloadAsResult<{ readonly cancelled: true }>(),
  );
}

function sendProgressToSender(event: IpcMainInvokeEvent, value: unknown): void {
  const progress = analysisProgressSchema.safeParse(value);
  if (!progress.success || event.sender.isDestroyed()) {
    return;
  }
  try {
    event.sender.send(IPC_EVENTS.analysisProgress, progress.data);
  } catch {
    // Closing the renderer must not interrupt analysis or worker cleanup.
  }
}

function sendGraphProgressToSender(event: IpcMainInvokeEvent, value: unknown): void {
  const progress = graphBuildProgressSchema.safeParse(value);
  if (!progress.success || event.sender.isDestroyed()) {
    return;
  }
  try {
    event.sender.send(IPC_EVENTS.graphsProgress, progress.data);
  } catch {
    // Closing the renderer must not interrupt analysis or graph construction.
  }
}

async function safely<T>(operation: string, action: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return successResult(await action());
  } catch (error) {
    const appError: AppError = toProjectOperationError(error, operation);
    return failureResult(appError.code, appError.message);
  }
}
