import { describe, expect, it } from 'vitest';
import { createAppInfo } from './app-info.service.js';

describe('createAppInfo', () => {
  it('validates the runtime metadata supplied by Electron', () => {
    expect(createAppInfo({ name: 'RepoLens', version: '0.1.0', platform: 'linux' })).toEqual({
      name: 'RepoLens',
      version: '0.1.0',
      platform: 'linux',
    });
  });

  it('rejects missing runtime version metadata', () => {
    expect(() => createAppInfo({ name: 'RepoLens', version: '', platform: 'linux' })).toThrow();
  });
});
