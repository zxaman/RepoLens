import { Injectable, signal } from '@angular/core';
import type {
  Project,
  ProjectImportCommitResult,
  ProjectImportResult,
  RepoLensAPI,
  Result,
} from '@repolens/shared';

export class RendererServiceError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'RendererServiceError';
  }
}

export function toUserMessage(error: unknown, fallback: string): string {
  return error instanceof RendererServiceError ? error.message : fallback;
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new RendererServiceError(result.error.message, result.error.code);
  }
  return result.data;
}

@Injectable({ providedIn: 'root' })
export class ProjectService {
  readonly projects = signal<readonly Project[]>([]);
  readonly activeProject = signal<Project | null>(null);
  private activeProjectRevision = 0;
  private projectListRevision = 0;

  async loadProjects(): Promise<readonly Project[]> {
    const activeRevision = this.activeProjectRevision;
    const listRevision = this.projectListRevision;
    const api = this.getBridge();
    const projects = unwrap(await api.projects.list());
    const activeProject = unwrap(await api.projects.getActive());
    if (listRevision === this.projectListRevision) {
      this.projects.set(projects);
      this.projectListRevision += 1;
    }
    if (activeRevision === this.activeProjectRevision) {
      this.activeProject.set(activeProject);
    }
    return projects;
  }

  async getProject(id: string): Promise<Project | null> {
    return unwrap(await this.getBridge().projects.getById(id));
  }

  async loadActiveProject(): Promise<Project | null> {
    const requestRevision = ++this.activeProjectRevision;
    const active = unwrap(await this.getBridge().projects.getActive());
    if (requestRevision === this.activeProjectRevision) {
      this.activeProject.set(active);
      this.activeProjectRevision += 1;
    }
    return active;
  }

  async openProject(id: string): Promise<Project> {
    const requestRevision = ++this.activeProjectRevision;
    const project = unwrap(await this.getBridge().projects.setActive(id));
    if (requestRevision === this.activeProjectRevision) {
      this.activeProject.set(project);
      this.activeProjectRevision += 1;
    }
    this.upsert(project);
    return project;
  }

  async importFolder(): Promise<ProjectImportResult> {
    return unwrap(await this.getBridge().projects.importFolder());
  }

  async confirmImport(selectionId: string): Promise<ProjectImportCommitResult> {
    const result = unwrap(await this.getBridge().projects.confirmImport(selectionId));
    if (result.kind === 'created') {
      this.upsert(result.project);
    }
    return result;
  }

  async cancelImport(selectionId: string): Promise<void> {
    unwrap(await this.getBridge().projects.cancelImport(selectionId));
  }

  async removeProject(id: string): Promise<void> {
    const requestRevision = ++this.activeProjectRevision;
    this.projectListRevision += 1;
    unwrap(await this.getBridge().projects.remove(id));
    if (this.activeProject()?.id === id) {
      this.activeProject.set(null);
      this.activeProjectRevision += 1;
    } else if (requestRevision === this.activeProjectRevision) {
      this.activeProjectRevision += 1;
    }
    this.projects.update((projects) => projects.filter((project) => project.id !== id));
    this.projectListRevision += 1;
  }

  async refreshProject(id: string): Promise<Project> {
    const project = unwrap(await this.getBridge().projects.refresh(id));
    this.upsert(project);
    return project;
  }

  private getBridge(): RepoLensAPI {
    if (typeof window === 'undefined' || window.repolens === undefined) {
      throw new RendererServiceError(
        'Project management is available in the RepoLens desktop application.',
        'DESKTOP_RUNTIME_UNAVAILABLE',
      );
    }
    return window.repolens;
  }

  private upsert(project: Project): void {
    this.projectListRevision += 1;
    this.projects.update((projects) => {
      const exists = projects.some((candidate) => candidate.id === project.id);
      const updated = exists
        ? projects.map((candidate) => (candidate.id === project.id ? project : candidate))
        : [...projects, project];
      return [...updated].sort((left, right) => {
        const leftDate = left.lastOpenedAt ?? left.createdAt;
        const rightDate = right.lastOpenedAt ?? right.createdAt;
        return rightDate.localeCompare(leftDate);
      });
    });
    if (this.activeProject()?.id === project.id) {
      this.activeProject.set(project);
    }
  }
}
