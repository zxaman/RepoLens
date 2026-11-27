import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertTrustedIpcInvocation,
  isTrustedIpcInvocation,
  isTrustedRendererUrl,
  type RendererTrustPolicy,
} from './sender-validation.js';

const developmentPolicy: RendererTrustPolicy = {
  mode: 'development',
  origin: 'http://127.0.0.1:4200',
};

describe('renderer sender validation', () => {
  it('accepts only the configured local development origin', () => {
    expect(isTrustedRendererUrl('http://127.0.0.1:4200/', developmentPolicy)).toBe(true);
    expect(isTrustedRendererUrl('http://127.0.0.1:4201/', developmentPolicy)).toBe(false);
    expect(isTrustedRendererUrl('https://127.0.0.1:4200/', developmentPolicy)).toBe(false);
    expect(isTrustedRendererUrl('https://attacker.example/', developmentPolicy)).toBe(false);
    expect(isTrustedRendererUrl('http://user@127.0.0.1:4200/', developmentPolicy)).toBe(false);
  });

  it('requires an invocation from the trusted top-level frame', () => {
    expect(
      isTrustedIpcInvocation('http://127.0.0.1:4200/', 'http://127.0.0.1:4200/', developmentPolicy),
    ).toBe(true);
    expect(
      isTrustedIpcInvocation(
        'http://127.0.0.1:4200/child',
        'http://127.0.0.1:4200/',
        developmentPolicy,
      ),
    ).toBe(false);
    expect(() =>
      assertTrustedIpcInvocation(
        'https://attacker.example/',
        'https://attacker.example/',
        developmentPolicy,
      ),
    ).toThrow(/untrusted renderer/i);
  });

  it('matches packaged file renderers to the exact built index file', () => {
    const rendererPath = '/opt/repolens/dist/renderer/browser/index.html';
    const filePolicy: RendererTrustPolicy = { mode: 'file', filePath: rendererPath };

    expect(isTrustedRendererUrl(pathToFileURL(rendererPath).href, filePolicy)).toBe(true);
    expect(
      isTrustedRendererUrl(
        pathToFileURL('/opt/repolens/dist/renderer/browser/other.html').href,
        filePolicy,
      ),
    ).toBe(false);
    expect(isTrustedRendererUrl('https://example.com/index.html', filePolicy)).toBe(false);
  });
});
