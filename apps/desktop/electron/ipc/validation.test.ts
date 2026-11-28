import { describe, expect, it } from 'vitest';
import { IPC_CHANNELS, isAllowedIpcChannel } from '../security/ipc-channels.js';
import { validateIpcPayload } from './validation.js';

describe('IPC validation', () => {
  it('allows only declared channels and their expected no-payload shape', () => {
    expect(isAllowedIpcChannel(IPC_CHANNELS.appGetVersion)).toBe(true);
    expect(validateIpcPayload(IPC_CHANNELS.appGetVersion, undefined)).toEqual({
      ok: true,
      data: undefined,
    });
  });

  it('accepts only UUID project and scan identifiers for static analysis', () => {
    expect(
      validateIpcPayload(IPC_CHANNELS.analysisStart, {
        projectId: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
        scanId: '92370c1b-8755-4057-ae23-0d885ad4d94b',
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateIpcPayload(IPC_CHANNELS.analysisStart, {
        projectId: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
        scanId: '../outside',
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(
      validateIpcPayload(IPC_CHANNELS.analysisCancel, {
        analysisId: '7d707ca0-312b-4a6f-8950-8df3441d973a',
        rootPath: '/tmp',
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('rejects unexpected payloads and unapproved channel names', () => {
    expect(validateIpcPayload(IPC_CHANNELS.projectsList, { path: '/tmp' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(isAllowedIpcChannel('node:fs')).toBe(false);
    expect(validateIpcPayload('node:fs', undefined)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
  });
});
