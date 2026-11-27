import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project } from '@repolens/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalPathKey } from './project-path-utils.js';
import { JsonProjectRepository } from './json-project-repository.js';

const temporaryDirectories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'repolens-registry-test-'));
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

function project(rootPath: string, overrides: Partial<Project> = {}): Project {
  const timestamp = '2026-11-27T00:00:00.000Z';
  return {
    id: randomUUID(),
    name: 'sample',
    rootPath,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'registered',
    repositoryType: 'local',
    repositoryIndicators: [],
    ...overrides,
  };
}

describe('JSON project registry repository', () => {
  it('creates, lists, retrieves, updates, activates, removes, and survives repository recreation', async () => {
    const directory = await makeDirectory();
    const registryPath = join(directory, 'user-data', 'project-registry.json');
    const repository = new JsonProjectRepository(registryPath);
    const original = project(join(directory, 'source'));

    await expect(repository.create(original)).resolves.toEqual(original);
    await expect(repository.getById(original.id)).resolves.toEqual(original);
    await expect(repository.getByPath(original.rootPath)).resolves.toEqual(original);
    await repository.setActiveProjectId(original.id);

    const updated = { ...original, status: 'unavailable' as const };
    await expect(repository.update(updated)).resolves.toEqual(updated);

    const reopened = new JsonProjectRepository(registryPath);
    await expect(reopened.list()).resolves.toEqual([updated]);
    await expect(reopened.getActiveProjectId()).resolves.toBe(original.id);
    await reopened.delete(original.id);
    await expect(reopened.getActiveProjectId()).resolves.toBeNull();
    await expect(reopened.list()).resolves.toEqual([]);
    expect(await readFile(registryPath, 'utf8')).toContain('"version": 1');
  });

  it('normalizes absolute, relative, trailing-separator, and Windows-case duplicate paths', async () => {
    const directory = await makeDirectory();
    const registryPath = join(directory, 'projects.json');
    const repository = new JsonProjectRepository(registryPath);
    const projectPath = join(directory, 'source');
    const registered = project(projectPath);
    await repository.create(registered);

    await expect(repository.getByPath(`${projectPath}/`)).resolves.toEqual(registered);
    await expect(repository.getByPath(relative(process.cwd(), projectPath))).resolves.toEqual(
      registered,
    );
    await expect(repository.create(project(`${projectPath}/`))).rejects.toMatchObject({
      code: 'PROJECT_ALREADY_REGISTERED',
    });
    expect(canonicalPathKey('C:\\Users\\Dev\\Repo\\', 'win32')).toBe(
      canonicalPathKey('c:\\users\\dev\\repo', 'win32'),
    );
  });

  it('serializes concurrent writes and preserves malformed registry data before recovery', async () => {
    const directory = await makeDirectory();
    const registryPath = join(directory, 'project-registry.json');
    const repository = new JsonProjectRepository(registryPath);
    const sourcePath = join(directory, 'source');
    const outcomes = await Promise.allSettled([
      repository.create(project(sourcePath)),
      repository.create(project(`${sourcePath}/`)),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect((await repository.list()).length).toBe(1);

    await writeFile(registryPath, '{broken json', 'utf8');
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(repository.list()).resolves.toEqual([]);
    logger.mockRestore();

    const files = await readdir(directory);
    expect(files.some((name) => name.startsWith('project-registry.json.corrupt-'))).toBe(true);
    await expect(readFile(registryPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
