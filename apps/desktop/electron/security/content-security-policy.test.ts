import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './content-security-policy.js';

describe('content security policy', () => {
  it('keeps packaged scripts local and blocks objects, frames, and forms', () => {
    const policy = buildContentSecurityPolicy(false);

    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toContain('https://');
  });

  it('allows only the local Angular development websocket in development', () => {
    const policy = buildContentSecurityPolicy(true);

    expect(policy).toContain('ws://127.0.0.1:4200');
    expect(policy).toContain('ws://localhost:4200');
    expect(policy).not.toContain('ws://example.com');
  });
});
