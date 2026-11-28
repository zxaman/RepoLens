import {
  appSettingsSchema,
  failureResult,
  scanConfigSchema,
  successResult,
  type Result,
} from '@repolens/shared';
import { z } from 'zod';
import { isAllowedIpcChannel, IPC_CHANNELS, type IpcChannel } from '../security/ipc-channels.js';

export const noPayloadIpcSchema = z.undefined();
export const projectIdPayloadSchema = z.object({ id: z.uuid() }).strict();
export const selectionIdPayloadSchema = z.object({ selectionId: z.uuid() }).strict();
export const scanIdPayloadSchema = z.object({ scanId: z.uuid() }).strict();
export const projectScanPayloadSchema = z
  .object({
    projectId: z.uuid(),
    config: scanConfigSchema.optional(),
  })
  .strict();

export const projectScanIdPayloadSchema = z.object({ projectId: z.uuid() }).strict();
export const analysisStartPayloadSchema = z
  .object({ projectId: z.uuid(), scanId: z.uuid() })
  .strict();
export const analysisIdPayloadSchema = z.object({ analysisId: z.uuid() }).strict();

const payloadSchemas: Record<IpcChannel, z.ZodType> = {
  [IPC_CHANNELS.appGetVersion]: noPayloadIpcSchema,
  [IPC_CHANNELS.appGetPlatform]: noPayloadIpcSchema,
  [IPC_CHANNELS.projectsImportFolder]: noPayloadIpcSchema,
  [IPC_CHANNELS.projectsConfirmImport]: selectionIdPayloadSchema,
  [IPC_CHANNELS.projectsCancelImport]: selectionIdPayloadSchema,
  [IPC_CHANNELS.projectsList]: noPayloadIpcSchema,
  [IPC_CHANNELS.projectsGetById]: projectIdPayloadSchema,
  [IPC_CHANNELS.projectsGetActive]: noPayloadIpcSchema,
  [IPC_CHANNELS.projectsSetActive]: projectIdPayloadSchema,
  [IPC_CHANNELS.projectsRemove]: projectIdPayloadSchema,
  [IPC_CHANNELS.projectsRefresh]: projectIdPayloadSchema,
  [IPC_CHANNELS.scansStart]: projectScanPayloadSchema,
  [IPC_CHANNELS.scansCancel]: scanIdPayloadSchema,
  [IPC_CHANNELS.scansGetHistory]: projectScanIdPayloadSchema,
  [IPC_CHANNELS.scansGetLatest]: projectScanIdPayloadSchema,
  [IPC_CHANNELS.analysisStart]: analysisStartPayloadSchema,
  [IPC_CHANNELS.analysisCancel]: analysisIdPayloadSchema,
  [IPC_CHANNELS.settingsGet]: noPayloadIpcSchema,
  [IPC_CHANNELS.settingsUpdate]: appSettingsSchema,
  [IPC_CHANNELS.settingsReset]: noPayloadIpcSchema,
};

export function validateIpcPayload(channel: string, payload: unknown): Result<unknown> {
  if (!isAllowedIpcChannel(channel)) {
    return failureResult('INVALID_INPUT', 'The requested IPC channel is not approved.');
  }

  const parsedPayload = payloadSchemas[channel].safeParse(payload);
  if (!parsedPayload.success) {
    return failureResult('INVALID_INPUT', `Invalid payload for IPC channel: ${channel}.`);
  }

  return successResult(parsedPayload.data);
}

export function schemaForChannel(channel: IpcChannel): z.ZodType {
  return payloadSchemas[channel];
}
