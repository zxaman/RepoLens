import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ScanCancelledError, ScanFileSystemError } from '@repolens/core';
import { NodeScanFileSystem } from './node-scan-file-system.js';

const fixtureRoot = fileURLToPath(new URL('../../../../fixtures/scanner/basic/', import.meta.url));
const outsideFixture = fileURLToPath(
  new URL('../../../../fixtures/scanner/outside-sentinel.txt', import.meta.url),
);

describe('Electron Node scan filesystem adapter', () => {
  it('reads and hashes only canonical paths contained by the selected fixture root', async () => {
    const fileSystem = new NodeScanFileSystem();
    const sourcePath = join(fixtureRoot, 'src', 'index.ts');
    const contents = await readFile(sourcePath);
    const hash = await fileSystem.hashFile(fixtureRoot, sourcePath, { aborted: false }, 1_000_000);

    expect(hash).toEqual({
      sha256: createHash('sha256').update(contents).digest('hex'),
      bytesRead: contents.byteLength,
    });
    await expect(
      fileSystem.readTextFile(fixtureRoot, outsideFixture, 1_000_000),
    ).rejects.toMatchObject({
      name: 'ScanFileSystemError',
      code: 'IO_ERROR',
    });
    expect(fileSystem.isWithinRoot(fixtureRoot, join(fixtureRoot, 'src', 'index.ts'))).toBe(true);
    expect(fileSystem.isWithinRoot(fixtureRoot, `${resolve(fixtureRoot)}-sibling`)).toBe(false);
  });

  it('enforces byte limits and observes cancellation before opening a file', async () => {
    const fileSystem = new NodeScanFileSystem();
    const sourcePath = join(fixtureRoot, 'src', 'index.ts');
    await expect(fileSystem.readTextFile(fixtureRoot, sourcePath, 1)).rejects.toBeInstanceOf(
      ScanFileSystemError,
    );
    await expect(
      fileSystem.hashFile(fixtureRoot, sourcePath, { aborted: true }, 1_000_000),
    ).rejects.toBeInstanceOf(ScanCancelledError);
  });
});
