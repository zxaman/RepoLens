import { inject, Injectable, signal } from '@angular/core';
import {
  DEFAULT_APP_SETTINGS,
  type AppSettings,
  type RepoLensAPI,
  type Result,
} from '@repolens/shared';
import { ThemeService } from '../../services/theme.service';
import { RendererServiceError } from '../projects/services/project.service';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new RendererServiceError(result.error.message, result.error.code);
  }
  return result.data;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  readonly settings = signal<AppSettings>({ ...DEFAULT_APP_SETTINGS });
  readonly loaded = signal(false);

  private readonly theme = inject(ThemeService);

  async load(): Promise<AppSettings> {
    const settings = unwrap(await this.getBridge().settings.get());
    this.apply(settings);
    this.loaded.set(true);
    return settings;
  }

  async update(settings: AppSettings): Promise<AppSettings> {
    const saved = unwrap(await this.getBridge().settings.update(settings));
    this.apply(saved);
    this.loaded.set(true);
    return saved;
  }

  async reset(): Promise<AppSettings> {
    const saved = unwrap(await this.getBridge().settings.reset());
    this.apply(saved);
    this.loaded.set(true);
    return saved;
  }

  private apply(settings: AppSettings): void {
    this.settings.set(settings);
    this.theme.apply(settings.theme);
  }

  private getBridge(): RepoLensAPI {
    if (typeof window === 'undefined' || window.repolens === undefined) {
      throw new RendererServiceError(
        'Settings are available in the RepoLens desktop application.',
        'DESKTOP_RUNTIME_UNAVAILABLE',
      );
    }
    return window.repolens;
  }
}
