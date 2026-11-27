import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, parse } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectProjectFolder,
  isFilesystemRoot,
  isProhibitedSystemDirectory,
} from './project-path-validation.js';

const temporaryDirectories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'repolens-project-test-'));
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

describe('project folder validation', () => {
  it('accepts ordinary folders without requiring Git or a package manifest', async () => {
    const folder = join(await makeDirectory(), 'plain source folder');
    await mkdir(folder);

    await expect(inspectProjectFolder(folder)).resolves.toMatchObject({
      name: 'plain source folder',
      rootPath: folder,
      repositoryType: 'local',
      repositoryIndicators: [],
    });
  });

  it('records only direct repository markers and identifies Git repositories', async () => {
    const folder = join(await makeDirectory(), 'service');
    await mkdir(folder);
    await mkdir(join(folder, '.git'));
    await writeFile(join(folder, 'package.json'), '{"scripts":{"bad":"never executed"}}');
    await writeFile(join(folder, 'README.md'), 'No source is read.');

    await expect(inspectProjectFolder(folder)).resolves.toMatchObject({
      repositoryType: 'git',
      repositoryIndicators: ['.git', 'package.json'],
    });
  });

  it('rejects missing paths, regular files, filesystem roots, and prohibited system locations', async () => {
    const folder = await makeDirectory();
    const file = join(folder, 'not-a-directory');
    await writeFile(file, 'file');

    await expect(inspectProjectFolder(join(folder, 'missing'))).rejects.toMatchObject({
      code: 'INVALID_PROJECT_PATH',
    });
    await expect(inspectProjectFolder(file)).rejects.toMatchObject({
      code: 'INVALID_PROJECT_PATH',
    });
    await expect(inspectProjectFolder(parse(folder).root)).rejects.toMatchObject({
      code: 'PROHIBITED_PATH',
    });
    expect(isFilesystemRoot(parse(folder).root)).toBe(true);
    expect(isProhibitedSystemDirectory('/etc')).toBe(true);
  });

  it('canonicalizes selected symlinks before reporting a project location when supported', async () => {
    const folder = join(await makeDirectory(), 'actual');
    const link = join(await makeDirectory(), 'alias');
    await mkdir(folder);

    try {
      const { symlink } = await import('node:fs/promises');
      await symlink(folder, link, 'dir');
      const result = await inspectProjectFolder(link);
      expect(result.rootPath).toBe(folder);
      expect(result.name).toBe(basename(folder));
    } catch (error) {
      if (process.platform === 'win32') {
        expect(error).toBeDefined();
        return;
      }
      throw error;
    }
  });
});
