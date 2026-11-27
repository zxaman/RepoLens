import type { AppError } from '@repolens/shared';

export class ServiceError extends Error {
  constructor(
    readonly code: AppError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
