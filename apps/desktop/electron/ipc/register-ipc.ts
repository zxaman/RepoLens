import type { AppInfo } from '@repolens/shared';
import type { IpcMain } from 'electron';
import type { AnalysisManagementService } from '../services/analysis-management.service.js';
import type { AppSettingsService } from '../services/app-settings.service.js';
import type { ProjectManagementService } from '../services/project-management.service.js';
import type { ScanManagementService } from '../services/scan-management.service.js';
import { registerAnalysisIpc } from './analysis.ipc.js';
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
  analyses: AnalysisManagementService,
): void {
  registerAppIpc(ipcMain, appInfo, senderGuard);
  registerProjectIpc(ipcMain, projects, scans, analyses, senderGuard);
  registerScanIpc(ipcMain, scans, senderGuard);
  registerAnalysisIpc(ipcMain, analyses, senderGuard);
  registerSettingsIpc(ipcMain, settings, senderGuard);
}
