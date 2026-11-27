import { Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AppSettings, Project } from '@repolens/shared';
import { DEFAULT_APP_SETTINGS } from '@repolens/shared';
import { ProjectService, toUserMessage } from '../projects/services/project.service';
import { SettingsService } from './settings.service';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.scss',
})
export class SettingsPageComponent implements OnInit {
  private readonly settingsService = inject(SettingsService);
  private readonly projectService = inject(ProjectService);
  readonly settingsLoaded = this.settingsService.loaded;
  readonly settings = signal<AppSettings>({ ...DEFAULT_APP_SETTINGS });
  readonly projects = signal<readonly Project[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly savedMessage = signal('');

  ngOnInit(): void {
    void this.load();
  }

  updateTheme(theme: AppSettings['theme']): void {
    this.settings.update((current) => ({ ...current, theme }));
    this.savedMessage.set('');
  }

  updateDefaultProject(value: string): void {
    this.settings.update((current) => ({ ...current, defaultProjectId: value || null }));
    this.savedMessage.set('');
  }

  updateConfirmBeforeRemoving(value: boolean): void {
    this.settings.update((current) => ({ ...current, confirmBeforeRemovingProject: value }));
    this.savedMessage.set('');
  }

  updateRecentLimit(value: number): void {
    this.settings.update((current) => ({ ...current, recentProjectsLimit: Number(value) }));
    this.savedMessage.set('');
  }

  async save(): Promise<void> {
    const current = this.settings();
    if (
      !Number.isInteger(current.recentProjectsLimit) ||
      current.recentProjectsLimit < 1 ||
      current.recentProjectsLimit > 50
    ) {
      this.error.set('Recent projects limit must be a whole number between 1 and 50.');
      return;
    }

    this.saving.set(true);
    this.error.set('');
    this.savedMessage.set('');
    try {
      const saved = await this.settingsService.update(current);
      this.settings.set(saved);
      this.savedMessage.set('Settings saved.');
    } catch (error) {
      this.error.set(toUserMessage(error, 'RepoLens could not save your settings.'));
    } finally {
      this.saving.set(false);
    }
  }

  async reset(): Promise<void> {
    this.saving.set(true);
    this.error.set('');
    this.savedMessage.set('');
    try {
      const defaults = await this.settingsService.reset();
      this.settings.set(defaults);
      this.savedMessage.set('Settings restored to defaults.');
    } catch (error) {
      this.error.set(toUserMessage(error, 'RepoLens could not reset your settings.'));
    } finally {
      this.saving.set(false);
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [settings, projects] = await Promise.all([
        this.settingsService.load(),
        this.projectService.loadProjects(),
      ]);
      this.settings.set(settings);
      this.projects.set(projects);
    } catch (error) {
      this.error.set(toUserMessage(error, 'RepoLens could not load your settings.'));
    } finally {
      this.loading.set(false);
    }
  }
}
