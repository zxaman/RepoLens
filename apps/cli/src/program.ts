import { readFileSync } from 'node:fs';
import { Command } from 'commander';

interface PackageMetadata {
  readonly version: string;
}

export function getPackageVersion(): string {
  const packageMetadataUrl = new URL('../package.json', import.meta.url);
  const packageMetadata: unknown = JSON.parse(readFileSync(packageMetadataUrl, 'utf8'));

  if (
    typeof packageMetadata !== 'object' ||
    packageMetadata === null ||
    !('version' in packageMetadata) ||
    typeof packageMetadata.version !== 'string'
  ) {
    throw new Error('The CLI package metadata does not contain a valid version.');
  }

  return (packageMetadata as PackageMetadata).version;
}

export function createCliProgram(): Command {
  return new Command('repolens')
    .description('Analyze once. Understand anywhere. Local-first repository intelligence.')
    .version(getPackageVersion())
    .helpOption('-h, --help', 'display help for command');
}
