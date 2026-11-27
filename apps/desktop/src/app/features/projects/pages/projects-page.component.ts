import { Component, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import type { Project } from '@repolens/shared';
import { SettingsService } from '../../settings/settings.service';
import { ConfirmRemoveDialogComponent } from '../components/confirm-remove-dialog.component';
import { ProjectCardComponent } from '../components/project-card.component';
import { ProjectImportButtonComponent } from '../components/project-import-button.component';
import { ProjectService, toUserMessage } from '../services/project.service';

@Component({
  selector: 'app-projects-page',
  standalone: true,
  imports: [ProjectCardComponent, ConfirmRemoveDialogComponent, ProjectImportButtonComponent],
  templateUrl: './projects-page.component.html',
  styleUrl: './projects-page.component.scss',
})
export class ProjectsPageComponent implements OnInit {
  private readonly projectService = inject(ProjectService);
  private readonly settings = inject(SettingsService);
  readonly projects = this.projectService.projects;
  readonly activeProject = this.projectService.activeProject;
  readonly loading = signal(true);
  readonly error = signal('');
  readonly projectToRemove = signal<Project | null>(null);
  readonly removing = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  requestRemove(projectId: string): void {
    const project = this.projects().find((candidate) => candidate.id === projectId);
    if (project === undefined) {
      return;
    }
    if (this.settings.settings().confirmBeforeRemovingProject) {
      this.projectToRemove.set(project);
      return;
    }
    void this.remove(project);
  }

  cancelRemove(): void {
    this.projectToRemove.set(null);
  }

  async confirmRemove(): Promise<void> {
    const project = this.projectToRemove();
    if (project === null) {
      return;
    }
    await this.remove(project);
    this.projectToRemove.set(null);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      await Promise.all([this.projectService.loadProjects(), this.settings.load()]);
    } catch (error) {
      this.error.set(toUserMessage(error, 'RepoLens could not load your project registry.'));
    } finally {
      this.loading.set(false);
    }
  }

  private async remove(project: Project): Promise<void> {
    this.error.set('');
    this.removing.set(true);
    try {
      await this.projectService.removeProject(project.id);
    } catch (error) {
      this.error.set(toUserMessage(error, 'RepoLens could not remove that project registration.'));
    } finally {
      this.removing.set(false);
    }
  }
}
