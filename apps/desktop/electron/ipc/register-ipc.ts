import type { AppInfo } from '@repolens/shared';
import type { IpcMain } from 'electron';
import { registerAppIpc } from './app.ipc.js';
import { registerProjectIpc } from './project.ipc.js';
import { registerScanIpc } from './scan.ipc.js';
import { registerSettingsIpc } from './settings.ipc.js';
import type { IpcSenderGuard } from './register-handler.js';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  appInfo: AppInfo,
  senderGuard: IpcSenderGuard,
): void {
  registerAppIpc(ipcMain, appInfo, senderGuard);
  registerProjectIpc(ipcMain, senderGuard);
  registerScanIpc(ipcMain, senderGuard);
  registerSettingsIpc(ipcMain, senderGuard);
}
