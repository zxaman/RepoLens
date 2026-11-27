import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, appSettingsSchema } from './app-settings.schema.js';
import { failureResult, resultSchema, successResult } from './result.schema.js';

const settingsResultSchema = resultSchema(appSettingsSchema);

describe('IPC result contracts', () => {
  it('validates successful typed results', () => {
    const result = successResult({ ...DEFAULT_APP_SETTINGS, theme: 'dark' as const });

    expect(settingsResultSchema.parse(result)).toEqual({
      ok: true,
      data: { ...DEFAULT_APP_SETTINGS, theme: 'dark' },
    });
  });

  it('validates explicit errors without disguising unavailable functionality as data', () => {
    const result = failureResult('PROJECT_NOT_FOUND', 'That project is no longer registered.');

    expect(settingsResultSchema.parse(result)).toMatchObject({
      ok: false,
      error: { code: 'PROJECT_NOT_FOUND' },
    });
  });

  it('rejects malformed results and settings', () => {
    expect(
      settingsResultSchema.safeParse({
        ok: true,
        data: { ...DEFAULT_APP_SETTINGS, theme: 'neon' },
      }).success,
    ).toBe(false);
    expect(
      appSettingsSchema.safeParse({ ...DEFAULT_APP_SETTINGS, recentProjectsLimit: 0 }).success,
    ).toBe(false);
  });
});
