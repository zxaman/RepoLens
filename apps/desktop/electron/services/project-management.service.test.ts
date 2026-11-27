import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_APP_SETTINGS } from '@repolens/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { AppSettingsService } from './app-settings.service.js';
import { JsonProjectRepository } from './json-project-repository.js';
import { JsonSettingsRepository } from './json-settings-repository.js';
import { ProjectManagementService } from './project-management.service.js';
import { ServiceError } from './service-error.js';

const temporaryDirectories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'repolens-project-service-test-'));
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

async function createFixture(selectedPath: () => Promise<string | null>) {
  const directory = await makeDirectory();
  const userData = join(directory, 'user-data');
  const projectRepository = new JsonProjectRepository(join(userData, 'project-registry.json'));
  const settingsRepository = new JsonSettingsRepository(join(userData, 'settings.json'));
  const settings = new AppSettingsService(settingsRepository, projectRepository);
  const service = new ProjectManagementService(
    projectRepository,
    settings,
    { pickDirectory: selectedPath },
    () => new Date('2026-11-27T12:00:00.000Z'),
  );
  return { directory, projectRepository, settingsRepository, settings, service };
}

async function confirmSelectedProject(service: ProjectManagementService) {
  const result = await service.importFolder();
  expect(result.kind).toBe('selected');
  if (result.kind !== 'selected') {
    throw new Error('Expected a valid folder selection.');
  }
  return service.confirmImport(result.preview.selectionId);
}

describe('project management service', () => {
  it('imports, persists, activates, revisits, and removes only the registration', async () => {
    const directory = await makeDirectory();
    const source = join(directory, 'workspaces', 'sample-project');
    await mkdir(source, { recursive: true });
    const fixture = await createFixture(async () => source);

    const committed = await confirmSelectedProject(fixture.service);
    expect(committed.kind).toBe('created');
    if (committed.kind !== 'created') {
      throw new Error('Expected a newly registered project.');
    }

    const project = committed.project;
    expect(project).toMatchObject({
      name: 'sample-project',
      rootPath: source,
      status: 'registered',
      repositoryType: 'local',
      repositoryIndicators: [],
    });
    expect(project.createdAt).toBe('2026-11-27T12:00:00.000Z');
    expect(project.repositoryIndicators).not.toContain('package.json');

    await fixture.service.setActive(project.id);
    await fixture.settings.update({
      ...DEFAULT_APP_SETTINGS,
      defaultProjectId: project.id,
    });

    const restartedRepository = new JsonProjectRepository(
      join(fixture.directory, 'user-data', 'project-registry.json'),
    );
    await expect(restartedRepository.list()).resolves.toHaveLength(1);
    await expect(restartedRepository.getActiveProjectId()).resolves.toBe(project.id);

    await fixture.service.remove(project.id);
    await expect(restartedRepository.list()).resolves.toEqual([]);
    await expect(restartedRepository.getActiveProjectId()).resolves.toBeNull();
    await expect(fixture.settings.get()).resolves.toMatchObject({ defaultProjectId: null });
    await expect(mkdir(source)).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('returns cancellation, detects canonical duplicates, and does not create duplicate records', async () => {
    const directory = await makeDirectory();
    const source = join(directory, 'sample');
    await mkdir(source);
    let selected: string | null = null;
    const fixture = await createFixture(async () => selected);

    await expect(fixture.service.importFolder()).resolves.toEqual({ kind: 'cancelled' });
    selected = `${source}/`;
    const first = await confirmSelectedProject(fixture.service);
    expect(first.kind).toBe('created');

    selected = source;
    const duplicate = await fixture.service.importFolder();
    expect(duplicate).toMatchObject({ kind: 'duplicate', project: { rootPath: source } });
    await expect(fixture.projectRepository.list()).resolves.toHaveLength(1);
  });

  it('detects a folder imported through a symlink as the same canonical project', async () => {
    const directory = await makeDirectory();
    const source = join(directory, 'canonical-project');
    const alias = join(directory, 'project-alias');
    await mkdir(source);
    try {
      await symlink(source, alias, 'dir');
    } catch (error) {
      if (process.platform === 'win32') {
        expect(error).toBeDefined();
        return;
      }
      throw error;
    }

    let selectedPath: string | null = alias;
    const fixture = await createFixture(async () => selectedPath);
    const created = await confirmSelectedProject(fixture.service);
    expect(created.kind).toBe('created');

    selectedPath = source;
    await expect(fixture.service.importFolder()).resolves.toMatchObject({
      kind: 'duplicate',
      project: { rootPath: source },
    });
  });

  it('preserves unavailable registrations and allows metadata refresh when the folder returns', async () => {
    const directory = await makeDirectory();
    const source = join(directory, 'will-return');
    await mkdir(source);
    const fixture = await createFixture(async () => source);
    const committed = await confirmSelectedProject(fixture.service);
    if (committed.kind !== 'created') {
      throw new Error('Expected a newly registered project.');
    }

    await rm(source, { recursive: true, force: true });
    await expect(fixture.service.list()).resolves.toMatchObject([
      { id: committed.project.id, status: 'unavailable' },
    ]);
    await expect(fixture.service.setActive(committed.project.id)).rejects.toMatchObject({
      code: 'PROJECT_UNAVAILABLE',
    });
    await expect(fixture.projectRepository.list()).resolves.toHaveLength(1);

    await mkdir(source);
    await expect(fixture.service.refresh(committed.project.id)).resolves.toMatchObject({
      id: committed.project.id,
      status: 'registered',
    });
  });

  it('expires confirmation tokens and rejects requests for unknown project IDs', async () => {
    const directory = await makeDirectory();
    const source = join(directory, 'token-test');
    await mkdir(source);
    let clock = new Date('2026-11-27T12:00:00.000Z');
    const fixture = await createFixture(async () => source);
    const service = new ProjectManagementService(
      fixture.projectRepository,
      fixture.settings,
      { pickDirectory: async () => source },
      () => clock,
    );
    const selected = await service.importFolder();
    if (selected.kind !== 'selected') {
      throw new Error('Expected a pending folder selection.');
    }
    clock = new Date(clock.getTime() + 6 * 60 * 1000);
    await expect(service.confirmImport(selected.preview.selectionId)).rejects.toBeInstanceOf(
      ServiceError,
    );
    await expect(service.getById('a1b2c3d4-e5f6-47a8-9012-abcdef123456')).resolves.toBeNull();
  });
});
