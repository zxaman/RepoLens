import type { ScanClassification } from '@repolens/shared';
import { detectLanguage, getFileExtension, isSourceExtension } from './language-detector.js';

const PACKAGE_MANIFEST_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'requirements.txt',
  'pyproject.toml',
  'pipfile',
  'pipfile.lock',
  'cargo.toml',
  'cargo.lock',
  'go.mod',
  'go.sum',
  'pom.xml',
  'composer.json',
  'composer.lock',
  'gemfile',
  'gemfile.lock',
]);

const DOCUMENTATION_NAMES = new Set([
  'readme',
  'readme.md',
  'readme.mdx',
  'changelog',
  'changelog.md',
  'contributing',
  'contributing.md',
  'license',
  'license.md',
  'security.md',
  'code_of_conduct.md',
]);

const ASSET_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp',
  '.mp3',
  '.mp4',
  '.ogg',
  '.pdf',
  '.wav',
  '.zip',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
]);

export function classifyFile(relativePath: string): ScanClassification {
  const basename = relativePath.slice(relativePath.lastIndexOf('/') + 1).toLowerCase();
  const extension = getFileExtension(relativePath);

  if (PACKAGE_MANIFEST_NAMES.has(basename)) {
    return 'package-manifest';
  }
  if (DOCUMENTATION_NAMES.has(basename) || extension === '.md' || extension === '.mdx') {
    return 'documentation';
  }
  if (isConfigurationFile(basename)) {
    return 'configuration';
  }
  if (ASSET_EXTENSIONS.has(extension)) {
    return 'asset';
  }
  if (isSourceExtension(extension)) {
    return 'source';
  }
  return 'other';
}

export function isConfigurationFileName(fileName: string): boolean {
  return isConfigurationFile(fileName.slice(fileName.lastIndexOf('/') + 1).toLowerCase());
}

export function isPackageManifestName(fileName: string): boolean {
  return PACKAGE_MANIFEST_NAMES.has(fileName.slice(fileName.lastIndexOf('/') + 1).toLowerCase());
}

export function detectFileLanguage(relativePath: string): string | null {
  return detectLanguage(relativePath);
}

function isConfigurationFile(basename: string): boolean {
  return (
    basename === '.gitignore' ||
    basename === '.repolensignore' ||
    basename === '.editorconfig' ||
    basename === '.browserslistrc' ||
    basename === 'angular.json' ||
    basename === 'nest-cli.json' ||
    basename === 'tsconfig.json' ||
    /^tsconfig\..+\.json$/.test(basename) ||
    basename === 'dockerfile' ||
    /^docker-compose\..+$/.test(basename) ||
    basename === 'makefile' ||
    /^(?:vite|next|nuxt|svelte|webpack|tailwind|postcss|babel)\.config\..+$/.test(basename) ||
    /^eslint\.config\..+$/.test(basename) ||
    /^\.eslintrc(?:\..+)?$/.test(basename) ||
    /^prettier\.config\..+$/.test(basename) ||
    /^\.prettierrc(?:\..+)?$/.test(basename) ||
    /^\.npmrc$/.test(basename) ||
    /^\.nvmrc$/.test(basename)
  );
}
