import {
  failureResult,
  scanProgressSchema,
  scanResultSchema,
  successResult,
  type AppError,
  type Result,
  type ScanHistoryItem,
  type ScanResult,
} from '@repolens/shared';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { toProjectOperationError } from '../services/project-errors.js';
import type { ScanManagementService } from '../services/scan-management.service.js';
import { IPC_CHANNELS, IPC_EVENTS } from '../security/ipc-channels.js';
import {
  invalidPayloadAsResult,
  registerValidatedHandler,
  type IpcSenderGuard,
} from './register-handler.js';
import {
  projectScanIdPayloadSchema,
  projectScanPayloadSchema,
  scanIdPayloadSchema,
} from './validation.js';

export function registerScanIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  scans: ScanManagementService,
  senderGuard: IpcSenderGuard,
): void {
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.scansStart,
    senderGuard,
    projectScanPayloadSchema,
    (payload, event) =>
      safely('start project scan', async () =>
        scanResultSchema.parse(
          await scans.start(payload.projectId, payload.config, (progress) => {
            sendProgressToSender(event, progress);
          }),
        ),
      ),
    invalidPayloadAsResult<ScanResult>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.scansCancel,
    senderGuard,
    scanIdPayloadSchema,
    ({ scanId }) => safely('cancel project scan', () => scans.cancel(scanId)),
    invalidPayloadAsResult<{ readonly cancelled: true }>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.scansGetHistory,
    senderGuard,
    projectScanIdPayloadSchema,
    ({ projectId }) => safely('load project scan history', () => scans.getHistory(projectId)),
    invalidPayloadAsResult<readonly ScanHistoryItem[]>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.scansGetLatest,
    senderGuard,
    projectScanIdPayloadSchema,
    ({ projectId }) => safely('load latest project scan', () => scans.getLatest(projectId)),
    invalidPayloadAsResult<ScanHistoryItem | null>(),
  );
}

function sendProgressToSender(event: IpcMainInvokeEvent, value: unknown): void {
  const progress = scanProgressSchema.safeParse(value);
  if (!progress.success || event.sender.isDestroyed()) {
    return;
  }
  try {
    event.sender.send(IPC_EVENTS.scansProgress, progress.data);
  } catch {
    // A renderer closing during a scan must not interrupt scanning or history persistence.
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
