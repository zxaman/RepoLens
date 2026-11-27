export const IPC_CHANNELS = {
  appGetVersion: 'app:get-version',
  appGetPlatform: 'app:get-platform',
  projectsList: 'projects:list',
  scansGetStatus: 'scans:get-status',
  settingsGet: 'settings:get',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

const approvedChannels: ReadonlySet<string> = new Set(Object.values(IPC_CHANNELS));

export function isAllowedIpcChannel(channel: string): channel is IpcChannel {
  return approvedChannels.has(channel);
}
