import { normalize, parse, relative, resolve, sep, win32 } from 'node:path';

export function canonicalPathKey(value: string, platform = process.platform): string {
  const normalized = normalizeAbsolutePath(value, platform);
  return platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

export function normalizeAbsolutePath(value: string, platform = process.platform): string {
  if (platform === 'win32') {
    const absolute = win32.normalize(win32.resolve(value));
    const root = win32.parse(absolute).root;
    return absolute.length > root.length ? absolute.replace(/[\\/]+$/u, '') : absolute;
  }

  const absolute = normalize(resolve(value));
  const root = parse(absolute).root;
  return absolute.length > root.length ? absolute.replace(/\/+$/u, '') : absolute;
}

export function isSameOrDescendantPath(
  candidateValue: string,
  rootValue: string,
  platform = process.platform,
): boolean {
  const candidate = normalizeAbsolutePath(candidateValue, platform);
  const root = normalizeAbsolutePath(rootValue, platform);
  const relativePath =
    platform === 'win32' ? win32.relative(root, candidate) : relative(root, candidate);
  const separator = platform === 'win32' ? win32.sep : sep;
  const pathIsAbsolute =
    platform === 'win32' ? win32.isAbsolute(relativePath) : relativePath.startsWith('/');

  return (
    relativePath === '' ||
    (!pathIsAbsolute && relativePath !== '..' && !relativePath.startsWith(`..${separator}`))
  );
}
