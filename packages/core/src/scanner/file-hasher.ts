import type { ScanProgress, ScanWarning } from '@repolens/shared';
import { isScanCancelled } from './scan.errors.js';
import type { ClassifiedFile, ScanCancellation, ScanFileSystem } from './scan.types.js';
import { ScanFileSystemError } from './scan.errors.js';

export interface FileHashingOptions {
  readonly scanId: string;
  readonly projectId: string;
  readonly rootPath: string;
  readonly files: readonly ClassifiedFile[];
  readonly fileSystem: ScanFileSystem;
  readonly signal: ScanCancellation;
  readonly maxHashBytes: number;
  readonly filesDiscovered: number;
  readonly directoriesProcessed: number;
  readonly onProgress?: (progress: ScanProgress) => void;
  readonly onWarning: (warning: ScanWarning) => void;
}

export interface FileHashingResult {
  readonly files: readonly ClassifiedFile[];
  readonly filesProcessed: number;
  readonly bytesHashed: number;
  readonly cancelled: boolean;
}

export async function hashDiscoveredFiles(options: FileHashingOptions): Promise<FileHashingResult> {
  const {
    scanId,
    projectId,
    rootPath,
    files,
    fileSystem,
    signal,
    maxHashBytes,
    filesDiscovered,
    directoriesProcessed,
    onProgress,
    onWarning,
  } = options;
  const hashedFiles = files.map((entry) => ({ ...entry, file: { ...entry.file } }));
  let filesProcessed = 0;
  let bytesHashed = 0;
  let cancelled = false;

  emitProgress(undefined);
  for (let index = 0; index < hashedFiles.length; index += 1) {
    if (signal.aborted) {
      cancelled = true;
      break;
    }
    const entry = hashedFiles[index];
    if (entry === undefined) {
      continue;
    }

    if (entry.file.sizeBytes > maxHashBytes) {
      entry.file.hashStatus = 'skipped-size-limit';
      filesProcessed += 1;
      emitProgress(entry.file.relativePath);
      continue;
    }

    try {
      const hash = await fileSystem.hashFile(rootPath, entry.absolutePath, signal, maxHashBytes);
      entry.file.hashStatus = 'hashed';
      entry.file.sha256 = hash.sha256;
      bytesHashed += hash.bytesRead;
      filesProcessed += 1;
      if (hash.bytesRead !== entry.file.sizeBytes) {
        onWarning({
          code: 'FILE_CHANGED_DURING_SCAN',
          message:
            'The file size changed while it was being hashed; recorded metadata may be stale.',
          relativePath: entry.file.relativePath,
        });
      }
    } catch (error) {
      if (isScanCancelled(error, signal)) {
        cancelled = true;
        break;
      }
      if (error instanceof ScanFileSystemError && error.code === 'FILE_TOO_LARGE') {
        entry.file.hashStatus = 'skipped-size-limit';
      } else {
        entry.file.hashStatus = 'failed';
        onWarning({
          code: 'HASH_FAILED',
          message: 'RepoLens could not hash this file; its metadata is still available.',
          relativePath: entry.file.relativePath,
        });
      }
      filesProcessed += 1;
    }
    emitProgress(entry.file.relativePath);
  }

  return {
    files: hashedFiles,
    filesProcessed,
    bytesHashed,
    cancelled: cancelled || signal.aborted,
  };

  function emitProgress(currentPath: string | undefined): void {
    const percentage =
      hashedFiles.length === 0
        ? undefined
        : Math.round((filesProcessed / hashedFiles.length) * 100);
    const progress: ScanProgress = {
      scanId,
      projectId,
      phase: 'hashing',
      filesDiscovered,
      filesProcessed,
      directoriesProcessed,
      totalBytesProcessed: bytesHashed,
      filesTotal: hashedFiles.length,
      ...(currentPath === undefined ? {} : { currentPath }),
      ...(percentage === undefined ? {} : { percentage }),
    };
    onProgress?.(progress);
  }
}
