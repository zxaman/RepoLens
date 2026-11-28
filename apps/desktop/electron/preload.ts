import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { createRepoLensAPI } from './ipc/bridge.js';
import type { IpcEventChannel } from './security/ipc-channels.js';

const repoLensAPI = createRepoLensAPI(
  {
    invoke: async (channel, payload) => {
      const response: unknown =
        payload === undefined
          ? await ipcRenderer.invoke(channel)
          : await ipcRenderer.invoke(channel, payload);
      return response;
    },
  },
  {
    subscribe: (channel: IpcEventChannel, listener: (payload: unknown) => void) => {
      const eventListener = (_event: IpcRendererEvent, payload: unknown): void => {
        listener(payload);
      };
      ipcRenderer.on(channel, eventListener);
      return () => ipcRenderer.removeListener(channel, eventListener);
    },
  },
);

contextBridge.exposeInMainWorld('repolens', repoLensAPI);
