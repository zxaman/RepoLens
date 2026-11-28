import {
  analysisProgressSchema,
  analysisResultSchema,
  appErrorSchema,
  graphBuildProgressSchema,
  graphCycleReportSchema,
  graphDisposeResultSchema,
  graphExportJsonSchema,
  graphNodeQueryResultSchema,
  graphPathResultSchema,
  graphSummarySchema,
  graphTraversalResultSchema,
  appSettingsSchema,
  projectImportCommitResultSchema,
  projectImportResultSchema,
  projectSchema,
  scanHistoryItemSchema,
  scanProgressSchema,
  scanResultSchema,
  type AnalysisProgress,
  type AppSettings,
  type GraphBuildProgress,
  type GraphCycleQuery,
  type GraphDependencyQuery,
  type GraphNodeQuery,
  type GraphPathQuery,
  type RepoLensAPI,
  type Result,
  type ScanConfig,
  type ScanProgress,
} from '@repolens/shared';
import { z } from 'zod';
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type IpcChannel,
  type IpcEventChannel,
} from '../security/ipc-channels.js';

export interface IpcInvoker {
  invoke(channel: IpcChannel, payload?: object): Promise<unknown>;
}

export interface IpcEventSource {
  subscribe(channel: IpcEventChannel, listener: (payload: unknown) => void): () => void;
}

const versionSchema = z.string().min(1);
const platformSchema = z.string().min(1);
const projectListSchema = z.array(projectSchema).readonly();
const projectNullableSchema = projectSchema.nullable();
const projectRemovalSchema = z.object({ removed: z.literal(true) }).strict();
const cancelledOperationSchema = z.object({ cancelled: z.literal(true) }).strict();
const scanHistoryItemListSchema = z.array(scanHistoryItemSchema).readonly();
const scanHistoryItemNullableSchema = scanHistoryItemSchema.nullable();
const graphSummaryNullableSchema = graphSummarySchema.nullable();
const graphNodeQueryResultNullableSchema = graphNodeQueryResultSchema.nullable();
const graphTraversalResultNullableSchema = graphTraversalResultSchema.nullable();
const graphPathResultNullableSchema = graphPathResultSchema.nullable();
const graphCycleReportNullableSchema = graphCycleReportSchema.nullable();
const graphExportJsonNullableSchema = graphExportJsonSchema.nullable();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => key in value);
}

function parseResult<T>(value: unknown, dataSchema: z.ZodType<T>): Result<T> {
  if (!isRecord(value)) {
    throw new TypeError('Invalid result received from the Electron main process.');
  }

  if (value.ok === true && hasOnlyKeys(value, ['ok', 'data']) && 'data' in value) {
    return { ok: true, data: dataSchema.parse(value.data) };
  }

  if (value.ok === false && hasOnlyKeys(value, ['ok', 'error']) && 'error' in value) {
    return { ok: false, error: appErrorSchema.parse(value.error) };
  }

  throw new TypeError('Invalid result received from the Electron main process.');
}

function invokeValidated<T>(
  invoker: IpcInvoker,
  channel: IpcChannel,
  schema: z.ZodType<T>,
): Promise<T> {
  return invoker.invoke(channel).then((response) => schema.parse(response));
}

function invokeResult<T>(
  invoker: IpcInvoker,
  channel: IpcChannel,
  dataSchema: z.ZodType<T>,
  payload?: object,
): Promise<Result<T>> {
  const response =
    payload === undefined ? invoker.invoke(channel) : invoker.invoke(channel, payload);
  return response.then((value) => parseResult(value, dataSchema));
}

