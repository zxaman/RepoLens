import { projectSchema, type Project } from '@repolens/shared';
import { z } from 'zod';
import { atomicWriteJson, readValidatedJson } from './atomic-json-file.js';
import { canonicalPathKey } from './project-path-utils.js';
import { ServiceError } from './service-error.js';
import type { ProjectRepository } from './project-repository.js';

const registrySchema = z
  .object({
    version: z.literal(1),
    projects: z.array(projectSchema),
    activeProjectId: z.uuid().nullable(),
  })
  .strict();

type ProjectRegistry = z.infer<typeof registrySchema>;

function emptyRegistry(): ProjectRegistry {
  return { version: 1, projects: [], activeProjectId: null };
}

export class JsonProjectRepository implements ProjectRepository {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly registryPath: string) {}

  list(): Promise<readonly Project[]> {
    return this.exclusive(async () => [...(await this.readRegistry()).projects]);
  }

  getById(id: string): Promise<Project | null> {
    return this.exclusive(async () => {
      const project = (await this.readRegistry()).projects.find((candidate) => candidate.id === id);
      return project ?? null;
    });
  }

  getByPath(canonicalPath: string): Promise<Project | null> {
    return this.exclusive(async () => {
      const key = canonicalPathKey(canonicalPath);
      const project = (await this.readRegistry()).projects.find(
        (candidate) => canonicalPathKey(candidate.rootPath) === key,
      );
      return project ?? null;
    });
  }

  create(project: Project): Promise<Project> {
    return this.exclusive(async () => {
      const state = await this.readRegistry();
      if (state.projects.some((candidate) => candidate.id === project.id)) {
        throw new ServiceError('INVALID_INPUT', 'A project with this identifier already exists.');
      }
      if (
        state.projects.some(
          (candidate) =>
            canonicalPathKey(candidate.rootPath) === canonicalPathKey(project.rootPath),
        )
      ) {
        throw new ServiceError(
          'PROJECT_ALREADY_REGISTERED',
          'This folder is already registered in RepoLens.',
        );
      }

      const validated = projectSchema.parse(project);
      await this.writeRegistry({ ...state, projects: [...state.projects, validated] });
      return validated;
    });
  }

  update(project: Project): Promise<Project> {
    return this.exclusive(async () => {
      const state = await this.readRegistry();
      const index = state.projects.findIndex((candidate) => candidate.id === project.id);
      if (index < 0) {
        throw new ServiceError('PROJECT_NOT_FOUND', 'That project is no longer registered.');
      }
      if (
        state.projects.some(
          (candidate) =>
            candidate.id !== project.id &&
            canonicalPathKey(candidate.rootPath) === canonicalPathKey(project.rootPath),
        )
      ) {
        throw new ServiceError(
          'PROJECT_ALREADY_REGISTERED',
          'Another project is already registered at this location.',
        );
      }

      const validated = projectSchema.parse(project);
      const projects = [...state.projects];
      projects[index] = validated;
      await this.writeRegistry({ ...state, projects });
      return validated;
    });
  }

  delete(id: string): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.readRegistry();
      if (!state.projects.some((candidate) => candidate.id === id)) {
        throw new ServiceError('PROJECT_NOT_FOUND', 'That project is no longer registered.');
      }
      const projects = state.projects.filter((candidate) => candidate.id !== id);
      const activeProjectId = state.activeProjectId === id ? null : state.activeProjectId;
      await this.writeRegistry({ ...state, projects, activeProjectId });
    });
  }

  getActiveProjectId(): Promise<string | null> {
    return this.exclusive(async () => (await this.readRegistry()).activeProjectId);
  }

  setActiveProjectId(id: string | null): Promise<void> {
    return this.exclusive(async () => {
      const state = await this.readRegistry();
      if (id !== null && !state.projects.some((candidate) => candidate.id === id)) {
        throw new ServiceError('PROJECT_NOT_FOUND', 'That project is no longer registered.');
      }
      await this.writeRegistry({ ...state, activeProjectId: id });
    });
  }

  private async readRegistry(): Promise<ProjectRegistry> {
    return readValidatedJson(
      this.registryPath,
      registrySchema,
      emptyRegistry(),
      'project registry',
    );
  }

  private async writeRegistry(registry: ProjectRegistry): Promise<void> {
    await atomicWriteJson(this.registryPath, registrySchema.parse(registry));
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
