import { failureResult, type Project, type Result } from '@repolens/shared';
import type { IpcMain } from 'electron';
import { IPC_CHANNELS } from '../security/ipc-channels.js';
import { registerValidatedHandler, type IpcSenderGuard } from './register-handler.js';

export function registerProjectIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  senderGuard: IpcSenderGuard,
): void {
  registerValidatedHandler<Result<readonly Project[]>>(
    ipcMain,
    IPC_CHANNELS.projectsList,
    senderGuard,
    () =>
      failureResult('NOT_IMPLEMENTED', 'Project registration is introduced in a later milestone.'),
  );
}
