import type { AppInfo } from '@repolens/shared';
import type { IpcMain } from 'electron';
import type { AppSettingsService } from '../services/app-settings.service.js';
import type { ProjectManagementService } from '../services/project-management.service.js';
import type { ScanManagementService } from '../services/scan-management.service.js';
import { registerAppIpc } from './app.ipc.js';
import { registerProjectIpc } from './project.ipc.js';
import { registerScanIpc } from './scan.ipc.js';
import { registerSettingsIpc } from './settings.ipc.js';
import type { IpcSenderGuard } from './register-handler.js';

export function registerIpcHandlers(
  ipcMain: IpcMain,
  appInfo: AppInfo,
  senderGuard: IpcSenderGuard,
  projects: ProjectManagementService,
  settings: AppSettingsService,
  scans: ScanManagementService,
): void {
  registerAppIpc(ipcMain, appInfo, senderGuard);
  registerProjectIpc(ipcMain, projects, scans, senderGuard);
  registerScanIpc(ipcMain, scans, senderGuard);
  registerSettingsIpc(ipcMain, settings, senderGuard);
}
