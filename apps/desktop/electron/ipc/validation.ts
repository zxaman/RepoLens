import { failureResult, successResult, type Result } from '@repolens/shared';
import { z } from 'zod';
import { isAllowedIpcChannel, IPC_CHANNELS, type IpcChannel } from '../security/ipc-channels.js';

const noPayload = z.undefined();

const payloadSchemas = {
  [IPC_CHANNELS.appGetVersion]: noPayload,
  [IPC_CHANNELS.appGetPlatform]: noPayload,
  [IPC_CHANNELS.projectsList]: noPayload,
  [IPC_CHANNELS.scansGetStatus]: noPayload,
  [IPC_CHANNELS.settingsGet]: noPayload,
} satisfies Record<IpcChannel, typeof noPayload>;

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
