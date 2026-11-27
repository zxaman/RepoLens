import { describe, expect, it } from 'vitest';
import { appSettingsSchema } from './app-settings.schema.js';
import { failureResult, resultSchema, successResult } from './result.schema.js';

const settingsResultSchema = resultSchema(appSettingsSchema);

describe('IPC result contracts', () => {
  it('validates successful typed results', () => {
    const result = successResult({ appearance: 'dark' as const });

    expect(settingsResultSchema.parse(result)).toEqual({
      ok: true,
      data: { appearance: 'dark' },
    });
  });

  it('validates explicit errors without disguising unavailable functionality as data', () => {
    const result = failureResult('NOT_IMPLEMENTED', 'Settings persistence is not available yet.');

    expect(settingsResultSchema.parse(result)).toMatchObject({
      ok: false,
      error: { code: 'NOT_IMPLEMENTED' },
    });
  });

  it('rejects malformed results', () => {
    expect(settingsResultSchema.safeParse({ ok: true, data: { appearance: 'neon' } }).success).toBe(
      false,
    );
  });
});
