import type { ScanWarning } from '@repolens/shared';
import { ScanRootError, errorCode } from './scan.errors.js';
import { IgnoreManager } from './ignore-manager.js';
import type {
  DirectoryWalkResult,
  ScanExecutionContext,
  ScanFileSystem,
  WalkedFile,
} from './scan.types.js';

export interface DirectoryWalkerOptions {
  readonly rootPath: string;
  readonly fileSystem: ScanFileSystem;
  readonly ignoreManager: IgnoreManager;
  readonly execution: ScanExecutionContext;
  readonly onWarning: (warning: ScanWarning) => void;
}

export async function walkDirectoryTree(
  options: DirectoryWalkerOptions,
): Promise<DirectoryWalkResult> {
  const { rootPath, fileSystem, ignoreManager, execution, onWarning } = options;
  const files: WalkedFile[] = [];
  const visitedDirectories = new Set<string>();
  const visitedFiles = new Set<string>();
  const warnings: ScanWarning[] = [];
  let ignoredFiles = 0;
  let ignoredDirectories = 0;
  let sensitiveEntriesExcluded = 0;
  let symlinksSkipped = 0;
  let cancelled = false;

  const recordWarning = (warning: ScanWarning): void => {
    warnings.push(warning);
    onWarning(warning);
  };

  const rootRealPath = await fileSystem.realpath(rootPath);
  const rootInfo = await fileSystem.stat(rootRealPath);
  if (rootInfo.kind !== 'directory') {
    throw new ScanRootError('ROOT_NOT_DIRECTORY', 'The selected project path is not a directory.');
  }
  visitedDirectories.add(rootRealPath);

  interface DirectoryTask {
    readonly absolutePath: string;
    readonly relativePath: string;
  }
  const pendingDirectories: DirectoryTask[] = [{ absolutePath: rootRealPath, relativePath: '' }];

  while (pendingDirectories.length > 0) {
    if (execution.signal.aborted) {
      cancelled = true;
      break;
    }

    const current = pendingDirectories.pop();
    if (current === undefined) {
      break;
    }
    execution.counts.directoriesProcessed += 1;
    emitWalkProgress(execution, current.relativePath);

    let names: readonly string[];
    try {
      names = [...(await fileSystem.readdir(current.absolutePath))].sort((left, right) =>
        left.localeCompare(right),
      );
    } catch (error) {
      if (current.relativePath.length === 0) {
        const code = errorCode(error);
        throw new ScanRootError(
          code === 'EACCES' || code === 'EPERM' ? 'PERMISSION_DENIED' : 'ROOT_UNAVAILABLE',
          code === 'EACCES' || code === 'EPERM'
            ? 'RepoLens does not have permission to read the selected project folder.'
            : 'RepoLens could not read the selected project folder.',
        );
      }
      recordWarning({
        code: 'DIRECTORY_UNAVAILABLE',
        message: 'RepoLens could not read this directory; the rest of the scan continued.',
        relativePath: current.relativePath,
      });
      continue;
    }

    const childDirectories: DirectoryTask[] = [];
    for (const name of names) {
      if (execution.signal.aborted) {
        cancelled = true;
        break;
      }

      const physicalPath = joinPath(current.absolutePath, name);
      const relativePath = appendRelativePath(current.relativePath, name);
      if (relativePath === null) {
        recordWarning({
          code: 'UNSAFE_PATH_SKIPPED',
          message:
            'A filesystem entry had a path RepoLens could not safely represent and was skipped.',
        });
        continue;
      }
      let linkInfo;
      try {
        linkInfo = await fileSystem.lstat(physicalPath);
      } catch {
        recordWarning({
          code: 'FILE_UNAVAILABLE',
          message: 'A filesystem entry became unavailable during scanning.',
          relativePath,
        });
        continue;
      }

      if (linkInfo.kind === 'symlink') {
        const previousFileCount = files.length;
        const symlinkResult = await inspectSymlink({
          physicalPath,
          relativePath,
          rootRealPath,
          fileSystem,
          ignoreManager,
          visitedDirectories,
          visitedFiles,
          files,
          childDirectories,
          recordWarning,
        });
        ignoredFiles += symlinkResult.ignoredFiles;
        ignoredDirectories += symlinkResult.ignoredDirectories;
        sensitiveEntriesExcluded += symlinkResult.sensitiveEntriesExcluded;
        symlinksSkipped += symlinkResult.symlinksSkipped;
        if (files.length > previousFileCount) {
          execution.counts.filesDiscovered += files.length - previousFileCount;
          emitWalkProgress(execution, relativePath);
        }
        continue;
      }

      const isDirectory = linkInfo.kind === 'directory';
      const decision = ignoreManager.evaluate(relativePath, isDirectory);
      if (decision.ignored) {
        if (isDirectory) {
          if (!decision.mayReincludeDescendants) {
            ignoredDirectories += 1;
            if (decision.reason === 'sensitive') {
              sensitiveEntriesExcluded += 1;
              recordWarning({
                code: 'SENSITIVE_FILE_EXCLUDED',
                message: 'A sensitive directory was excluded by RepoLens safety defaults.',
                relativePath,
              });
            }
            continue;
          }
        } else {
          ignoredFiles += 1;
          if (decision.reason === 'sensitive') {
            sensitiveEntriesExcluded += 1;
            recordWarning({
              code: 'SENSITIVE_FILE_EXCLUDED',
              message: 'A sensitive file was excluded by RepoLens safety defaults.',
              relativePath,
            });
          }
          continue;
        }
      }

      if (isDirectory) {
        await queueDirectory({
          absolutePath: physicalPath,
          relativePath,
          rootRealPath,
          fileSystem,
          visitedDirectories,
          childDirectories,
          recordWarning,
          isSymlink: false,
        });
      } else if (linkInfo.kind === 'file') {
        const file = await addFileCandidate({
          absolutePath: physicalPath,
          relativePath,
          rootRealPath,
          fileSystem,
          visitedFiles,
          files,
          recordWarning,
        });
        if (file !== null) {
          execution.counts.filesDiscovered += 1;
          emitWalkProgress(execution, relativePath);
        }
      }
    }

    for (let index = childDirectories.length - 1; index >= 0; index -= 1) {
      const child = childDirectories[index];
      if (child !== undefined) {
        pendingDirectories.push(child);
      }
    }
    if (cancelled) {
      break;
    }
  }

  return {
    files,
    directoriesDiscovered: execution.counts.directoriesProcessed,
    ignoredFiles,
    ignoredDirectories,
    sensitiveEntriesExcluded,
    symlinksSkipped,
    warnings,
    cancelled: cancelled || execution.signal.aborted,
  };
}

