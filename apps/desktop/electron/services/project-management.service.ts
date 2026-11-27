import { randomUUID } from 'node:crypto';
import {
  projectImportPreviewSchema,
  projectSchema,
  type Project,
  type ProjectImportCommitResult,
  type ProjectImportPreview,
  type ProjectImportResult,
} from '@repolens/shared';
import { canonicalPathKey } from './project-path-utils.js';
import { inspectProjectFolder, type InspectedProjectFolder } from './project-path-validation.js';
import type { ProjectRepository } from './project-repository.js';
import { ServiceError } from './service-error.js';
import type { AppSettingsService } from './app-settings.service.js';

const PENDING_IMPORT_TTL_MS = 5 * 60 * 1000;

export interface DirectoryPicker {
  pickDirectory(): Promise<string | null>;
}

interface PendingImport {
  readonly preview: ProjectImportPreview;
  readonly expiresAt: number;
}

export class ProjectManagementService {
  private readonly pendingImports = new Map<string, PendingImport>();

  constructor(
    private readonly projects: ProjectRepository,
    private readonly settings: AppSettingsService,
    private readonly picker: DirectoryPicker,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async importFolder(): Promise<ProjectImportResult> {
    const selectedPath = await this.picker.pickDirectory();
    if (selectedPath === null) {
      return { kind: 'cancelled' };
    }

    const inspected = await inspectProjectFolder(selectedPath);
    const duplicate = await this.projects.getByPath(inspected.rootPath);
    if (duplicate !== null) {
      return { kind: 'duplicate', project: duplicate };
    }

    this.expirePendingImports();
    const preview = projectImportPreviewSchema.parse({
      selectionId: randomUUID(),
      ...inspected,
    });
    this.pendingImports.set(preview.selectionId, {
      preview,
      expiresAt: this.now().getTime() + PENDING_IMPORT_TTL_MS,
    });
    return { kind: 'selected', preview };
  }

  async confirmImport(selectionId: string): Promise<ProjectImportCommitResult> {
    const pending = this.pendingImports.get(selectionId);
    this.pendingImports.delete(selectionId);
    if (pending === undefined || pending.expiresAt <= this.now().getTime()) {
      throw new ServiceError(
        'SELECTION_EXPIRED',
        'That folder selection expired. Select the folder again.',
      );
    }

    const inspected = await inspectProjectFolder(pending.preview.rootPath);
    if (canonicalPathKey(inspected.rootPath) !== canonicalPathKey(pending.preview.rootPath)) {
      throw new ServiceError(
        'INVALID_PROJECT_PATH',
        'The selected folder changed before it was added.',
      );
    }

    const duplicate = await this.projects.getByPath(inspected.rootPath);
    if (duplicate !== null) {
      return { kind: 'duplicate', project: duplicate };
    }

    const createdAt = this.now().toISOString();
    const project = projectSchema.parse({
      id: randomUUID(),
      name: inspected.name,
      rootPath: inspected.rootPath,
      createdAt,
      updatedAt: createdAt,
      status: 'registered',
      repositoryType: inspected.repositoryType,
      repositoryIndicators: [...inspected.repositoryIndicators],
    });

    try {
      return { kind: 'created', project: await this.projects.create(project) };
    } catch (error) {
      if (error instanceof ServiceError && error.code === 'PROJECT_ALREADY_REGISTERED') {
        const existing = await this.projects.getByPath(inspected.rootPath);
        if (existing !== null) {
          return { kind: 'duplicate', project: existing };
        }
      }
      throw error;
    }
  }

  cancelImport(selectionId: string): { readonly cancelled: true } {
    this.expirePendingImports();
    if (!this.pendingImports.delete(selectionId)) {
      throw new ServiceError('SELECTION_EXPIRED', 'That folder selection is no longer available.');
    }
    return { cancelled: true };
  }

  async list(): Promise<readonly Project[]> {
    await this.settings.clearInvalidDefaultProject();
    const projects = await this.projects.list();
    const refreshed: Project[] = [];
    for (const project of projects) {
      refreshed.push(await this.refreshProject(project));
    }
    return refreshed.sort((left, right) => {
      const leftDate = left.lastOpenedAt ?? left.createdAt;
      const rightDate = right.lastOpenedAt ?? right.createdAt;
      return rightDate.localeCompare(leftDate);
    });
  }

  async getById(id: string): Promise<Project | null> {
    const project = await this.projects.getById(id);
    return project === null ? null : this.refreshProject(project);
  }

  async getActive(): Promise<Project | null> {
    const activeProjectId = await this.projects.getActiveProjectId();
    return activeProjectId === null ? null : this.getById(activeProjectId);
  }

  async setActive(id: string): Promise<Project> {
    const project = await this.getById(id);
    if (project === null) {
      throw new ServiceError('PROJECT_NOT_FOUND', 'That project is no longer registered.');
    }
    if (project.status === 'unavailable') {
      throw new ServiceError(
        'PROJECT_UNAVAILABLE',
        'That project folder is currently unavailable.',
      );
    }

    const lastOpenedAt = this.now().toISOString();
    const updated = await this.projects.update({
      ...project,
      lastOpenedAt,
      updatedAt: lastOpenedAt,
    });
    await this.projects.setActiveProjectId(updated.id);
    return updated;
  }

  async remove(id: string): Promise<{ readonly removed: true }> {
    await this.projects.delete(id);
    await this.settings.clearDefaultProject(id);
    return { removed: true };
  }

  async refresh(id: string): Promise<Project> {
    const project = await this.projects.getById(id);
    if (project === null) {
      throw new ServiceError('PROJECT_NOT_FOUND', 'That project is no longer registered.');
    }
    return this.refreshProject(project);
  }

  private async refreshProject(project: Project): Promise<Project> {
    let inspected: InspectedProjectFolder;
    try {
      inspected = await inspectProjectFolder(project.rootPath);
    } catch (error) {
      if (!(error instanceof ServiceError)) {
        throw error;
      }
      if (project.status === 'unavailable') {
        return project;
      }
      return this.projects.update({
        ...project,
        status: 'unavailable',
        updatedAt: this.now().toISOString(),
      });
    }

    if (canonicalPathKey(inspected.rootPath) !== canonicalPathKey(project.rootPath)) {
      if (project.status === 'unavailable') {
        return project;
      }
      return this.projects.update({
        ...project,
        status: 'unavailable',
        updatedAt: this.now().toISOString(),
      });
    }

    const indicatorsChanged =
      inspected.repositoryIndicators.join('|') !== project.repositoryIndicators.join('|') ||
      inspected.repositoryType !== project.repositoryType;
    if (project.status === 'registered' && !indicatorsChanged) {
      return project;
    }

    return this.projects.update({
      ...project,
      name: inspected.name,
      status: 'registered',
      repositoryType: inspected.repositoryType,
      repositoryIndicators: [...inspected.repositoryIndicators],
      updatedAt: this.now().toISOString(),
    });
  }

  private expirePendingImports(): void {
    const now = this.now().getTime();
    for (const [selectionId, pending] of this.pendingImports) {
      if (pending.expiresAt <= now) {
        this.pendingImports.delete(selectionId);
      }
    }
  }
}
