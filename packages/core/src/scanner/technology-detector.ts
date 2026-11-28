import type { ScanTechnology, ScanWarning } from '@repolens/shared';
import { isScanCancelled, ScanFileSystemError, throwIfScanCancelled } from './scan.errors.js';
import type { ClassifiedFile, ScanCancellation, ScanFileSystem } from './scan.types.js';

const MAX_PACKAGE_MANIFEST_BYTES = 1_048_576;

type TechnologyCategory = ScanTechnology['category'];
type TechnologyCertainty = ScanTechnology['certainty'];
type TechnologyConfidence = ScanTechnology['confidence'];

interface DetectionRecord {
  readonly name: string;
  readonly category: TechnologyCategory;
  certainty: TechnologyCertainty;
  confidence: TechnologyConfidence;
  readonly evidence: Set<string>;
}

interface PackageManifestEvidence {
  readonly relativePath: string;
  readonly dependencies: ReadonlySet<string>;
  readonly hasNodeEngine: boolean;
}

export interface TechnologyDetectionOptions {
  readonly rootPath: string;
  readonly files: readonly ClassifiedFile[];
  readonly fileSystem: ScanFileSystem;
  readonly signal: ScanCancellation;
  readonly onWarning: (warning: ScanWarning) => void;
}

export async function detectTechnologies(
  options: TechnologyDetectionOptions,
): Promise<readonly ScanTechnology[]> {
  const detections = new Map<string, DetectionRecord>();
  const manifests: PackageManifestEvidence[] = [];

  for (const entry of options.files) {
    throwIfScanCancelled(options.signal);
    if (isPackageJson(entry.file.relativePath)) {
      const manifest = await readPackageManifest(entry, options);
      if (manifest !== null) {
        manifests.push(manifest);
      }
    }
  }

  for (const manifest of manifests) {
    recordDetection(detections, {
      name: 'Node.js',
      category: 'backend',
      certainty: manifest.hasNodeEngine ? 'confirmed' : 'inferred',
      confidence: manifest.hasNodeEngine ? 'high' : 'medium',
      evidence: manifest.hasNodeEngine
        ? [`${manifest.relativePath}: engines.node`]
        : [`${manifest.relativePath}: Node package manifest`],
    });

    const packageRules: readonly PackageTechnologyRule[] = [
      { packages: ['@angular/core'], name: 'Angular', category: 'frontend' },
      { packages: ['react'], name: 'React', category: 'frontend' },
      { packages: ['vue'], name: 'Vue', category: 'frontend' },
      { packages: ['next'], name: 'Next.js', category: 'frontend' },
      { packages: ['nuxt', 'nuxt3'], name: 'Nuxt', category: 'frontend' },
      { packages: ['svelte'], name: 'Svelte', category: 'frontend' },
      {
        packages: ['@ionic/angular', '@ionic/react', '@ionic/vue', '@ionic/core'],
        name: 'Ionic',
        category: 'frontend',
      },
      { packages: ['express'], name: 'Express', category: 'backend' },
      { packages: ['@nestjs/core'], name: 'NestJS', category: 'backend' },
      { packages: ['fastify'], name: 'Fastify', category: 'backend' },
      { packages: ['koa'], name: 'Koa', category: 'backend' },
      { packages: ['mongodb'], name: 'MongoDB', category: 'database' },
      { packages: ['mongoose'], name: 'Mongoose', category: 'database' },
      { packages: ['prisma', '@prisma/client'], name: 'Prisma', category: 'database' },
      { packages: ['typeorm'], name: 'TypeORM', category: 'database' },
      { packages: ['sequelize'], name: 'Sequelize', category: 'database' },
      { packages: ['vite'], name: 'Vite', category: 'tooling' },
      { packages: ['webpack'], name: 'Webpack', category: 'tooling' },
      { packages: ['@angular/cli'], name: 'Angular CLI', category: 'tooling' },
      { packages: ['typescript'], name: 'TypeScript', category: 'tooling' },
      { packages: ['eslint'], name: 'ESLint', category: 'tooling' },
      { packages: ['prettier'], name: 'Prettier', category: 'tooling' },
      { packages: ['tailwindcss'], name: 'Tailwind CSS', category: 'tooling' },
    ];

    for (const rule of packageRules) {
      const found = rule.packages.filter((packageName) => manifest.dependencies.has(packageName));
      if (found.length === 0) {
        continue;
      }
      recordDetection(detections, {
        name: rule.name,
        category: rule.category,
        certainty: 'confirmed',
        confidence: 'high',
        evidence: found.map((packageName) => `${manifest.relativePath}: ${packageName}`),
      });
    }
  }

  for (const entry of options.files) {
    throwIfScanCancelled(options.signal);
    const name = basename(entry.file.relativePath).toLowerCase();
    const evidence = entry.file.relativePath;
    const configDetections: readonly ConfigTechnologyRule[] = [
      { test: name === 'angular.json', name: 'Angular', category: 'frontend' },
      { test: /^vite\.config\./.test(name), name: 'Vite', category: 'tooling' },
      { test: /^next\.config\./.test(name), name: 'Next.js', category: 'frontend' },
      { test: /^nuxt\.config\./.test(name), name: 'Nuxt', category: 'frontend' },
      { test: /^svelte\.config\./.test(name), name: 'Svelte', category: 'frontend' },
      { test: /^ionic\.config\./.test(name), name: 'Ionic', category: 'frontend' },
      { test: name === 'nest-cli.json', name: 'NestJS', category: 'backend' },
      {
        test: name === 'tsconfig.json' || /^tsconfig\..+\.json$/.test(name),
        name: 'TypeScript',
        category: 'tooling',
      },
      { test: /^webpack\.config\./.test(name), name: 'Webpack', category: 'tooling' },
      { test: /^tailwind\.config\./.test(name), name: 'Tailwind CSS', category: 'tooling' },
      {
        test: /^eslint\.config\./.test(name) || /^\.eslintrc/.test(name),
        name: 'ESLint',
        category: 'tooling',
      },
      {
        test: /^prettier\.config\./.test(name) || /^\.prettierrc/.test(name),
        name: 'Prettier',
        category: 'tooling',
      },
    ];
    for (const rule of configDetections) {
      if (rule.test) {
        recordDetection(detections, {
          name: rule.name,
          category: rule.category,
          certainty: 'confirmed',
          confidence: 'high',
          evidence: [evidence],
        });
      }
    }
  }

  return [...detections.values()]
    .map((detection) => ({
      name: detection.name,
      category: detection.category,
      certainty: detection.certainty,
      confidence: detection.confidence,
      evidence: [...detection.evidence].sort((left, right) => left.localeCompare(right)),
    }))
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category) || left.name.localeCompare(right.name),
    );
}