interface SymlinkInspectionOptions {
  readonly physicalPath: string;
  readonly relativePath: string;
  readonly rootRealPath: string;
  readonly fileSystem: ScanFileSystem;
  readonly ignoreManager: IgnoreManager;
  readonly visitedDirectories: Set<string>;
  readonly visitedFiles: Set<string>;
  readonly files: WalkedFile[];
  readonly childDirectories: DirectoryTask[];
  readonly recordWarning: (warning: ScanWarning) => void;
}

interface DirectoryTask {
  readonly absolutePath: string;
  readonly relativePath: string;
}

interface SymlinkInspectionResult {
  readonly ignoredFiles: number;
  readonly ignoredDirectories: number;
  readonly sensitiveEntriesExcluded: number;
  readonly symlinksSkipped: number;
}

async function inspectSymlink(options: SymlinkInspectionOptions): Promise<SymlinkInspectionResult> {
  const {
    physicalPath,
    relativePath,
    rootRealPath,
    fileSystem,
    ignoreManager,
    visitedDirectories,
    visitedFiles,
    files,
    childDirectories,
    recordWarning,
  } = options;
  const empty = { ignoredFiles: 0, ignoredDirectories: 0, sensitiveEntriesExcluded: 0 };

  let resolvedPath: string;
  try {
    resolvedPath = await fileSystem.realpath(physicalPath);
  } catch {
    return { ...empty, symlinksSkipped: 1 };
  }
  if (!fileSystem.isWithinRoot(rootRealPath, resolvedPath)) {
    recordWarning({
      code: 'SYMLINK_OUTSIDE_ROOT',
      message: 'A symbolic link pointing outside the selected project was not followed.',
      relativePath,
    });
    return { ...empty, symlinksSkipped: 1 };
  }

  let targetInfo;
  try {
    targetInfo = await fileSystem.stat(resolvedPath);
  } catch {
    return { ...empty, symlinksSkipped: 1 };
  }
  if (targetInfo.kind !== 'directory' && targetInfo.kind !== 'file') {
    return { ...empty, symlinksSkipped: 1 };
  }

  const targetRelativePath = fileSystem.relativePath(rootRealPath, resolvedPath);
  if (targetRelativePath === null) {
    recordWarning({
      code: 'SYMLINK_OUTSIDE_ROOT',
      message: 'A symbolic link pointing outside the selected project was not followed.',
      relativePath,
    });
    return { ...empty, symlinksSkipped: 1 };
  }

  const isDirectory = targetInfo.kind === 'directory';
  const decision = ignoreManager.evaluate(relativePath, isDirectory);
  const targetDecision = ignoreManager.evaluate(targetRelativePath, isDirectory);
  const sensitiveTarget = decision.reason === 'sensitive' || targetDecision.reason === 'sensitive';
  const userExcludedTarget =
    decision.reason === 'mandatory' ||
    decision.reason === 'user' ||
    targetDecision.reason === 'mandatory' ||
    targetDecision.reason === 'user';
  const targetIgnoredByProject = targetDecision.reason === 'project' && targetDecision.ignored;
  const ignoreBlocked =
    sensitiveTarget ||
    userExcludedTarget ||
    targetIgnoredByProject ||
    (decision.ignored && !(isDirectory && decision.mayReincludeDescendants));
  if (ignoreBlocked) {
    if (sensitiveTarget) {
      recordWarning({
        code: 'SENSITIVE_FILE_EXCLUDED',
        message: isDirectory
          ? 'A sensitive directory was excluded by RepoLens safety defaults.'
          : 'A sensitive file was excluded by RepoLens safety defaults.',
        relativePath,
      });
    }
    return {
      ignoredFiles: isDirectory ? 0 : 1,
      ignoredDirectories: isDirectory ? 1 : 0,
      sensitiveEntriesExcluded: sensitiveTarget ? 1 : 0,
      symlinksSkipped: sensitiveTarget ? 1 : 0,
    };
  }

  if (isDirectory) {
    if (visitedDirectories.has(resolvedPath)) {
      recordWarning({
        code: 'SYMLINK_CYCLE',
        message: 'A symbolic link to a directory already scanned was skipped.',
        relativePath,
      });
      return { ...empty, symlinksSkipped: 1 };
    }
    visitedDirectories.add(resolvedPath);
    childDirectories.push({ absolutePath: resolvedPath, relativePath });
    return { ...empty, symlinksSkipped: 0 };
  }

  const file = await addFileCandidate({
    absolutePath: resolvedPath,
    relativePath,
    rootRealPath,
    fileSystem,
    visitedFiles,
    files,
    recordWarning,
  });
  return {
    ...empty,
    symlinksSkipped: file === null ? 1 : 0,
  };
}

