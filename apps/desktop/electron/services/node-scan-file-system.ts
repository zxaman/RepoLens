import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { open, lstat, realpath, readdir, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { ScanCancelledError, ScanFileSystemError } from '@repolens/core';
import type {
  ScanCancellation,
  ScanFileInfo,
  ScanFileSystem,
  ScanHashResult,
} from '@repolens/core';

const OPEN_READ_ONLY = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

export class NodeScanFileSystem implements ScanFileSystem {
  async realpath(path: string): Promise<string> {
    return realpath(path);
  }

  async lstat(path: string): Promise<ScanFileInfo> {
    return toScanFileInfo(await lstat(path));
  }

  async stat(path: string): Promise<ScanFileInfo> {
    return toScanFileInfo(await stat(path));
  }

  async readdir(path: string): Promise<readonly string[]> {
    return readdir(path, { encoding: 'utf8' });
  }

  async readTextFile(rootPath: string, path: string, maxBytes: number): Promise<string | null> {
    const canonicalRoot = await realpath(rootPath);
    const canonicalFile = await realpath(path);
    if (!this.isWithinRoot(canonicalRoot, canonicalFile)) {
      throw new ScanFileSystemError('IO_ERROR', 'A scan read was outside the selected project.');
    }

    const handle = await open(canonicalFile, OPEN_READ_ONLY);
    try {
      const fileStats = await handle.stat();
      if (!fileStats.isFile()) {
        return null;
      }
      if (fileStats.size > maxBytes) {
        throw new ScanFileSystemError('FILE_TOO_LARGE', 'The file exceeded its safe read limit.');
      }

      const buffer = Buffer.alloc(Math.max(1, maxBytes + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > maxBytes) {
        throw new ScanFileSystemError('FILE_TOO_LARGE', 'The file exceeded its safe read limit.');
      }
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
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
      throw new ScanFileSystemError('IO_ERROR', 'A scan hash was outside the selected project.');
    }

    const handle = await open(canonicalFile, OPEN_READ_ONLY);
    try {
      const fileStats = await handle.stat();
      if (!fileStats.isFile()) {
        throw new ScanFileSystemError('IO_ERROR', 'The scan target is no longer a regular file.');
      }
      if (fileStats.size > maxBytes) {
        throw new ScanFileSystemError(
          'FILE_TOO_LARGE',
          'The file exceeded its configured hash limit.',
        );
      }

      const hash = createHash('sha256');
      const stream = handle.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 });
      let bytesRead = 0;
      try {
        for await (const chunk of stream) {
          if (signal.aborted) {
            stream.destroy();
            throw new ScanCancelledError();
          }
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytesRead += bytes.length;
          if (bytesRead > maxBytes) {
            stream.destroy();
            throw new ScanFileSystemError(
              'FILE_TOO_LARGE',
              'The file exceeded its configured hash limit.',
            );
          }
          hash.update(bytes);
        }
      } catch (error) {
        if (signal.aborted && !(error instanceof ScanCancelledError)) {
          throw new ScanCancelledError();
        }
        throw error;
      }
      return { sha256: hash.digest('hex'), bytesRead };
    } finally {
      await handle.close();
    }
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
}

function toScanFileInfo(stats: Stats): ScanFileInfo {
  const kind = stats.isFile()
    ? 'file'
    : stats.isDirectory()
      ? 'directory'
      : stats.isSymbolicLink()
        ? 'symlink'
        : 'other';
  return {
    kind,
    sizeBytes: Number.isFinite(stats.size) ? Math.max(0, Math.floor(stats.size)) : 0,
    modifiedAtMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : 0,
  };
}
