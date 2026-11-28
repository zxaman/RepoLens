import {
  DEFAULT_EXCLUDED_DIRECTORIES,
  DEFAULT_EXCLUDED_PATTERNS,
  type ScanConfig,
  type ScanWarning,
} from '@repolens/shared';
import {
  errorCode,
  isScanCancelled,
  ScanFileSystemError,
  throwIfScanCancelled,
} from './scan.errors.js';
import type { ScanCancellation, ScanFileSystem } from './scan.types.js';

const MAX_IGNORE_FILE_BYTES = 1_048_576;
const MANDATORY_IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);
const SENSITIVE_DIRECTORY_NAMES = new Set([
  'secret',
  '.aws',
  '.azure',
  '.gnupg',
  '.ssh',
  '.kube',
  'credentials',
  'secrets',
]);
const SENSITIVE_FILE_NAMES = new Set([
  '.git-credentials',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'id_ed25519_sk',
  'id_rsa',
]);
const SENSITIVE_FILE_EXTENSIONS = ['.jks', '.keystore', '.p12', '.pfx', '.pem', '.ppk', '.key'];

interface IgnoreRule {
  readonly source: '.gitignore' | '.repolensignore' | 'user';
  readonly negated: boolean;
  readonly matches: (relativePath: string, isDirectory: boolean) => boolean;
}

export interface IgnoreDecision {
  readonly ignored: boolean;
  readonly reason?: 'mandatory' | 'sensitive' | 'user' | 'project';
  readonly mayReincludeDescendants: boolean;
}

export class IgnoreManager {
  private readonly projectRules: readonly IgnoreRule[];
  private readonly userRules: readonly IgnoreRule[];
  private readonly excludedDirectoryNames: ReadonlySet<string>;

  private constructor(
    private readonly includeSensitiveFiles: boolean,
    excludedDirectories: readonly string[],
    gitIgnoreRules: readonly IgnoreRule[],
    repoLensIgnoreRules: readonly IgnoreRule[],
    userRules: readonly IgnoreRule[],
  ) {
    this.projectRules = [...gitIgnoreRules, ...repoLensIgnoreRules];
    this.userRules = userRules;
    this.excludedDirectoryNames = new Set(excludedDirectories.map((name) => name.toLowerCase()));
  }

  static async create(
    rootPath: string,
    fileSystem: ScanFileSystem,
    config: ScanConfig,
    onWarning: (warning: ScanWarning) => void,
    signal: ScanCancellation,
  ): Promise<IgnoreManager> {
    const gitIgnoreText = await readIgnoreFile(
      rootPath,
      '.gitignore',
      fileSystem,
      onWarning,
      signal,
    );
    const repoLensIgnoreText = await readIgnoreFile(
      rootPath,
      '.repolensignore',
      fileSystem,
      onWarning,
      signal,
    );

    const userRules: IgnoreRule[] = [];
    const configuredPatterns = [
      ...new Set([...DEFAULT_EXCLUDED_PATTERNS, ...config.excludePatterns]),
    ];
    for (const pattern of configuredPatterns) {
      const matcher = compilePattern(pattern);
      if (matcher === null) {
        onWarning({
          code: 'MALFORMED_IGNORE_PATTERN',
          message: 'A malformed additional exclude pattern was skipped.',
        });
        continue;
      }
      userRules.push({ source: 'user', negated: false, matches: matcher });
    }

    return new IgnoreManager(
      config.includeSensitiveFiles,
      [...new Set([...DEFAULT_EXCLUDED_DIRECTORIES, ...config.excludedDirectories])],
      parseIgnoreRules(gitIgnoreText, '.gitignore', onWarning),
      parseIgnoreRules(repoLensIgnoreText, '.repolensignore', onWarning),
      userRules,
    );
  }

  evaluate(relativePath: string, isDirectory: boolean): IgnoreDecision {
    const normalizedPath = normalizeRelativePath(relativePath);
    if (isMandatoryPath(normalizedPath)) {
      return { ignored: true, reason: 'mandatory', mayReincludeDescendants: false };
    }

    if (!this.includeSensitiveFiles && isSensitivePath(normalizedPath)) {
      return { ignored: true, reason: 'sensitive', mayReincludeDescendants: false };
    }

    if (matchesConfiguredDirectory(normalizedPath, isDirectory, this.excludedDirectoryNames)) {
      return { ignored: true, reason: 'user', mayReincludeDescendants: false };
    }

    if (this.userRules.some((rule) => rule.matches(normalizedPath, isDirectory))) {
      return { ignored: true, reason: 'user', mayReincludeDescendants: false };
    }

    const segments = normalizedPath.split('/');
    const hasIgnoredProjectAncestor = segments.slice(0, -1).some((_, index) => {
      const ancestorPath = segments.slice(0, index + 1).join('/');
      return isProjectPathIgnored(ancestorPath, true, this.projectRules);
    });
    const isProjectPathIgnoredResult = isProjectPathIgnored(
      normalizedPath,
      isDirectory,
      this.projectRules,
    );
    const projectIgnored = hasIgnoredProjectAncestor || isProjectPathIgnoredResult;
    const hasProjectNegations = this.projectRules.some((rule) => rule.negated);

    return {
      ignored: projectIgnored,
      ...(projectIgnored ? { reason: 'project' as const } : {}),
      mayReincludeDescendants: isDirectory && projectIgnored && hasProjectNegations,
    };
  }
}

