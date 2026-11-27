import type { AppInfo } from '@repolens/shared';
import type { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../security/ipc-channels.js';
import { registerValidatedHandler, type IpcSenderGuard } from './register-handler.js';

export function registerAppIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  appInfo: Pick<AppInfo, 'version' | 'platform'>,
  senderGuard: IpcSenderGuard,
): void {
  registerValidatedHandler(ipcMain, IPC_CHANNELS.appGetVersion, senderGuard, () => appInfo.version);
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.appGetPlatform,
    senderGuard,
    () => appInfo.platform,
  );
}
