import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createRepoLensAPI } from './ipc/bridge.js';
import { registerIpcHandlers } from './ipc/register-ipc.js';
import type { IpcChannel } from './security/ipc-channels.js';
import { assertTrustedIpcInvocation } from './security/sender-validation.js';
import { createAppInfo } from './services/app-info.service.js';
import type { AppSettingsService } from './services/app-settings.service.js';
import type { ProjectManagementService } from './services/project-management.service.js';

type RegisteredHandler = Parameters<IpcMain['handle']>[1];

const trustedUrl = 'http://127.0.0.1:4200/';

describe('app version IPC round trip', () => {
  it('returns validated Electron metadata through the guarded preload API', async () => {
    const handlers = new Map<IpcChannel, RegisteredHandler>();
    const ipcMain = {
      handle(channel: IpcChannel, listener: RegisteredHandler) {
        handlers.set(channel, listener);
      },
    } as unknown as IpcMain;
    const senderGuard = vi.fn((event: IpcMainInvokeEvent) => {
      assertTrustedIpcInvocation(
        event.senderFrame?.url ?? null,
        event.sender.mainFrame?.url ?? null,
        { mode: 'development', origin: trustedUrl },
      );
    });

    registerIpcHandlers(
      ipcMain,
      createAppInfo({ name: 'RepoLens', version: '0.2.0', platform: 'linux' }),
      senderGuard,
      {} as unknown as ProjectManagementService,
      {} as unknown as AppSettingsService,
    );

    const trustedEvent = {
      senderFrame: { url: trustedUrl },
      sender: { mainFrame: { url: trustedUrl } },
    } as IpcMainInvokeEvent;
    const api = createRepoLensAPI({
      invoke: async (channel) => {
        const handler = handlers.get(channel);
        if (handler === undefined) {
          throw new Error(`No IPC handler registered for ${channel}.`);
        }
        return handler(trustedEvent);
      },
    });

    await expect(api.app.getVersion()).resolves.toBe('0.2.0');
    expect(senderGuard).toHaveBeenCalledOnce();
  });
});
