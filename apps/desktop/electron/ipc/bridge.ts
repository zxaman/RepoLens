import {
  appErrorSchema,
  appSettingsSchema,
  projectSchema,
  scanSummarySchema,
  type Project,
  type RepoLensAPI,
  type Result,
  type ScanSummary,
} from '@repolens/shared';
import { z } from 'zod';
import { IPC_CHANNELS, type IpcChannel } from '../security/ipc-channels.js';

export interface IpcInvoker {
  invoke(channel: IpcChannel): Promise<unknown>;
}

const versionSchema = z.string().min(1);
const platformSchema = z.string().min(1);
const projectsSchema: z.ZodType<readonly Project[]> = z.array(projectSchema).readonly();
const scanStatusSchema: z.ZodType<ScanSummary | null> = scanSummarySchema.nullable();

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
): Promise<Result<T>> {
  return invoker.invoke(channel).then((response) => parseResult(response, dataSchema));
}

export function createRepoLensAPI(invoker: IpcInvoker): RepoLensAPI {
  return Object.freeze({
    app: Object.freeze({
      getVersion: () => invokeValidated(invoker, IPC_CHANNELS.appGetVersion, versionSchema),
      getPlatform: () => invokeValidated(invoker, IPC_CHANNELS.appGetPlatform, platformSchema),
    }),
    projects: Object.freeze({
      list: () => invokeResult(invoker, IPC_CHANNELS.projectsList, projectsSchema),
    }),
    scans: Object.freeze({
      getStatus: () => invokeResult(invoker, IPC_CHANNELS.scansGetStatus, scanStatusSchema),
    }),
    settings: Object.freeze({
      get: () => invokeResult(invoker, IPC_CHANNELS.settingsGet, appSettingsSchema),
    }),
  });
}