interface QueueDirectoryOptions {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly rootRealPath: string;
  readonly fileSystem: ScanFileSystem;
  readonly visitedDirectories: Set<string>;
  readonly childDirectories: DirectoryTask[];
  readonly recordWarning: (warning: ScanWarning) => void;
  readonly isSymlink: boolean;
}

async function queueDirectory(options: QueueDirectoryOptions): Promise<void> {
  const {
    absolutePath,
    relativePath,
    rootRealPath,
    fileSystem,
    visitedDirectories,
    childDirectories,
    recordWarning,
    isSymlink,
  } = options;
  let resolvedPath: string;
  try {
    resolvedPath = await fileSystem.realpath(absolutePath);
  } catch {
    recordWarning({
      code: 'DIRECTORY_UNAVAILABLE',
      message: 'RepoLens could not resolve this directory; the rest of the scan continued.',
      relativePath,
    });
    return;
  }

  if (!fileSystem.isWithinRoot(rootRealPath, resolvedPath)) {
    recordWarning({
      code: 'SYMLINK_OUTSIDE_ROOT',
      message: 'A directory resolving outside the selected project was not followed.',
      relativePath,
    });
    return;
  }
  if (visitedDirectories.has(resolvedPath)) {
    if (isSymlink) {
      recordWarning({
        code: 'SYMLINK_CYCLE',
        message: 'A symbolic link to a directory already scanned was skipped.',
        relativePath,
      });
    }
    return;
  }

  visitedDirectories.add(resolvedPath);
  childDirectories.push({ absolutePath: resolvedPath, relativePath });
}

