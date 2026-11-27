import type { AppSettings } from '@repolens/shared';

export const IPC_CHANNELS = {
  appGetVersion: 'app:get-version',
  appGetPlatform: 'app:get-platform',
  projectsImportFolder: 'projects:import-folder',
  projectsConfirmImport: 'projects:confirm-import',
  projectsCancelImport: 'projects:cancel-import',
  projectsList: 'projects:list',
  projectsGetById: 'projects:get-by-id',
  projectsGetActive: 'projects:get-active',
  projectsSetActive: 'projects:set-active',
  projectsRemove: 'projects:remove',
  projectsRefresh: 'projects:refresh',
  scansGetStatus: 'scans:get-status',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

const approvedChannels: ReadonlySet<string> = new Set(Object.values(IPC_CHANNELS));

export function isAllowedIpcChannel(channel: string): channel is IpcChannel {
  return approvedChannels.has(channel);
}

export interface IpcPayloadByChannel {
  [IPC_CHANNELS.appGetVersion]: undefined;
  [IPC_CHANNELS.appGetPlatform]: undefined;
  [IPC_CHANNELS.projectsImportFolder]: undefined;
  [IPC_CHANNELS.projectsConfirmImport]: { readonly selectionId: string };
  [IPC_CHANNELS.projectsCancelImport]: { readonly selectionId: string };
  [IPC_CHANNELS.projectsList]: undefined;
  [IPC_CHANNELS.projectsGetById]: { readonly id: string };
  [IPC_CHANNELS.projectsGetActive]: undefined;
  [IPC_CHANNELS.projectsSetActive]: { readonly id: string };
  [IPC_CHANNELS.projectsRemove]: { readonly id: string };
  [IPC_CHANNELS.projectsRefresh]: { readonly id: string };
  [IPC_CHANNELS.scansGetStatus]: undefined;
  [IPC_CHANNELS.settingsGet]: undefined;
  [IPC_CHANNELS.settingsUpdate]: AppSettings;
  [IPC_CHANNELS.settingsReset]: undefined;
}
