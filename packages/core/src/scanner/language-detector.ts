import type { ScanLanguageStat } from '@repolens/shared';
import type { ScanFile } from '@repolens/shared';

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'SCSS',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.mdx': 'Markdown',
  '.py': 'Python',
  '.java': 'Java',
  '.go': 'Go',
  '.rs': 'Rust',
  '.php': 'PHP',
  '.c': 'C',
  '.h': 'C/C++',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.cxx': 'C++',
  '.hpp': 'C++',
  '.hh': 'C++',
  '.cs': 'C#',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.fish': 'Shell',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.xml': 'XML',
  '.sql': 'SQL',
};

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.php',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
  '.hpp',
  '.hh',
  '.cs',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
]);

export function getFileExtension(relativePath: string): string {
  const basename = relativePath.slice(relativePath.lastIndexOf('/') + 1);
  const lastDot = basename.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === basename.length - 1) {
    return '';
  }
  return basename.slice(lastDot).toLowerCase();
}

export function detectLanguage(relativePath: string): string | null {
  const extension = getFileExtension(relativePath);
  return LANGUAGE_BY_EXTENSION[extension] ?? null;
}

export function isSourceExtension(extension: string): boolean {
  return SOURCE_EXTENSIONS.has(extension.toLowerCase());
}

export function calculateLanguageStatistics(
  files: readonly ScanFile[],
): readonly ScanLanguageStat[] {
  const totals = new Map<string, { fileCount: number; totalBytes: number }>();
  for (const file of files) {
    if (file.language === null) {
      continue;
    }
    const entry = totals.get(file.language) ?? { fileCount: 0, totalBytes: 0 };
    entry.fileCount += 1;
    entry.totalBytes += file.sizeBytes;
    totals.set(file.language, entry);
  }

  return [...totals.entries()]
    .map(([name, totalsForLanguage]) => ({ name, ...totalsForLanguage }))
    .sort(
      (left, right) => right.totalBytes - left.totalBytes || left.name.localeCompare(right.name),
    );
}
