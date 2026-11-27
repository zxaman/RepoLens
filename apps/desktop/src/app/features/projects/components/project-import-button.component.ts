import { Component, EventEmitter, inject, Input, Output, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Project, ProjectImportResult } from '@repolens/shared';
import { ProjectService, toUserMessage } from '../services/project.service';

@Component({
  selector: 'app-project-import-button',
  standalone: true,
  templateUrl: './project-import-button.component.html',
  styleUrl: './project-import-button.component.scss',
})
export class ProjectImportButtonComponent {
  private readonly projects = inject(ProjectService);
  private readonly router = inject(Router);
  @Input() label = 'Import Project';
  @Input() variant: 'primary' | 'secondary' = 'primary';
  @Output() registered = new EventEmitter<Project>();

  readonly busy = signal(false);
  readonly dialogState = signal<ProjectImportResult | null>(null);
  readonly error = signal('');

  async startImport(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      const result = await this.projects.importFolder();
      if (result.kind !== 'cancelled') {
        this.dialogState.set(result);
      }
    } catch (error) {
      this.error.set(toUserMessage(error, 'RepoLens could not open that folder. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  async addProject(): Promise<void> {
    const current = this.dialogState();
    if (current?.kind !== 'selected') {
      return;
    }

    this.error.set('');
    this.busy.set(true);
    try {
      const result = await this.projects.confirmImport(current.preview.selectionId);
      if (result.kind === 'duplicate') {
        this.dialogState.set(result);
        return;
      }
      await this.projects.openProject(result.project.id);
      this.dialogState.set(null);
      this.registered.emit(result.project);
      await this.router.navigate(['/projects', result.project.id]);
    } catch (error) {
      this.error.set(toUserMessage(error, 'RepoLens could not register that folder. Try again.'));
    } finally {
      this.busy.set(false);
    }
  }

  async cancelImport(): Promise<void> {
    const current = this.dialogState();
    this.dialogState.set(null);
    this.error.set('');
    if (current?.kind !== 'selected') {
      return;
    }

    try {
      await this.projects.cancelImport(current.preview.selectionId);
    } catch (error) {
      this.error.set(
        toUserMessage(error, 'The folder selection expired. Select the folder again.'),
      );
    }
  }

  async openDuplicate(): Promise<void> {
    const current = this.dialogState();
    if (current?.kind !== 'duplicate') {
      return;
    }

    this.busy.set(true);
    this.error.set('');
    try {
      await this.projects.openProject(current.project.id);
      this.dialogState.set(null);
      await this.router.navigate(['/projects', current.project.id]);
    } catch (error) {
      this.error.set(toUserMessage(error, 'RepoLens could not open that project.'));
    } finally {
      this.busy.set(false);
    }
  }

  closeDialog(): void {
    if (this.dialogState()?.kind === 'duplicate') {
      this.dialogState.set(null);
    }
  }
}
