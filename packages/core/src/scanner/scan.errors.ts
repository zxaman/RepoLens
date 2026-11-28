import type { ScanError } from '@repolens/shared';
import type { ScanCancellation } from './scan.types.js';

export class ScanCancelledError extends Error {
  constructor() {
    super('The scan was cancelled.');
    this.name = 'ScanCancelledError';
  }
}

export class ScanRootError extends Error {
  constructor(
    readonly code: ScanError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ScanRootError';
  }
}

export class ScanFileSystemError extends Error {
  constructor(
    readonly code: 'FILE_TOO_LARGE' | 'PERMISSION_DENIED' | 'ROOT_UNAVAILABLE' | 'IO_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'ScanFileSystemError';
  }
}

export function throwIfScanCancelled(signal: ScanCancellation): void {
  if (signal.aborted) {
    throw new ScanCancelledError();
  }
}

export function isScanCancelled(error: unknown, signal: ScanCancellation): boolean {
  return signal.aborted || error instanceof ScanCancelledError;
}

export function toScanError(error: unknown): ScanError {
  if (error instanceof ScanRootError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof ScanFileSystemError && error.code === 'PERMISSION_DENIED') {
    return {
      code: 'PERMISSION_DENIED',
      message: 'RepoLens does not have permission to read the selected project folder.',
    };
  }
  if (isNodeError(error)) {
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return {
        code: 'PERMISSION_DENIED',
        message: 'RepoLens does not have permission to read the selected project folder.',
      };
    }
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return {
        code: 'ROOT_UNAVAILABLE',
        message: 'The project folder is no longer available.',
      };
    }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'RepoLens could not complete the scan. Check the project folder and try again.',
  };
}

export function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

function isNodeError(error: unknown): error is Error & { readonly code: string } {
  return error instanceof Error && 'code' in error && typeof error.code === 'string';
}
