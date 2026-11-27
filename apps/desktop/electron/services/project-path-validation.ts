import { constants } from 'node:fs';
import { access, lstat, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, parse, resolve } from 'node:path';
import { projectIndicatorSchema, type ProjectIndicator } from '@repolens/shared';
import { isSameOrDescendantPath, normalizeAbsolutePath } from './project-path-utils.js';
import { ServiceError } from './service-error.js';

const INDICATORS = projectIndicatorSchema.options;

export interface InspectedProjectFolder {
  readonly name: string;
  readonly rootPath: string;
  readonly repositoryType: 'git' | 'local';
  readonly repositoryIndicators: readonly ProjectIndicator[];
}

export async function inspectProjectFolder(selectedPath: string): Promise<InspectedProjectFolder> {
  if (selectedPath.trim().length === 0 || !isAbsolute(selectedPath)) {
    throw new ServiceError('INVALID_PROJECT_PATH', 'Select a valid absolute folder path.');
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(resolve(selectedPath));
  } catch (error) {
    throw projectPathError(error);
  }

  if (isFilesystemRoot(canonicalPath) || isProhibitedSystemDirectory(canonicalPath)) {
    throw new ServiceError('PROHIBITED_PATH', 'Choose a project folder, not a system directory.');
  }
  if (canonicalPath.length > 4096) {
    throw new ServiceError(
      'INVALID_PROJECT_PATH',
      'The selected folder path is too long for RepoLens.',
    );
  }

  try {
    const folderStats = await stat(canonicalPath);
    if (!folderStats.isDirectory()) {
      throw new ServiceError('INVALID_PROJECT_PATH', 'The selected location is not a folder.');
    }
    await access(canonicalPath, constants.R_OK | constants.X_OK);
  } catch (error) {
    if (error instanceof ServiceError) {
      throw error;
    }
    throw projectPathError(error);
  }

  const name = basename(canonicalPath).trim();
  if (!isValidProjectFolderName(name)) {
    throw new ServiceError('INVALID_PROJECT_PATH', 'The selected folder has an invalid name.');
  }

  const entries = await Promise.all(
    INDICATORS.map(async (indicator) => {
      try {
        const marker = await lstat(join(canonicalPath, indicator));
        return marker.isFile() || marker.isDirectory() ? indicator : null;
      } catch (error) {
        if (isNodeError(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
          return null;
        }
        throw projectPathError(error);
      }
    }),
  );

  const repositoryIndicators = entries.filter((entry): entry is ProjectIndicator => entry !== null);
  return {
    name,
    rootPath: canonicalPath,
    repositoryType: repositoryIndicators.includes('.git') ? 'git' : 'local',
    repositoryIndicators,
  };
}

export function isValidProjectFolderName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    name !== '.' &&
    name !== '..' &&
    ![...name].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return character === '/' || character === '\\' || codePoint < 0x20 || codePoint === 0x7f;
    })
  );
}

export function isFilesystemRoot(pathValue: string): boolean {
  const normalized = normalizeAbsolutePath(pathValue);
  return normalized === parse(normalized).root;
}

export function isProhibitedSystemDirectory(
  pathValue: string,
  platform = process.platform,
): boolean {
  const roots = platform === 'win32' ? windowsSystemRoots() : posixSystemRoots(platform);
  return roots.some((root) => isSameOrDescendantPath(pathValue, root, platform));
}

function posixSystemRoots(platform: string): readonly string[] {
  const roots = [
    '/bin',
    '/boot',
    '/dev',
    '/etc',
    '/lib',
    '/lib64',
    '/proc',
    '/root',
    '/run',
    '/sbin',
    '/sys',
    '/usr',
    '/var',
  ];
  return platform === 'darwin'
    ? [...roots, '/System', '/Library', '/private/etc', '/private/var']
    : roots;
}

function windowsSystemRoots(): readonly string[] {
  const env = process.env;
  return [
    env['SystemRoot'] ?? env['WINDIR'] ?? 'C:\\Windows',
    env['ProgramFiles'] ?? 'C:\\Program Files',
    env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    env['ProgramData'] ?? 'C:\\ProgramData',
  ];
}

function projectPathError(error: unknown): ServiceError {
  if (error instanceof ServiceError) {
    return error;
  }
  if (isNodeError(error)) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      return new ServiceError('INVALID_PROJECT_PATH', 'The selected folder no longer exists.');
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return new ServiceError('PERMISSION_DENIED', 'RepoLens cannot access the selected folder.');
    }
  }
  return new ServiceError(
    'INVALID_PROJECT_PATH',
    'RepoLens could not validate the selected folder.',
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
