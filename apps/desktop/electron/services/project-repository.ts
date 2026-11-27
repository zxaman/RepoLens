import type { Project } from '@repolens/shared';

export interface ProjectRepository {
  list(): Promise<readonly Project[]>;
  getById(id: string): Promise<Project | null>;
  getByPath(canonicalPath: string): Promise<Project | null>;
  create(project: Project): Promise<Project>;
  update(project: Project): Promise<Project>;
  delete(id: string): Promise<void>;
  getActiveProjectId(): Promise<string | null>;
  setActiveProjectId(id: string | null): Promise<void>;
}
