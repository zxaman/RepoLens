import { failureResult, type AppSettings, type Result } from '@repolens/shared';
import type { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../security/ipc-channels.js';
import { registerValidatedHandler, type IpcSenderGuard } from './register-handler.js';

export function registerSettingsIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  senderGuard: IpcSenderGuard,
): void {
  registerValidatedHandler<Result<AppSettings>>(
    ipcMain,
    IPC_CHANNELS.settingsGet,
    senderGuard,
    () =>
      failureResult('NOT_IMPLEMENTED', 'Settings persistence is not available in the foundation.'),
  );
}
