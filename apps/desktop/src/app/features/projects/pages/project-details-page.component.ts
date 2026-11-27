import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import type { OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConfirmRemoveDialogComponent } from '../components/confirm-remove-dialog.component';
import { ProjectService, toUserMessage } from '../services/project.service';
import { SettingsService } from '../../settings/settings.service';
import type { Project } from '@repolens/shared';

@Component({
  selector: 'app-project-details-page',
  standalone: true,
  imports: [DatePipe, RouterLink, ConfirmRemoveDialogComponent],
  templateUrl: './project-details-page.component.html',
  styleUrl: './project-details-page.component.scss',
})
export class ProjectDetailsPageComponent implements OnInit {
  readonly project = signal<Project | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly actionError = signal('');
  readonly removing = signal(false);
  readonly showRemoveConfirmation = signal(false);
  readonly confirmBeforeRemoving = signal(true);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly projectService = inject(ProjectService);
  private readonly settingsService = inject(SettingsService);

  ngOnInit(): void {
    void this.settingsService
      .load()
      .then((settings) => {
        this.confirmBeforeRemoving.set(settings.confirmBeforeRemovingProject);
      })
      .catch((error: unknown) => {
        this.actionError.set(toUserMessage(error, 'RepoLens could not load your settings.'));
      });

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      void this.loadProject(params.get('projectId'));
    });
  }

  async refresh(): Promise<void> {
    const current = this.project();
    if (current === null) {
      return;
    }
    this.actionError.set('');
    try {
      const updated = await this.projectService.refreshProject(current.id);
      this.project.set(updated);
      if (updated.status === 'registered') {
        await this.projectService.openProject(updated.id);
      }
    } catch (error) {
      this.actionError.set(toUserMessage(error, 'RepoLens could not refresh this project folder.'));
    }
  }

  requestRemove(): void {
    if (this.confirmBeforeRemoving()) {
      this.showRemoveConfirmation.set(true);
      return;
    }
    void this.removeCurrentProject();
  }

  async confirmRemove(): Promise<void> {
    this.showRemoveConfirmation.set(false);
    await this.removeCurrentProject();
  }

  closeRemoveDialog(): void {
    this.showRemoveConfirmation.set(false);
  }

  private async removeCurrentProject(): Promise<void> {
    const current = this.project();
    if (current === null) {
      return;
    }
    this.removing.set(true);
    this.actionError.set('');
    try {
      await this.projectService.removeProject(current.id);
      await this.router.navigate(['/projects']);
    } catch (error) {
      this.actionError.set(
        toUserMessage(error, 'RepoLens could not remove that project registration.'),
      );
    } finally {
      this.removing.set(false);
    }
  }

  private async loadProject(projectId: string | null): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    this.project.set(null);
    if (projectId === null) {
      this.error.set('This project link is invalid.');
      this.loading.set(false);
      return;
    }

    try {
      const project = await this.projectService.getProject(projectId);
      if (project === null) {
        this.error.set('This project is no longer registered.');
        return;
      }
      this.project.set(project);
      if (project.status === 'registered') {
        this.project.set(await this.projectService.openProject(project.id));
      }
    } catch (error) {
      this.error.set(toUserMessage(error, 'RepoLens could not load this project.'));
    } finally {
      this.loading.set(false);
    }
  }
}
