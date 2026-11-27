import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { validateIpcPayload } from './validation.js';
import type { IpcChannel } from '../security/ipc-channels.js';

export type IpcSenderGuard = (event: IpcMainInvokeEvent) => void;

export function registerValidatedHandler<TResult>(
  ipcMain: Pick<IpcMain, 'handle'>,
  channel: IpcChannel,
  senderGuard: IpcSenderGuard,
  handler: () => TResult | Promise<TResult>,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    senderGuard(event);

    const payload: unknown = args.length === 0 ? undefined : args.length === 1 ? args[0] : args;
    const validation = validateIpcPayload(channel, payload);
    if (!validation.ok) {
      throw new TypeError(validation.error.message);
    }

    return handler();
  });
}