interface PackageTechnologyRule {
  readonly packages: readonly string[];
  readonly name: string;
  readonly category: TechnologyCategory;
}

interface ConfigTechnologyRule {
  readonly test: boolean;
  readonly name: string;
  readonly category: TechnologyCategory;
}

async function readPackageManifest(
  entry: ClassifiedFile,
  options: TechnologyDetectionOptions,
): Promise<PackageManifestEvidence | null> {
  let contents: string | null;
  try {
    contents = await options.fileSystem.readTextFile(
      options.rootPath,
      entry.absolutePath,
      MAX_PACKAGE_MANIFEST_BYTES,
    );
    throwIfScanCancelled(options.signal);
  } catch (error) {
    if (isScanCancelled(error, options.signal)) {
      throw error;
    }
    if (error instanceof ScanFileSystemError && error.code === 'FILE_TOO_LARGE') {
      options.onWarning({
        code: 'PACKAGE_MANIFEST_TOO_LARGE',
        message: 'A package.json file exceeded the 1 MiB inspection limit and was not analyzed.',
        relativePath: entry.file.relativePath,
      });
    } else {
      options.onWarning({
        code: 'FILE_UNAVAILABLE',
        message: 'RepoLens could not read this package.json file for technology detection.',
        relativePath: entry.file.relativePath,
      });
    }
    return null;
  }
  if (contents === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    options.onWarning({
      code: 'MALFORMED_PACKAGE_MANIFEST',
      message: 'A package.json file was malformed and was skipped for technology detection.',
      relativePath: entry.file.relativePath,
    });
    return null;
  }

  if (!isRecord(parsed)) {
    options.onWarning({
      code: 'MALFORMED_PACKAGE_MANIFEST',
      message: 'A package.json file did not contain a JSON object and was skipped.',
      relativePath: entry.file.relativePath,
    });
    return null;
  }

  const dependencies = new Set<string>();
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const value = parsed[field];
    if (!isRecord(value)) {
      continue;
    }
    for (const [name, version] of Object.entries(value)) {
      if (typeof version === 'string') {
        dependencies.add(name);
      }
    }
  }

  const engines = parsed['engines'];
  const hasNodeEngine = isRecord(engines) && typeof engines['node'] === 'string';
  return { relativePath: entry.file.relativePath, dependencies, hasNodeEngine };
}

function recordDetection(
  records: Map<string, DetectionRecord>,
  entry: {
    readonly name: string;
    readonly category: TechnologyCategory;
    readonly certainty: TechnologyCertainty;
    readonly confidence: TechnologyConfidence;
    readonly evidence: readonly string[];
  },
): void {
  const current = records.get(entry.name);
  if (current === undefined) {
    records.set(entry.name, {
      name: entry.name,
      category: entry.category,
      certainty: entry.certainty,
      confidence: entry.confidence,
      evidence: new Set(entry.evidence),
    });
    return;
  }

  if (entry.certainty === 'confirmed') {
    current.certainty = 'confirmed';
    current.confidence = 'high';
  }
  for (const evidence of entry.evidence) {
    current.evidence.add(evidence);
  }
}

function isPackageJson(relativePath: string): boolean {
  return basename(relativePath).toLowerCase() === 'package.json';
}

function basename(relativePath: string): string {
  return relativePath.slice(relativePath.lastIndexOf('/') + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
