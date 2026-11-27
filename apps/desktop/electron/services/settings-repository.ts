import type { AppSettings } from '@repolens/shared';

export interface SettingsRepository {
  get(): Promise<AppSettings>;
  update(settings: AppSettings): Promise<AppSettings>;
  reset(): Promise<AppSettings>;
}
