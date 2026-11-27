import { Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AppInfoService } from './app-info.service';
import { ProjectService } from './features/projects/services/project.service';
import { SettingsService } from './features/settings/settings.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  protected readonly appVersion = signal('—');
  protected readonly activeProject: ProjectService['activeProject'];
  private readonly appInfo = inject(AppInfoService);
  private readonly projectService = inject(ProjectService);
  private readonly settingsService = inject(SettingsService);

  constructor() {
    this.activeProject = this.projectService.activeProject;
  }

  ngOnInit(): void {
    void this.loadApplicationVersion();
    void this.initializeDesktopState();
  }

  private async loadApplicationVersion(): Promise<void> {
    try {
      const version = await this.appInfo.getVersion();
      this.appVersion.set(version ?? 'Unavailable');
    } catch {
      this.appVersion.set('Unavailable');
    }
  }

  private async initializeDesktopState(): Promise<void> {
    if (typeof window === 'undefined' || window.repolens === undefined) {
      return;
    }

    try {
      const [settings, active] = await Promise.all([
        this.settingsService.load(),
        this.projectService.loadActiveProject(),
      ]);
      if (settings.defaultProjectId !== null && active?.id !== settings.defaultProjectId) {
        try {
          await this.projectService.openProject(settings.defaultProjectId);
        } catch (error) {
          console.error('Could not select the preferred RepoLens project.', error);
        }
      }
    } catch (error) {
      console.error('Could not initialize RepoLens application state.', error);
    }
  }
}
