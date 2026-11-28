import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeAnalysisFileSystem } from './node-analysis-file-system.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'repolens-analysis-'));
  temporaryDirectories.push(root);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'entry.ts'), 'export const value = 1;');
  await writeFile(join(root, 'secret.txt'), 'must not be read');
  return root;
}

describe('NodeAnalysisFileSystem', () => {
  it('reads only scan-inventory paths within the canonical project root', async () => {
    const root = await createProject();
    const fileSystem = new NodeAnalysisFileSystem(root, new Set(['src/entry.ts']));

    await expect(fileSystem.readTextFile('src/entry.ts', 128)).resolves.toContain(
      'export const value',
    );
    await expect(fileSystem.readTextFile('secret.txt', 128)).rejects.toThrow();
    await expect(fileSystem.readTextFile('../outside.ts', 128)).rejects.toThrow();
    await expect(fileSystem.readTextFile('src/entry.ts', 2)).rejects.toThrow();
  });
});
