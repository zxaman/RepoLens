import { DEFAULT_APP_SETTINGS, type RepoLensAPI } from '@repolens/shared';
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from './security/ipc-channels.js';

const electronMocks = vi.hoisted(() => {
  const exposedWorld = new Map<string, unknown>();
  const defaultSettings = {
    theme: 'system',
    defaultProjectId: null,
    confirmBeforeRemovingProject: true,
    recentProjectsLimit: 10,
  };
  const invoke = vi.fn(async (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (channel === 'app:get-version') {
      return '0.2.0';
    }
    if (channel === 'app:get-platform') {
      return 'linux';
    }
    if (channel === 'projects:import-folder') {
      return { ok: true, data: { kind: 'cancelled' } };
    }
    if (channel === 'settings:get' || channel === 'settings:reset') {
      return { ok: true, data: defaultSettings };
    }
    if (channel === 'settings:update') {
      return { ok: true, data: args[0] };
    }
    return {
      ok: false,
      error: { code: 'NOT_IMPLEMENTED', message: 'This operation is unavailable.' },
    };
  });

  return { exposedWorld, invoke, defaultSettings };
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
    expect(Object.keys(api.projects).sort()).toEqual([
      'cancelImport',
      'confirmImport',
      'getActive',
      'getById',
      'importFolder',
      'list',
      'refresh',
      'remove',
      'setActive',
    ]);
    expect('send' in api).toBe(false);
    expect('invoke' in api).toBe(false);

    await expect(api.app.getVersion()).resolves.toBe('0.2.0');
    await expect(api.app.getPlatform()).resolves.toBe('linux');
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.appGetVersion);
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.appGetPlatform);
  });

  it('validates responses and forwards only the intended project/settings calls', async () => {
    const api = electronMocks.exposedWorld.get('repolens') as RepoLensAPI;
    await expect(api.projects.importFolder()).resolves.toEqual({
      ok: true,
      data: { kind: 'cancelled' },
    });
    await expect(api.projects.list()).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_IMPLEMENTED' },
    });
    await expect(
      api.projects.setActive('a1b2c3d4-e5f6-47a8-9012-abcdef123456'),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_IMPLEMENTED' },
    });

    const settings = { ...DEFAULT_APP_SETTINGS, theme: 'light' as const };
    await expect(api.settings.get()).resolves.toEqual({ ok: true, data: DEFAULT_APP_SETTINGS });
    await expect(api.settings.update(settings)).resolves.toEqual({ ok: true, data: settings });
    await expect(api.settings.reset()).resolves.toEqual({ ok: true, data: DEFAULT_APP_SETTINGS });

    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.projectsSetActive, {
      id: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.settingsUpdate, settings);
  });
});
