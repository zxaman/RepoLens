import { appSettingsSchema, failureResult, successResult, type Result } from '@repolens/shared';
import { z } from 'zod';
import { isAllowedIpcChannel, IPC_CHANNELS, type IpcChannel } from '../security/ipc-channels.js';

export const noPayloadIpcSchema = z.undefined();
export const projectIdPayloadSchema = z.object({ id: z.uuid() }).strict();
export const selectionIdPayloadSchema = z.object({ selectionId: z.uuid() }).strict();

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
  [IPC_CHANNELS.scansGetStatus]: noPayloadIpcSchema,
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
