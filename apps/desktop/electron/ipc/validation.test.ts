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
