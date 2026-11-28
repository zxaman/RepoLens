import { DEFAULT_APP_SETTINGS, type RepoLensAPI } from '@repolens/shared';
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, IPC_EVENTS } from './security/ipc-channels.js';

const electronMocks = vi.hoisted(() => {
  const exposedWorld = new Map<string, unknown>();
  const defaultSettings = {
    theme: 'system',
    defaultProjectId: null,
    confirmBeforeRemovingProject: true,
    recentProjectsLimit: 10,
  };
  const eventListeners = new Map<string, (...args: unknown[]) => void>();
  const removeListener = vi.fn((channel: string) => eventListeners.delete(channel));
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

  return { exposedWorld, invoke, defaultSettings, eventListeners, removeListener };
});

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => electronMocks.exposedWorld.set(key, value),
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      electronMocks.eventListeners.set(channel, listener);
    },
    removeListener: electronMocks.removeListener,
  },
}));

import './preload.js';

describe('secure preload bridge', () => {
  it('exposes only typed, explicitly approved application capabilities', async () => {
    const rawApi = electronMocks.exposedWorld.get('repolens');
    expect(rawApi).toBeDefined();
    expect(electronMocks.exposedWorld.has('ipcRenderer')).toBe(false);

    const api = rawApi as RepoLensAPI;
    expect(Object.keys(api).sort()).toEqual([
      'analysis',
      'app',
      'graphs',
      'projects',
      'scans',
      'settings',
    ]);
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
    expect(Object.keys(api.analysis).sort()).toEqual(['cancel', 'onProgress', 'start']);
    expect(Object.keys(api.graphs).sort()).toEqual([
      'cycles',
      'dependencies',
      'dispose',
      'exportJson',
      'onProgress',
      'query',
      'shortestPath',
      'summary',
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
    await expect(
      api.analysis.start(
        'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
        '92370c1b-8755-4057-ae23-0d885ad4d94b',
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_IMPLEMENTED' } });
    await expect(
      api.analysis.cancel('7d707ca0-312b-4a6f-8950-8df3441d973a'),
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
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.analysisStart, {
      projectId: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
      scanId: '92370c1b-8755-4057-ae23-0d885ad4d94b',
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.analysisCancel, {
      analysisId: '7d707ca0-312b-4a6f-8950-8df3441d973a',
    });
    expect(electronMocks.invoke).toHaveBeenCalledWith(IPC_CHANNELS.settingsUpdate, settings);
  });

  it('subscribes to validated progress events and returns a cleanup function', () => {
    const api = electronMocks.exposedWorld.get('repolens') as RepoLensAPI;
    const callback = vi.fn();
    const unsubscribe = api.scans.onProgress(callback);
    const listener = electronMocks.eventListeners.get(IPC_EVENTS.scansProgress);
    const progress = {
      scanId: '92370c1b-8755-4057-ae23-0d885ad4d94b',
      projectId: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
      phase: 'walking',
      filesDiscovered: 3,
      filesProcessed: 0,
      directoriesProcessed: 1,
      totalBytesProcessed: 0,
    };

    expect(listener).toBeDefined();
    listener?.({}, progress);
    listener?.({}, { ...progress, currentPath: '../outside' });
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(progress);

    unsubscribe();
    expect(electronMocks.removeListener).toHaveBeenCalledWith(
      IPC_EVENTS.scansProgress,
      expect.any(Function),
    );
    expect(electronMocks.eventListeners.has(IPC_EVENTS.scansProgress)).toBe(false);

    const analysisCallback = vi.fn();
    const unsubscribeAnalysis = api.analysis.onProgress(analysisCallback);
    const analysisListener = electronMocks.eventListeners.get(IPC_EVENTS.analysisProgress);
    const analysisProgress = {
      analysisId: '7d707ca0-312b-4a6f-8950-8df3441d973a',
      scanId: '92370c1b-8755-4057-ae23-0d885ad4d94b',
      projectId: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
      phase: 'parsing',
      filesTotal: 1,
      filesProcessed: 0,
      currentPath: 'src/index.ts',
    };
    analysisListener?.({}, analysisProgress);
    analysisListener?.({}, { ...analysisProgress, currentPath: '../outside.ts' });
    expect(analysisCallback).toHaveBeenCalledOnce();
    expect(analysisCallback).toHaveBeenCalledWith(analysisProgress);
    unsubscribeAnalysis();
    expect(electronMocks.eventListeners.has(IPC_EVENTS.analysisProgress)).toBe(false);
  });
});