export function isSensitivePath(relativePath: string): boolean {
  const segments = normalizeRelativePath(relativePath)
    .split('/')
    .map((part) => part.toLowerCase());
  if (segments.some((segment) => SENSITIVE_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  const basename = segments.at(-1) ?? '';
  return (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    SENSITIVE_FILE_NAMES.has(basename) ||
    basename.startsWith('credentials.') ||
    SENSITIVE_FILE_EXTENSIONS.some((extension) => basename.endsWith(extension))
  );
}

async function readIgnoreFile(
  rootPath: string,
  name: '.gitignore' | '.repolensignore',
  fileSystem: ScanFileSystem,
  onWarning: (warning: ScanWarning) => void,
  signal: ScanCancellation,
): Promise<string> {
  throwIfScanCancelled(signal);
  try {
    const contents = await fileSystem.readTextFile(
      rootPath,
      joinPath(rootPath, name),
      MAX_IGNORE_FILE_BYTES,
    );
    throwIfScanCancelled(signal);
    return contents ?? '';
  } catch (error) {
    if (isScanCancelled(error, signal)) {
      throw error;
    }
    if (errorCode(error) === 'ENOENT') {
      return '';
    }
    if (error instanceof ScanFileSystemError && error.code === 'FILE_TOO_LARGE') {
      onWarning({
        code: 'IGNORE_FILE_TOO_LARGE',
        message: `The ${name} file is larger than the 1 MiB read limit and was ignored.`,
        relativePath: name,
      });
      return '';
    }

    onWarning({
      code: 'IGNORE_FILE_UNAVAILABLE',
      message: `RepoLens could not read ${name}; scanning continued with the remaining rules.`,
      relativePath: name,
    });
    return '';
  }
}

function parseIgnoreRules(
  content: string,
  source: '.gitignore' | '.repolensignore',
  onWarning: (warning: ScanWarning) => void,
): readonly IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const [index, rawLine] of content.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }

    const negated = line.startsWith('!');
    const pattern = negated ? line.slice(1).trim() : line;
    const compiled = pattern.length > 0 && pattern.length <= 256 ? compilePattern(pattern) : null;
    if (compiled === null) {
      onWarning({
        code: 'MALFORMED_IGNORE_PATTERN',
        message: `A malformed pattern on line ${index + 1} of ${source} was skipped.`,
        relativePath: source,
      });
      continue;
    }
    rules.push({ source, negated, matches: compiled });
  }
  return rules;
}

function compilePattern(rawPattern: string): IgnoreRule['matches'] | null {
  let pattern = rawPattern;
  const anchored = pattern.startsWith('/');
  if (anchored) {
    pattern = pattern.slice(1);
  }
  const directoryOnly = pattern.endsWith('/');
  if (directoryOnly) {
    pattern = pattern.slice(0, -1);
  }
  if (pattern.length === 0 || pattern.startsWith('!') || pattern.includes('\0')) {
    return null;
  }

  const hasSlash = pattern.includes('/');
  const regex = globToRegExp(pattern);
  if (regex === null) {
    return null;
  }

  return (relativePath, isDirectory) => {
    const candidates = pathPrefixes(relativePath, directoryOnly ? isDirectory : true);
    return candidates.some((candidate) => {
      if (anchored || hasSlash) {
        return regex.test(candidate);
      }
      return candidate.split('/').some((segment) => regex.test(segment));
    });
  };
}

function globToRegExp(pattern: string): RegExp | null {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? '';
    const next = pattern[index + 1] ?? '';

    if (character === '*' && next === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
      continue;
    }
    if (character === '*') {
      source += '[^/]*';
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    if (character === '[') {
      const closingBracket = pattern.indexOf(']', index + 1);
      if (closingBracket <= index + 1) {
        return null;
      }
      let characterClass = pattern.slice(index + 1, closingBracket);
      if (characterClass.startsWith('!')) {
        characterClass = `^${characterClass.slice(1)}`;
      }
      source += `[${characterClass}]`;
      index = closingBracket;
      continue;
    }
    source += escapeRegExp(character);
  }

  try {
    return new RegExp(`${source}$`);
  } catch {
    return null;
  }
}

function isProjectPathIgnored(
  relativePath: string,
  isDirectory: boolean,
  rules: readonly IgnoreRule[],
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.matches(relativePath, isDirectory)) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}

function pathPrefixes(relativePath: string, includeTarget: boolean): readonly string[] {
  const segments = relativePath.split('/');
  const end = includeTarget ? segments.length : Math.max(0, segments.length - 1);
  const prefixes: string[] = [];
  for (let index = 1; index <= end; index += 1) {
    prefixes.push(segments.slice(0, index).join('/'));
  }
  return prefixes;
}

function matchesConfiguredDirectory(
  relativePath: string,
  isDirectory: boolean,
  excludedDirectoryNames: ReadonlySet<string>,
): boolean {
  const segments = relativePath.split('/');
  const directorySegments = isDirectory ? segments : segments.slice(0, -1);
  return directorySegments.some((segment) => excludedDirectoryNames.has(segment.toLowerCase()));
}

function isMandatoryPath(relativePath: string): boolean {
  return relativePath
    .split('/')
    .some((segment) => MANDATORY_IGNORED_DIRECTORIES.has(segment.toLowerCase()));
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function escapeRegExp(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

function joinPath(rootPath: string, name: string): string {
  const separator = rootPath.includes('\\') ? '\\' : '/';
  return `${rootPath.replace(/[\\/]$/, '')}${separator}${name}`;
}
