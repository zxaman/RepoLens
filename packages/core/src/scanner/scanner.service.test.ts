import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanConfigSchema } from '@repolens/shared';
import { describe, expect, it } from 'vitest';
import { scanProject } from './scanner.service.js';
import { ScanCancelledError, ScanFileSystemError } from './scan.errors.js';
import type {
  ScanCancellation,
  ScanFileInfo,
  ScanFileSystem,
  ScanHashResult,
} from './scan.types.js';

const fixtureRoot = fileURLToPath(new URL('../../../../fixtures/scanner/basic/', import.meta.url));
const outsideFixture = fileURLToPath(
  new URL('../../../../fixtures/scanner/outside-sentinel.txt', import.meta.url),
);

class FixtureFileSystem implements ScanFileSystem {
  private readonly outsideLink = join(fixtureRoot, 'outside-link.ts');
  private readonly cycleLink = join(fixtureRoot, 'src-loop');
  private readonly secretAlias = join(fixtureRoot, 'src', 'sensitive-alias.ts');

  async realpath(path: string): Promise<string> {
    if (resolve(path) === resolve(this.outsideLink)) {
      return realpath(outsideFixture);
    }
    if (resolve(path) === resolve(this.cycleLink)) {
      return realpath(join(fixtureRoot, 'src'));
    }
    if (resolve(path) === resolve(this.secretAlias)) {
      return realpath(join(fixtureRoot, 'secrets', 'secret.txt'));
    }
    return realpath(path);
  }

  async lstat(path: string): Promise<ScanFileInfo> {
    if (this.isVirtualLink(path)) {
      return { kind: 'symlink', sizeBytes: 0, modifiedAtMs: 0 };
    }
    return toFileInfo(await lstat(path));
  }

  async stat(path: string): Promise<ScanFileInfo> {
    return toFileInfo(await stat(path));
  }

  async readdir(path: string): Promise<readonly string[]> {
    const entries = await readdir(path, { encoding: 'utf8' });
    if (resolve(path) === resolve(fixtureRoot)) {
      return [...entries, 'outside-link.ts', 'src-loop'];
    }
    return resolve(path) === resolve(join(fixtureRoot, 'src'))
      ? [...entries, 'sensitive-alias.ts']
      : entries;
  }

  async readTextFile(rootPath: string, path: string, maxBytes: number): Promise<string | null> {
    const canonicalRoot = await realpath(rootPath);
    const canonicalFile = await realpath(path);
    if (!this.isWithinRoot(canonicalRoot, canonicalFile)) {
      throw new ScanFileSystemError('IO_ERROR', 'Fixture read escaped the selected root.');
    }
    const fileStats = await stat(canonicalFile);
    if (!fileStats.isFile()) {
      return null;
    }
    if (fileStats.size > maxBytes) {
      throw new ScanFileSystemError('FILE_TOO_LARGE', 'Fixture file exceeded the requested limit.');
    }
    return readFile(canonicalFile, 'utf8');
  }

  async hashFile(
    rootPath: string,
    path: string,
    signal: ScanCancellation,
    maxBytes: number,
  ): Promise<ScanHashResult> {
    if (signal.aborted) {
      throw new ScanCancelledError();
    }
    const canonicalRoot = await realpath(rootPath);
    const canonicalFile = await realpath(path);
    if (!this.isWithinRoot(canonicalRoot, canonicalFile)) {
      throw new ScanFileSystemError('IO_ERROR', 'Fixture hash escaped the selected root.');
    }
    const contents = await readFile(canonicalFile);
    if (contents.byteLength > maxBytes) {
      throw new ScanFileSystemError('FILE_TOO_LARGE', 'Fixture file exceeded the hash limit.');
    }
    if (signal.aborted) {
      throw new ScanCancelledError();
    }
    return {
      sha256: createHash('sha256').update(contents).digest('hex'),
      bytesRead: contents.byteLength,
    };
  }

  isWithinRoot(rootPath: string, candidatePath: string): boolean {
    return this.relativePath(rootPath, candidatePath) !== null;
  }

