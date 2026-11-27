import { Component, computed, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SettingsService } from '../../settings/settings.service';
import { ProjectCardComponent } from '../components/project-card.component';
import { ProjectImportButtonComponent } from '../components/project-import-button.component';
import { ProjectService, toUserMessage } from '../services/project.service';

@Component({
  selector: 'app-welcome-page',
  standalone: true,
  imports: [ProjectCardComponent, ProjectImportButtonComponent, RouterLink],
  templateUrl: './welcome-page.component.html',
  styleUrl: './welcome-page.component.scss',
})
export class WelcomePageComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  private readonly settings = inject(SettingsService);
  readonly projects = this.projectService.projects;
  readonly activeProject = this.projectService.activeProject;
  readonly recentProjects = computed(() =>
    this.projects().slice(0, this.settings.settings().recentProjectsLimit),
  );
  readonly loading = signal(true);
  readonly error = signal('');

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      await Promise.all([this.projectService.loadProjects(), this.settings.load()]);
    } catch (error) {
      this.error.set(toUserMessage(error, 'RepoLens could not load your projects. Try again.'));
    } finally {
      this.loading.set(false);
    }
  }
}
