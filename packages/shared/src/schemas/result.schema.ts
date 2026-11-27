import { z } from 'zod';

export const appErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'NOT_IMPLEMENTED',
  'PERMISSION_DENIED',
  'INTERNAL_ERROR',
  'PROJECT_NOT_FOUND',
  'PROJECT_ALREADY_REGISTERED',
  'PROJECT_UNAVAILABLE',
  'INVALID_PROJECT_PATH',
  'PROHIBITED_PATH',
  'REGISTRY_CORRUPT',
  'STORAGE_FAILURE',
  'SELECTION_EXPIRED',
]);

export const appErrorSchema = z
  .object({
    code: appErrorCodeSchema,
    message: z.string().min(1),
  })
  .strict();

export type AppError = z.infer<typeof appErrorSchema>;

export type Result<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: AppError };

export function resultSchema<T>(dataSchema: z.ZodType<T>): z.ZodType<Result<T>> {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data: dataSchema }).strict(),
    z.object({ ok: z.literal(false), error: appErrorSchema }).strict(),
  ]) as z.ZodType<Result<T>>;
}

export function successResult<T>(data: T): Result<T> {
  return { ok: true, data };
}

export function failureResult<T>(code: AppError['code'], message: string): Result<T> {
  return { ok: false, error: { code, message } };
}