  relativePath(rootPath: string, candidatePath: string): string | null {
    const relativePath = relative(resolve(rootPath), resolve(candidatePath));
    if (
      relativePath !== '' &&
      (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    ) {
      return null;
    }
    return relativePath.split(sep).join('/');
  }

  async yieldToEventLoop(): Promise<void> {
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
  }

  private isVirtualLink(path: string): boolean {
    return (
      resolve(path) === resolve(this.outsideLink) ||
      resolve(path) === resolve(this.cycleLink) ||
      resolve(path) === resolve(this.secretAlias)
    );
  }
}

function toFileInfo(stats: Stats): ScanFileInfo {
  return {
    kind: stats.isFile() ? 'file' : stats.isDirectory() ? 'directory' : 'other',
    sizeBytes: stats.size,
    modifiedAtMs: stats.mtimeMs,
  };
}

class FixtureWithoutIgnoreFiles extends FixtureFileSystem {
  override async readTextFile(
    rootPath: string,
    path: string,
    maxBytes: number,
  ): Promise<string | null> {
    const fileName = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
    if (fileName === '.gitignore' || fileName === '.repolensignore') {
      throw Object.assign(new Error('Optional fixture ignore file is absent.'), { code: 'ENOENT' });
    }
    return super.readTextFile(rootPath, path, maxBytes);
  }
}

describe('scanner service with the checked-in scanner fixture', () => {
  it('discovers, safely filters, classifies, hashes, and detects evidence without reading secrets', async () => {
    const progressEvents: string[] = [];
    const result = await scanProject({
      projectId: '92370c1b-8755-4057-ae23-0d885ad4d94b',
      rootPath: fixtureRoot,
      config: scanConfigSchema.parse({ excludePatterns: ['config/**/always.exclude'] }),
      fileSystem: new FixtureFileSystem(),
      onProgress: (progress) => progressEvents.push(progress.phase),
      now: () => new Date('2026-11-27T00:00:00.000Z'),
    });

    expect(result.status).toBe('completed');
    const files = new Map(result.files.map((file) => [file.relativePath, file]));
    expect(files.get('src/index.ts')).toMatchObject({
      classification: 'source',
      extension: '.ts',
      language: 'TypeScript',
      hashStatus: 'hashed',
    });
    expect(files.get('package.json')).toMatchObject({
      classification: 'package-manifest',
      language: 'JSON',
      hashStatus: 'hashed',
    });
    expect(files.get('README.md')?.classification).toBe('documentation');
    expect(files.get('assets/logo.svg')?.classification).toBe('asset');

    expect(files.has('scratch/keep.ts')).toBe(true);
    expect(files.has('scratch/skip.ts')).toBe(false);
    expect(files.has('ignored-by-git.txt')).toBe(true);
    expect(files.has('override.tmp')).toBe(true);
    expect(files.has('src/keep.local')).toBe(true);
    expect(files.has('src/ignored.local')).toBe(false);
    expect(files.has('dist/generated.js')).toBe(false);
    expect(files.has('node_modules/demo/index.js')).toBe(false);
    expect(files.has('vendor/tool.js')).toBe(false);
    expect(files.has('config/force-exclude/always.exclude')).toBe(false);
    expect(files.has('credentials.json')).toBe(false);
    expect(files.has('.env.production')).toBe(false);
    expect(files.has('secrets/secret.txt')).toBe(false);
    expect(files.has('src/sensitive-alias.ts')).toBe(false);
    expect(files.has('outside-link.ts')).toBe(false);
    expect(files.has('src-loop/index.ts')).toBe(false);

    expect(result.sensitiveEntriesExcluded).toBe(4);
    expect(result.symlinksSkipped).toBe(3);
    expect(result.warnings.map((warning) => warning.code)).toContain('SENSITIVE_FILE_EXCLUDED');
    expect(result.warnings.map((warning) => warning.code)).toContain('SYMLINK_OUTSIDE_ROOT');
    expect(result.warnings.map((warning) => warning.code)).toContain('SYMLINK_CYCLE');

    expect(result.technologies.map((technology) => technology.name)).toEqual(
      expect.arrayContaining(['Node.js', 'React', 'Express', 'TypeScript', 'Vite']),
    );
    expect(result.languages.map((language) => language.name)).toEqual(
      expect.arrayContaining(['TypeScript', 'JSON', 'Markdown']),
    );
    expect(result.bytesHashed).toBe(
      result.files.reduce(
        (total, file) => total + (file.hashStatus === 'hashed' ? file.sizeBytes : 0),
        0,
      ),
    );
    expect(result.files.every((file) => file.sha256?.match(/^[a-f0-9]{64}$/))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('FIXTURE_SECRET_DO_NOT_RETURN_7b91f6');
    expect(progressEvents).toEqual(
      expect.arrayContaining([
        'initializing',
        'walking',
        'classifying',
        'hashing',
        'detecting',
        'finalizing',
      ]),
    );
    expect(progressEvents.at(-1)).toBe('finalizing');
  });

  it('treats absent optional ignore files as normal rather than a scan warning', async () => {
    const result = await scanProject({
      projectId: '92370c1b-8755-4057-ae23-0d885ad4d94b',
      rootPath: fixtureRoot,
      config: scanConfigSchema.parse({}),
      fileSystem: new FixtureWithoutIgnoreFiles(),
    });
    expect(result.status).toBe('completed');
    expect(result.warnings.map((warning) => warning.code)).not.toContain('IGNORE_FILE_UNAVAILABLE');
  });

  it('requires explicit risk acknowledgement before including sensitive fixture paths', async () => {
    const fileSystem = new FixtureFileSystem();
    const rejectedConfig = { ...scanConfigSchema.parse({}), includeSensitiveFiles: true };
    const rejected = await scanProject({
      projectId: '92370c1b-8755-4057-ae23-0d885ad4d94b',
      rootPath: fixtureRoot,
      config: rejectedConfig,
      fileSystem,
    });
    expect(rejected.status).toBe('failed');
    expect(rejected.files).toHaveLength(0);

    const included = await scanProject({
      projectId: '92370c1b-8755-4057-ae23-0d885ad4d94b',
      rootPath: fixtureRoot,
      config: scanConfigSchema.parse({
        includeSensitiveFiles: true,
        acknowledgeSensitiveFileRisk: true,
      }),
      fileSystem,
    });
    expect(included.status).toBe('completed');
    expect(included.files.map((file) => file.relativePath)).toEqual(
      expect.arrayContaining(['credentials.json', '.env.production', 'secrets/secret.txt']),
    );
    expect(JSON.stringify(included)).not.toContain('FIXTURE_SECRET_DO_NOT_RETURN_7b91f6');
  });

  it('stops discovery and returns a cancelled result when cancellation arrives during walking', async () => {
    const controller = new AbortController();
    const progressEvents: string[] = [];
    const result = await scanProject({
      projectId: '92370c1b-8755-4057-ae23-0d885ad4d94b',
      rootPath: fixtureRoot,
      config: scanConfigSchema.parse({}),
      fileSystem: new FixtureFileSystem(),
      signal: controller.signal,
      onProgress: (progress) => {
        progressEvents.push(progress.phase);
        if (progress.phase === 'walking' && progress.filesDiscovered > 0) {
          controller.abort();
        }
      },
    });

    expect(result.status).toBe('cancelled');
    expect(progressEvents).not.toContain('hashing');
    expect(result.filesProcessed).toBe(0);
  });

  it('keeps scanning when a progress observer throws', async () => {
    const result = await scanProject({
      projectId: '92370c1b-8755-4057-ae23-0d885ad4d94b',
      rootPath: fixtureRoot,
      config: scanConfigSchema.parse({}),
      fileSystem: new FixtureFileSystem(),
      onProgress: () => {
        throw new Error('broken renderer callback');
      },
    });
    expect(result.status).toBe('completed');
  });
});
