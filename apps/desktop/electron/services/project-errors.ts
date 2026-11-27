import type { AppError } from '@repolens/shared';
import { ServiceError } from './service-error.js';

export function toProjectOperationError(error: unknown, operation: string): AppError {
  if (error instanceof ServiceError) {
    return { code: error.code, message: error.message };
  }

  if (error instanceof Error && 'code' in error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      return {
        code: 'PERMISSION_DENIED',
        message: 'RepoLens does not have permission to access that location.',
      };
    }
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return {
        code: 'INVALID_PROJECT_PATH',
        message: 'That project folder no longer exists or is not a directory.',
      };
    }
  }

  console.error(`RepoLens ${operation} failed.`, error);
  return {
    code: 'INTERNAL_ERROR',
    message: 'RepoLens could not complete that request. Check the location and try again.',
  };
}
