import {
  appErrorSchema,
  appSettingsSchema,
  projectImportCommitResultSchema,
  projectImportResultSchema,
  projectSchema,
  scanSummarySchema,
  type AppSettings,
  type RepoLensAPI,
  type Result,
  type ScanSummary,
} from '@repolens/shared';
import { z } from 'zod';
import { IPC_CHANNELS, type IpcChannel } from '../security/ipc-channels.js';

export interface IpcInvoker {
  invoke(channel: IpcChannel, payload?: object): Promise<unknown>;
}

const versionSchema = z.string().min(1);
const platformSchema = z.string().min(1);
const projectListSchema = z.array(projectSchema).readonly();
const projectNullableSchema = projectSchema.nullable();
const projectRemovalSchema = z.object({ removed: z.literal(true) }).strict();
const cancelledImportSchema = z.object({ cancelled: z.literal(true) }).strict();

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

export function createRepoLensAPI(invoker: IpcInvoker): RepoLensAPI {
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
        invokeResult(invoker, IPC_CHANNELS.projectsCancelImport, cancelledImportSchema, {
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
      getStatus: (): Promise<Result<ScanSummary | null>> =>
        invokeResult(invoker, IPC_CHANNELS.scansGetStatus, scanSummarySchema.nullable()),
    }),
    settings: Object.freeze({
      get: () => invokeResult(invoker, IPC_CHANNELS.settingsGet, appSettingsSchema),
      update: (settings: AppSettings) =>
        invokeResult(invoker, IPC_CHANNELS.settingsUpdate, appSettingsSchema, settings),
      reset: () => invokeResult(invoker, IPC_CHANNELS.settingsReset, appSettingsSchema),
    }),
  });
}
