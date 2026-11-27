import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type RendererTrustPolicy =
  | { readonly mode: 'development'; readonly origin: string }
  | { readonly mode: 'file'; readonly filePath: string };

export function isTrustedRendererUrl(urlValue: string, policy: RendererTrustPolicy): boolean {
  let candidate: URL;

  try {
    candidate = new URL(urlValue);
  } catch {
    return false;
  }

  if (policy.mode === 'development') {
    let expected: URL;

    try {
      expected = new URL(policy.origin);
    } catch {
      return false;
    }

    const isLoopbackHost = expected.hostname === 'localhost' || expected.hostname === '127.0.0.1';
    const isAllowedOrigin =
      expected.protocol === 'http:' && expected.port === '4200' && isLoopbackHost;
    const hasNoCredentials = candidate.username === '' && candidate.password === '';

    return isAllowedOrigin && hasNoCredentials && candidate.origin === expected.origin;
  }

  if (candidate.protocol !== 'file:' || candidate.host !== '') {
    return false;
  }

  try {
    const candidatePath = normalizePath(fileURLToPath(candidate));
    const expectedPath = normalizePath(resolve(policy.filePath));
    return candidatePath === expectedPath;
  } catch {
    return false;
  }
}

export function isTrustedIpcInvocation(
  frameUrl: string | null,
  mainFrameUrl: string | null,
  policy: RendererTrustPolicy,
): boolean {
  return frameUrl !== null && frameUrl === mainFrameUrl && isTrustedRendererUrl(frameUrl, policy);
}

export function assertTrustedIpcInvocation(
  frameUrl: string | null,
  mainFrameUrl: string | null,
  policy: RendererTrustPolicy,
): void {
  if (!isTrustedIpcInvocation(frameUrl, mainFrameUrl, policy)) {
    throw new Error('Rejected IPC invocation from an untrusted renderer.');
  }
}

function normalizePath(path: string): string {
  const normalized = resolve(path);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
