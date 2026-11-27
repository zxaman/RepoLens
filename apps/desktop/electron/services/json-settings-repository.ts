import { appSettingsSchema, DEFAULT_APP_SETTINGS, type AppSettings } from '@repolens/shared';
import { atomicWriteJson, readValidatedJson } from './atomic-json-file.js';
import { ServiceError } from './service-error.js';
import type { SettingsRepository } from './settings-repository.js';

export class JsonSettingsRepository implements SettingsRepository {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly settingsPath: string) {}

  get(): Promise<AppSettings> {
    return this.exclusive(() => this.readSettings());
  }

  update(settings: AppSettings): Promise<AppSettings> {
    return this.exclusive(async () => {
      const parsed = appSettingsSchema.safeParse(settings);
      if (!parsed.success) {
        throw new ServiceError('INVALID_INPUT', 'The supplied settings are invalid.');
      }
      await atomicWriteJson(this.settingsPath, parsed.data);
      return parsed.data;
    });
  }

  reset(): Promise<AppSettings> {
    return this.update(DEFAULT_APP_SETTINGS);
  }

  private readSettings(): Promise<AppSettings> {
    return readValidatedJson(
      this.settingsPath,
      appSettingsSchema,
      { ...DEFAULT_APP_SETTINGS },
      'application settings',
    );
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
