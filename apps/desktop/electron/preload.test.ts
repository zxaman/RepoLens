import type { RepoLensAPI } from '@repolens/shared';
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from './security/ipc-channels.js';

const electronMocks = vi.hoisted(() => {
  const exposedWorld = new Map<string, unknown>();
  const invoke = vi.fn(async (channel: string): Promise<unknown> => {
    if (channel === 'app:get-version') {
      return '0.1.0';
    }
    if (channel === 'app:get-platform') {
      return 'linux';
    }
    return {
      ok: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'This operation is not available in Phase 1.' },
    };
  });

  return { exposedWorld, invoke };
});

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => electronMocks.exposedWorld.set(key, value),
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
  },
}));

import './preload.js';

describe('secure preload bridge', () => {
  it('exposes only typed, explicitly approved application capabilities', async () => {
    const rawApi = electronMocks.exposedWorld.get('repolens');
    expect(rawApi).toBeDefined();
    expect(electronMocks.exposedWorld.has('ipcRenderer')).toBe(false);

    const api = rawApi as RepoLensAPI;
    expect(Object.keys(api).sort()).toEqual(['app', 'projects', 'scans', 'settings']);
    expect(Object.keys(api.app).sort()).toEqual(['getPlatform', 'getVersion']);
    expect('send' in api).toBe(false);
    expect('invoke' in api).toBe(false);

    await expect(api.app.getVersion()).resolves.toBe('0.1.0');
    await expect(api.app.getPlatform()).resolves.toBe('linux');
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.appGetVersion);
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.appGetPlatform);
  });

  it('validates typed responses received across IPC', async () => {
    const api = electronMocks.exposedWorld.get('repolens') as RepoLensAPI;
    const projects = await api.projects.list();

    expect(projects).toMatchObject({
      ok: false,
      error: { code: 'NOT_IMPLEMENTED' },
    });
  });
});