interface AddFileOptions {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly rootRealPath: string;
  readonly fileSystem: ScanFileSystem;
  readonly visitedFiles: Set<string>;
  readonly files: WalkedFile[];
  readonly recordWarning: (warning: ScanWarning) => void;
}

async function addFileCandidate(options: AddFileOptions): Promise<WalkedFile | null> {
  const {
    absolutePath,
    relativePath,
    rootRealPath,
    fileSystem,
    visitedFiles,
    files,
    recordWarning,
  } = options;
  let resolvedPath: string;
  try {
    resolvedPath = await fileSystem.realpath(absolutePath);
  } catch {
    recordWarning({
      code: 'FILE_UNAVAILABLE',
      message: 'A file became unavailable while RepoLens was discovering project files.',
      relativePath,
    });
    return null;
  }
  if (!fileSystem.isWithinRoot(rootRealPath, resolvedPath)) {
    recordWarning({
      code: 'SYMLINK_OUTSIDE_ROOT',
      message: 'A file resolving outside the selected project was not followed.',
      relativePath,
    });
    return null;
  }
  if (visitedFiles.has(resolvedPath)) {
    recordWarning({
      code: 'DUPLICATE_FILE_SKIPPED',
      message: 'A duplicate filesystem target was discovered through another path and skipped.',
      relativePath,
    });
    return null;
  }

  let info;
  try {
    info = await fileSystem.stat(resolvedPath);
  } catch {
    recordWarning({
      code: 'FILE_UNAVAILABLE',
      message: 'A file became unavailable while RepoLens was discovering project files.',
      relativePath,
    });
    return null;
  }
  if (info.kind !== 'file') {
    return null;
  }

  visitedFiles.add(resolvedPath);
  const file: WalkedFile = {
    absolutePath: resolvedPath,
    relativePath,
    sizeBytes: info.sizeBytes,
    modifiedAtMs: info.modifiedAtMs,
  };
  files.push(file);
  return file;
}

function emitWalkProgress(execution: ScanExecutionContext, currentPath: string): void {
  execution.onProgress?.({
    scanId: execution.scanId,
    projectId: execution.projectId,
    phase: 'walking',
    filesDiscovered: execution.counts.filesDiscovered,
    filesProcessed: execution.counts.filesProcessed,
    directoriesProcessed: execution.counts.directoriesProcessed,
    totalBytesProcessed: execution.counts.totalBytesProcessed,
    ...(currentPath.length > 0 ? { currentPath } : {}),
  });
}

function appendRelativePath(parent: string, name: string): string | null {
  const normalizedName = name.replaceAll('%', '%25').replaceAll('\\', '%5C');
  const relativePath = parent.length === 0 ? normalizedName : `${parent}/${normalizedName}`;
  const segments = relativePath.split('/');
  if (
    relativePath.length > 4096 ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    return null;
  }
  return relativePath;
}

function joinPath(parent: string, name: string): string {
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return `${parent.replace(/[\\/]$/, '')}${separator}${name}`;
}
