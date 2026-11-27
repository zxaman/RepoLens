import { appSettingsSchema, type AppSettings } from '@repolens/shared';
import { ServiceError } from './service-error.js';
import type { ProjectRepository } from './project-repository.js';
import type { SettingsRepository } from './settings-repository.js';

export class AppSettingsService {
  constructor(
    private readonly settingsRepository: SettingsRepository,
    private readonly projects: ProjectRepository,
  ) {}

  async get(): Promise<AppSettings> {
    const settings = await this.settingsRepository.get();
    if (
      settings.defaultProjectId !== null &&
      (await this.projects.getById(settings.defaultProjectId)) === null
    ) {
      return this.settingsRepository.update({ ...settings, defaultProjectId: null });
    }
    return settings;
  }

  async update(settings: AppSettings): Promise<AppSettings> {
    const parsed = appSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      throw new ServiceError('INVALID_INPUT', 'The supplied settings are invalid.');
    }

    if (parsed.data.defaultProjectId !== null) {
      const defaultProject = await this.projects.getById(parsed.data.defaultProjectId);
      if (defaultProject === null) {
        throw new ServiceError('PROJECT_NOT_FOUND', 'Choose a registered project as the default.');
      }
      if (defaultProject.status === 'unavailable') {
        throw new ServiceError(
          'PROJECT_UNAVAILABLE',
          'An unavailable project cannot be the default.',
        );
      }
    }

    return this.settingsRepository.update(parsed.data);
  }

  reset(): Promise<AppSettings> {
    return this.settingsRepository.reset();
  }

  async clearDefaultProject(projectId: string): Promise<void> {
    const settings = await this.settingsRepository.get();
    if (settings.defaultProjectId === projectId) {
      await this.settingsRepository.update({ ...settings, defaultProjectId: null });
    }
  }

  async clearInvalidDefaultProject(): Promise<void> {
    const settings = await this.settingsRepository.get();
    if (settings.defaultProjectId === null) {
      return;
    }
    if ((await this.projects.getById(settings.defaultProjectId)) === null) {
      await this.settingsRepository.update({ ...settings, defaultProjectId: null });
    }
  }
}