export function createRepoLensAPI(invoker: IpcInvoker, eventSource?: IpcEventSource): RepoLensAPI {
  return Object.freeze({
    app: Object.freeze({
      getVersion: () => invokeValidated(invoker, IPC_CHANNELS.appGetVersion, versionSchema),
      getPlatform: () => invokeValidated(invoker, IPC_CHANNELS.appGetPlatform, platformSchema),
    }),
    projects: Object.freeze({
      importFolder: () =>
        invokeResult(invoker, IPC_CHANNELS.projectsImportFolder, projectImportResultSchema),
      confirmImport: (selectionId: string) =>
        invokeResult(invoker, IPC_CHANNELS.projectsConfirmImport, projectImportCommitResultSchema, {
          selectionId,
        }),
      cancelImport: (selectionId: string) =>
        invokeResult(invoker, IPC_CHANNELS.projectsCancelImport, cancelledOperationSchema, {
          selectionId,
        }),
      list: () => invokeResult(invoker, IPC_CHANNELS.projectsList, projectListSchema),
      getById: (id: string) =>
        invokeResult(invoker, IPC_CHANNELS.projectsGetById, projectNullableSchema, { id }),
      getActive: () => invokeResult(invoker, IPC_CHANNELS.projectsGetActive, projectNullableSchema),
      setActive: (id: string) =>
        invokeResult(invoker, IPC_CHANNELS.projectsSetActive, projectSchema, { id }),
      remove: (id: string) =>
        invokeResult(invoker, IPC_CHANNELS.projectsRemove, projectRemovalSchema, { id }),
      refresh: (id: string) =>
        invokeResult(invoker, IPC_CHANNELS.projectsRefresh, projectSchema, { id }),
    }),
    scans: Object.freeze({
      start: (projectId: string, config?: ScanConfig) =>
        invokeResult(invoker, IPC_CHANNELS.scansStart, scanResultSchema, {
          projectId,
          ...(config === undefined ? {} : { config }),
        }),
      cancel: (scanId: string) =>
        invokeResult(invoker, IPC_CHANNELS.scansCancel, cancelledOperationSchema, { scanId }),
      onProgress: (callback: (progress: ScanProgress) => void) => {
        if (typeof callback !== 'function') {
          throw new TypeError('A scan progress callback must be a function.');
        }
        if (eventSource === undefined) {
          return () => undefined;
        }
        return eventSource.subscribe(IPC_EVENTS.scansProgress, (value) => {
          const progress = scanProgressSchema.safeParse(value);
          if (!progress.success) {
            return;
          }
          try {
            callback(progress.data);
          } catch {
            // A renderer listener must not interfere with the scanning worker.
          }
        });
      },
      getHistory: (projectId: string) =>
        invokeResult(invoker, IPC_CHANNELS.scansGetHistory, scanHistoryItemListSchema, {
          projectId,
        }),
      getLatest: (projectId: string) =>
        invokeResult(invoker, IPC_CHANNELS.scansGetLatest, scanHistoryItemNullableSchema, {
          projectId,
        }),
    }),
    analysis: Object.freeze({
      start: (projectId: string, scanId: string) =>
        invokeResult(invoker, IPC_CHANNELS.analysisStart, analysisResultSchema, {
          projectId,
          scanId,
        }),
      cancel: (analysisId: string) =>
        invokeResult(invoker, IPC_CHANNELS.analysisCancel, cancelledOperationSchema, {
          analysisId,
        }),
      onProgress: (callback: (progress: AnalysisProgress) => void) => {
        if (typeof callback !== 'function') {
          throw new TypeError('A static-analysis progress callback must be a function.');
        }
        if (eventSource === undefined) {
          return () => undefined;
        }
        return eventSource.subscribe(IPC_EVENTS.analysisProgress, (value) => {
          const progress = analysisProgressSchema.safeParse(value);
          if (!progress.success) {
            return;
          }
          try {
            callback(progress.data);
          } catch {
            // Renderer event observers cannot interrupt the analysis worker.
          }
        });
      },
    }),
    graphs: Object.freeze({
      onProgress: (callback: (progress: GraphBuildProgress) => void) => {
        if (typeof callback !== 'function') {
          throw new TypeError('A graph-build progress callback must be a function.');
        }
        if (eventSource === undefined) {
          return () => undefined;
        }
        return eventSource.subscribe(IPC_EVENTS.graphsProgress, (value) => {
          const progress = graphBuildProgressSchema.safeParse(value);
          if (!progress.success) {
            return;
          }
          try {
            callback(progress.data);
          } catch {
            // Renderer listeners cannot interrupt graph construction.
          }
        });
      },
      summary: (projectId: string) =>
        invokeResult(invoker, IPC_CHANNELS.graphsSummary, graphSummaryNullableSchema, {
          projectId,
        }),
      query: (projectId: string, query: GraphNodeQuery) =>
        invokeResult(invoker, IPC_CHANNELS.graphsQuery, graphNodeQueryResultNullableSchema, {
          projectId,
          query,
        }),
      dependencies: (projectId: string, query: GraphDependencyQuery) =>
        invokeResult(invoker, IPC_CHANNELS.graphsDependencies, graphTraversalResultNullableSchema, {
          projectId,
          query,
        }),
      shortestPath: (projectId: string, query: GraphPathQuery) =>
        invokeResult(invoker, IPC_CHANNELS.graphsShortestPath, graphPathResultNullableSchema, {
          projectId,
          query,
        }),
      cycles: (projectId: string, query: GraphCycleQuery = {}) =>
        invokeResult(invoker, IPC_CHANNELS.graphsCycles, graphCycleReportNullableSchema, {
          projectId,
          query,
        }),
      exportJson: (projectId: string) =>
        invokeResult(invoker, IPC_CHANNELS.graphsExportJson, graphExportJsonNullableSchema, {
          projectId,
        }),
      dispose: (projectId: string) =>
        invokeResult(invoker, IPC_CHANNELS.graphsDispose, graphDisposeResultSchema, {
          projectId,
        }),
    }),
    settings: Object.freeze({
      get: () => invokeResult(invoker, IPC_CHANNELS.settingsGet, appSettingsSchema),
      update: (settings: AppSettings) =>
        invokeResult(invoker, IPC_CHANNELS.settingsUpdate, appSettingsSchema, settings),
      reset: () => invokeResult(invoker, IPC_CHANNELS.settingsReset, appSettingsSchema),
    }),
  });
}
