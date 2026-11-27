import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_APP_SETTINGS, type Project } from '@repolens/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsService } from './app-settings.service.js';
import { JsonSettingsRepository } from './json-settings-repository.js';
import type { ProjectRepository } from './project-repository.js';
import { ServiceError } from './service-error.js';

const temporaryDirectories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'repolens-settings-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function projectRepository(
  existingIds: readonly string[] = [],
  status: Project['status'] = 'registered',
): ProjectRepository {
  const projects = new Map<string, Project>(
    existingIds.map((id) => [
      id,
      {
        id,
        name: 'sample',
        rootPath: `/tmp/${id}`,
        createdAt: '2026-11-27T00:00:00.000Z',
        updatedAt: '2026-11-27T00:00:00.000Z',
        status,
        repositoryType: 'local',
        repositoryIndicators: [],
      },
    ]),
  );
  return {
    list: async () => [...projects.values()],
    getById: async (id) => projects.get(id) ?? null,
    getByPath: async () => null,
    create: async (project) => project,
    update: async (project) => project,
    delete: async (id) => {
      projects.delete(id);
    },
    getActiveProjectId: async () => null,
    setActiveProjectId: async () => undefined,
  };
}

describe('JSON-backed application settings', () => {
  it('loads defaults, persists updates, and resets independently', async () => {
    const file = join(await makeDirectory(), 'settings.json');
    const repository = new JsonSettingsRepository(file);
    const service = new AppSettingsService(
      repository,
      projectRepository(['a1b2c3d4-e5f6-47a8-9012-abcdef123456']),
    );

    await expect(service.get()).resolves.toEqual(DEFAULT_APP_SETTINGS);
    const updated = {
      ...DEFAULT_APP_SETTINGS,
      theme: 'light' as const,
      defaultProjectId: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
      recentProjectsLimit: 5,
    };
    await expect(service.update(updated)).resolves.toEqual(updated);

    const restartedRepository = new JsonSettingsRepository(file);
    await expect(restartedRepository.get()).resolves.toEqual(updated);
    expect(await readFile(file, 'utf8')).toContain('"theme": "light"');
    await expect(restartedRepository.reset()).resolves.toEqual(DEFAULT_APP_SETTINGS);
  });

  it('does not allow an unavailable project to be selected as the default', async () => {
    const id = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
    const service = new AppSettingsService(
      new JsonSettingsRepository(join(await makeDirectory(), 'settings.json')),
      projectRepository([id], 'unavailable'),
    );

    await expect(
      service.update({ ...DEFAULT_APP_SETTINGS, defaultProjectId: id }),
    ).rejects.toMatchObject({ code: 'PROJECT_UNAVAILABLE' });
  });

  it('rejects invalid settings and recovers safe defaults after malformed JSON', async () => {
    const directory = await makeDirectory();
    const file = join(directory, 'settings.json');
    await writeFile(file, '{not-json', 'utf8');
    const repository = new JsonSettingsRepository(file);
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(repository.get()).resolves.toEqual(DEFAULT_APP_SETTINGS);
    logger.mockRestore();
    await expect(
      repository.update({ ...DEFAULT_APP_SETTINGS, recentProjectsLimit: 0 }),
    ).rejects.toBeInstanceOf(ServiceError);
    await expect(
      serviceWithNoProjects(repository).update({
        ...DEFAULT_APP_SETTINGS,
        defaultProjectId: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });
});

function serviceWithNoProjects(repository: JsonSettingsRepository): AppSettingsService {
  return new AppSettingsService(repository, projectRepository());
}
