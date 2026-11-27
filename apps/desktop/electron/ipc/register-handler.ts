import { failureResult, type AppError, type Result } from '@repolens/shared';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { IpcChannel } from '../security/ipc-channels.js';
import { schemaForChannel, validateIpcPayload } from './validation.js';

export type IpcSenderGuard = (event: IpcMainInvokeEvent) => void;

export function registerValidatedHandler<TPayload, TResult>(
  ipcMain: Pick<IpcMain, 'handle'>,
  channel: IpcChannel,
  senderGuard: IpcSenderGuard,
  payloadSchema: z.ZodType<TPayload>,
  handler: (payload: TPayload) => TResult | Promise<TResult>,
  invalidPayloadResult?: (error: AppError) => TResult,
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    senderGuard(event);

    const payload: unknown = args.length === 0 ? undefined : args.length === 1 ? args[0] : args;
    const validation = validateIpcPayload(channel, payload);
    if (!validation.ok) {
      if (invalidPayloadResult !== undefined) {
        return invalidPayloadResult(validation.error);
      }
      throw new TypeError(validation.error.message);
    }

    const parsedPayload = payloadSchema.parse(validation.data);
    return handler(parsedPayload);
  });
}

export function invalidPayloadAsResult<T>(): (error: AppError) => Result<T> {
  return (error) => failureResult(error.code, error.message);
}

export function noPayloadSchema(): z.ZodType<undefined> {
  return schemaForChannel('app:get-version') as z.ZodType<undefined>;
}
