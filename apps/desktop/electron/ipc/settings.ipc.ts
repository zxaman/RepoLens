import {
  appSettingsSchema,
  failureResult,
  successResult,
  type AppError,
  type AppSettings,
  type Result,
} from '@repolens/shared';
import type { IpcMain } from 'electron';
import { toProjectOperationError } from '../services/project-errors.js';
import type { AppSettingsService } from '../services/app-settings.service.js';
import { IPC_CHANNELS } from '../security/ipc-channels.js';
import {
  invalidPayloadAsResult,
  noPayloadSchema,
  registerValidatedHandler,
  type IpcSenderGuard,
} from './register-handler.js';

export function registerSettingsIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  settings: AppSettingsService,
  senderGuard: IpcSenderGuard,
): void {
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.settingsGet,
    senderGuard,
    noPayloadSchema(),
    () => safely('load settings', () => settings.get()),
    invalidPayloadAsResult<AppSettings>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.settingsUpdate,
    senderGuard,
    appSettingsSchema,
    (payload) => safely('save settings', () => settings.update(payload)),
    invalidPayloadAsResult<AppSettings>(),
  );
  registerValidatedHandler(
    ipcMain,
    IPC_CHANNELS.settingsReset,
    senderGuard,
    noPayloadSchema(),
    () => safely('reset settings', () => settings.reset()),
    invalidPayloadAsResult<AppSettings>(),
  );
}

async function safely<T>(operation: string, action: () => Promise<T>): Promise<Result<T>> {
  try {
    return successResult(await action());
  } catch (error) {
    const appError: AppError = toProjectOperationError(error, operation);
    return failureResult(appError.code, appError.message);
  }
}
