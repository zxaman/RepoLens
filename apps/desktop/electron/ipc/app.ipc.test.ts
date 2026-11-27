import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../security/ipc-channels.js';
import { registerAppIpc } from './app.ipc.js';

type RegisteredHandler = Parameters<IpcMain['handle']>[1];

describe('application information IPC', () => {
  it('returns the runtime version and platform only after sender validation', async () => {
    const handlers = new Map<string, RegisteredHandler>();
    const ipcMain = {
      handle(channel: string, listener: RegisteredHandler) {
        handlers.set(channel, listener);
      },
    } as unknown as Pick<IpcMain, 'handle'>;
    const senderGuard = vi.fn();

    registerAppIpc(ipcMain, { version: '0.1.0', platform: 'linux' }, senderGuard);

    const versionHandler = handlers.get(IPC_CHANNELS.appGetVersion);
    expect(versionHandler).toBeDefined();
    await expect(versionHandler?.({} as IpcMainInvokeEvent)).resolves.toBe('0.1.0');
    expect(senderGuard).toHaveBeenCalledOnce();

    const platformHandler = handlers.get(IPC_CHANNELS.appGetPlatform);
    await expect(platformHandler?.({} as IpcMainInvokeEvent)).resolves.toBe('linux');
  });

  it('rejects malformed input instead of invoking the application provider', async () => {
    const handlers = new Map<string, RegisteredHandler>();
    const ipcMain = {
      handle(channel: string, listener: RegisteredHandler) {
        handlers.set(channel, listener);
      },
    } as unknown as Pick<IpcMain, 'handle'>;
    const senderGuard = vi.fn();

    registerAppIpc(ipcMain, { version: '0.1.0', platform: 'linux' }, senderGuard);

    await expect(
      handlers.get(IPC_CHANNELS.appGetVersion)?.({} as IpcMainInvokeEvent, { arbitrary: true }),
    ).rejects.toThrow(/invalid payload/i);
    expect(senderGuard).toHaveBeenCalledOnce();
  });
});
