import { contextBridge, ipcRenderer } from 'electron';
import { createRepoLensAPI } from './ipc/bridge.js';

const repoLensAPI = createRepoLensAPI({
  invoke: async (channel, payload) => {
    const response: unknown =
      payload === undefined
        ? await ipcRenderer.invoke(channel)
        : await ipcRenderer.invoke(channel, payload);
    return response;
  },
});

contextBridge.exposeInMainWorld('repolens', repoLensAPI);
