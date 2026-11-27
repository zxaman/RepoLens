import { rm } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const generatedPaths = [
  'apps/desktop/dist',
  'apps/desktop/out-tsc',
  'apps/desktop/.angular',
  'apps/cli/dist',
  'packages/shared/dist',
  'packages/core/dist',
  'packages/language-support/dist',
  'packages/database/dist',
  'packages/export/dist',
  'packages/ai/dist',
  'coverage',
  '.angular',
];

for (const generatedPath of generatedPaths) {
  const absolutePath = resolve(repositoryRoot, generatedPath);
  const pathFromRoot = relative(repositoryRoot, absolutePath);
  if (
    isAbsolute(pathFromRoot) ||
    pathFromRoot === '' ||
    pathFromRoot === '..' ||
    pathFromRoot.startsWith(`..${sep}`)
  ) {
    throw new Error(`Refusing to clean a path outside the repository: ${generatedPath}`);
  }

  await rm(absolutePath, { recursive: true, force: true });
}

console.log('Removed generated RepoLens build and test output.');
