import { contextBridge, ipcRenderer } from 'electron';
import { createRepoLensAPI } from './ipc/bridge.js';

const repoLensAPI = createRepoLensAPI({
  invoke: async (channel) => {
    const response: unknown = await ipcRenderer.invoke(channel);
    return response;
  },
});

contextBridge.exposeInMainWorld('repolens', repoLensAPI);
