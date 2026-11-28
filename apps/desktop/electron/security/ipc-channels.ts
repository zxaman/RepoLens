import type {
  AppSettings,
  GraphCycleQuery,
  GraphDependencyQuery,
  GraphGenerationRequest,
  GraphNeighborhoodQuery,
  GraphNodeQuery,
  GraphPathQuery,
  ScanConfig,
} from '@repolens/shared';

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
  scansStart: 'scans:start',
  scansCancel: 'scans:cancel',
  scansGetHistory: 'scans:get-history',
  scansGetLatest: 'scans:get-latest',
  analysisStart: 'analysis:start',
  analysisCancel: 'analysis:cancel',
  graphsGenerate: 'graphs:generate',
  graphsSummary: 'graphs:summary',
  graphsQuery: 'graphs:query',
  graphsNeighborhood: 'graphs:neighborhood',
  graphsDependencies: 'graphs:dependencies',
  graphsShortestPath: 'graphs:shortest-path',
  graphsCycles: 'graphs:cycles',
  graphsExportJson: 'graphs:export-json',
  graphsDispose: 'graphs:dispose',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsReset: 'settings:reset',
} as const;

export const IPC_EVENTS = {
  scansProgress: 'scans:progress',
  analysisProgress: 'analysis:progress',
  graphsProgress: 'graphs:progress',
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
export type IpcEventChannel = (typeof IPC_EVENTS)[keyof typeof IPC_EVENTS];

const approvedChannels: ReadonlySet<string> = new Set(Object.values(IPC_CHANNELS));
const approvedEventChannels: ReadonlySet<string> = new Set(Object.values(IPC_EVENTS));

export function isAllowedIpcChannel(channel: string): channel is IpcChannel {
  return approvedChannels.has(channel);
}

export function isAllowedIpcEventChannel(channel: string): channel is IpcEventChannel {
  return approvedEventChannels.has(channel);
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
  [IPC_CHANNELS.scansStart]: { readonly projectId: string; readonly config?: ScanConfig };
  [IPC_CHANNELS.scansCancel]: { readonly scanId: string };
  [IPC_CHANNELS.scansGetHistory]: { readonly projectId: string };
  [IPC_CHANNELS.scansGetLatest]: { readonly projectId: string };
  [IPC_CHANNELS.analysisStart]: { readonly projectId: string; readonly scanId: string };
  [IPC_CHANNELS.analysisCancel]: { readonly analysisId: string };
  [IPC_CHANNELS.graphsGenerate]: GraphGenerationRequest;
  [IPC_CHANNELS.graphsSummary]: { readonly projectId: string };
  [IPC_CHANNELS.graphsQuery]: { readonly projectId: string; readonly query: GraphNodeQuery };
  [IPC_CHANNELS.graphsNeighborhood]: {
    readonly projectId: string;
    readonly query: GraphNeighborhoodQuery;
  };
  [IPC_CHANNELS.graphsDependencies]: {
    readonly projectId: string;
    readonly query: GraphDependencyQuery;
  };
  [IPC_CHANNELS.graphsShortestPath]: { readonly projectId: string; readonly query: GraphPathQuery };
  [IPC_CHANNELS.graphsCycles]: {
    readonly projectId: string;
    readonly query?: GraphCycleQuery;
  };
  [IPC_CHANNELS.graphsExportJson]: { readonly projectId: string };
  [IPC_CHANNELS.graphsDispose]: { readonly projectId: string };
  [IPC_CHANNELS.settingsGet]: undefined;
  [IPC_CHANNELS.settingsUpdate]: AppSettings;
  [IPC_CHANNELS.settingsReset]: undefined;
}
