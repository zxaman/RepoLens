import { failureResult, type Result, type ScanSummary } from '@repolens/shared';
import type { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../security/ipc-channels.js';
import { registerValidatedHandler, type IpcSenderGuard } from './register-handler.js';

export function registerScanIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  senderGuard: IpcSenderGuard,
): void {
  registerValidatedHandler<Result<ScanSummary | null>>(
    ipcMain,
    IPC_CHANNELS.scansGetStatus,
    senderGuard,
    () => failureResult('NOT_IMPLEMENTED', 'Scan state is introduced with the scanning milestone.'),
  );
}
