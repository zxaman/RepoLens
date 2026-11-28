import {
  analysisResultSchema,
  scanFileSchema,
  scanResultSchema,
  type ScanFile,
  type ScanResult,
} from '@repolens/shared';
import { describe, expect, it, vi } from 'vitest';
import { analyzeScan, STATIC_ANALYSIS_LIMITS } from './static-analysis.js';
import type {
  ParsedExport,
  ParsedImport,
  ParsedPathMapping,
  ParsedResolutionConfigResult,
  ParsedSourceFile,
  StaticAnalysisFileSystem,
  StaticAnalysisParser,
} from './static-analysis.types.js';

const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const scanId = '92370c1b-8755-4057-ae23-0d885ad4d94b';
const analysisId = '7d707ca0-312b-4a6f-8950-8df3441d973a';
const timestamp = '2026-11-27T00:00:00.000Z';

function sourceFile(
  relativePath: string,
  language: 'TypeScript' | 'JavaScript' = 'TypeScript',
  sizeBytes = 32,
): ScanFile {
  return scanFileSchema.parse({
    relativePath,
    extension: relativePath.slice(relativePath.lastIndexOf('.')),
    sizeBytes,
    modifiedAt: timestamp,
    classification: 'source',
    language,
    hashStatus: 'not-attempted',
  });
}

function configFile(relativePath: string, sizeBytes = 64): ScanFile {
  return scanFileSchema.parse({
    relativePath,
    extension: '.json',
    sizeBytes,
    modifiedAt: timestamp,
    classification: 'configuration',
    language: 'JSON',
    hashStatus: 'not-attempted',
  });
}

function makeScan(
  files: readonly ScanFile[],
  status: ScanResult['status'] = 'completed',
): ScanResult {
  return scanResultSchema.parse({
    id: scanId,
    projectId,
    status,
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 0,
    directoriesDiscovered: 2,
    filesDiscovered: files.length,
    filesProcessed: files.length,
    sourceFiles: files.filter((file) => file.classification === 'source').length,
    configurationFiles: files.filter((file) => file.classification === 'configuration').length,
    packageManifests: 0,
    documentationFiles: 0,
    assetFiles: 0,
    otherFiles: 0,
    ignoredFiles: 0,
    ignoredDirectories: 0,
    sensitiveEntriesExcluded: 0,
    symlinksSkipped: 0,
    bytesHashed: 0,
    languages: [],
    technologies: [],
    warnings: [],
    files,
    errors: [],
  });
}

function location(filePath: string, line: number, column = 1) {
  return {
    filePath,
    startLine: line,
    startColumn: column,
    endLine: line,
    endColumn: column + 1,
  };
}

function makeEntryAst(filePath: string): ParsedSourceFile {
  const imports: ParsedImport[] = [
    ['./util', 'static', 2],
    ['@/helper', 'static', 3],
    ['react/jsx-runtime', 'static', 4],
    ['./missing', 'static', 5],
  ].map(([specifier, kind, line], index) => ({
    key: `import-${index}`,
    specifier: String(specifier),
    kind: kind as ParsedImport['kind'],
    bindings: [],
    isTypeOnly: false,
    location: location(filePath, Number(line)),
  }));
  const exports: ParsedExport[] = [
    {
      key: 'export-0',
      name: 'answer',
      kind: 'named',
      localName: 'answer',
      isTypeOnly: false,
      location: location(filePath, 7),
    },
  ];
  return {
    symbols: [
      {
        key: 'module',
        name: 'entry.ts',
        kind: 'module',
        location: {
          filePath,
          startLine: 1,
          startColumn: 1,
          endLine: 8,
          endColumn: 1,
        },
        exported: false,
      },
      {
        key: 'answer-symbol',
        name: 'answer',
        kind: 'function',
        location: location(filePath, 7),
        parentKey: 'module',
        exported: false,
      },
    ],
    imports,
    exports,
    diagnostics: [],
    truncated: false,
  };
}

class FixtureParser implements StaticAnalysisParser {
  readonly id = 'fixture-parser';
  readonly languageNames = ['TypeScript', 'JavaScript'];
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx'];
  readonly parse = vi.fn((filePath: string): ParsedSourceFile =>
    filePath === 'src/entry.ts'
      ? makeEntryAst(filePath)
      : {
          symbols: [
            {
              key: 'module',
              name: filePath.slice(filePath.lastIndexOf('/') + 1),
              kind: 'module',
              location: {
                filePath,
                startLine: 1,
                startColumn: 1,
                endLine: 1,
                endColumn: 1,
              },
              exported: false,
            },
          ],
          imports: [],
          exports: [],
          diagnostics: [],
          truncated: false,
        },
  );

  parseResolutionConfig(): ParsedResolutionConfigResult {
    return {
      resolution: {
        baseUrl: 'src',
        paths: [{ pattern: '@/*', targets: ['*'] }],
      },
      diagnostics: [],
    };
  }
}

function makeFileSystem(sourceFiles: Readonly<Record<string, string>>): StaticAnalysisFileSystem {
  return {
    readTextFile: vi.fn(async (relativePath: string) => sourceFiles[relativePath] ?? null),
  };
}

const fixedNow = (): Date => new Date(timestamp);

describe('framework-independent static analysis pipeline', () => {
  it('reuses only the validated scan inventory and resolves local, tsconfig alias, package, and unresolved imports deterministically', async () => {
    const files = [
      configFile('tsconfig.json'),
      sourceFile('src/entry.ts'),
      sourceFile('src/util.ts'),
      sourceFile('src/helper.ts'),
      sourceFile('scripts/legacy.py', 'JavaScript'),
    ];
    const scan = makeScan(files);
    const parser = new FixtureParser();
    const fileSystem = makeFileSystem({
      'tsconfig.json': '{"compilerOptions":{"baseUrl":"src"}}',
      'src/entry.ts': 'export function answer() {}',
      'src/util.ts': 'export const util = 1;',
      'src/helper.ts': 'export const helper = 1;',
    });
    const options = {
      analysisId,
      scan,
      fileSystem,
      parsers: [parser],
      now: fixedNow,
    };

    const result = await analyzeScan(options);
    const repeated = await analyzeScan(options);

    expect(analysisResultSchema.parse(result)).toEqual(result);
    expect(result.status).toBe('partial');
    expect(result.filesSelected).toBe(3);
    expect(result.filesAnalyzed).toBe(3);
    expect(result.symbols.find((symbol) => symbol.name === 'answer')).toMatchObject({
      exported: true,
      parentId: 'src/entry.ts#module',
      location: location('src/entry.ts', 7),
    });
    expect(result.imports).toHaveLength(4);
    expect(
      result.dependencies.map((dependency) => [dependency.specifier, dependency.kind]),
    ).toEqual([
      ['./util', 'local'],
      ['@/helper', 'alias'],
      ['react/jsx-runtime', 'external-package'],
      ['./missing', 'unresolved'],
    ]);
    expect(result.dependencies[0]).toMatchObject({ resolvedPath: 'src/util.ts' });
    expect(result.dependencies[1]).toMatchObject({ resolvedPath: 'src/helper.ts' });
    expect(result.dependencies[2]).toMatchObject({ packageName: 'react' });
    expect(result.dependencies[3]?.reason).toContain('No matching local source file');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'UNRESOLVED_DEPENDENCY',
        filePath: 'src/entry.ts',
        line: 5,
      }),
    );
    expect(result.symbols.map((symbol) => symbol.id)).toEqual(
      repeated.symbols.map((symbol) => symbol.id),
    );
    expect(fileSystem.readTextFile).toHaveBeenCalledTimes(8);
    expect(parser.parse).not.toHaveBeenCalledWith('scripts/legacy.py', expect.anything());
    expect(JSON.stringify(result)).not.toContain('export function answer()');
  });

  it('inherits path aliases from a scanned local tsconfig base and resolves them against the declaring config', async () => {
    const files = [
      configFile('tsconfig.base.json'),
      configFile('tsconfig.json'),
      sourceFile('src/entry.ts', 'TypeScript', 128),
      sourceFile('src/util.ts'),
      sourceFile('src/helper.ts'),
    ];
    const parser = new FixtureParser();
    vi.spyOn(parser, 'parseResolutionConfig').mockImplementation((filePath) => ({
      resolution:
        filePath === 'tsconfig.base.json'
          ? {
              baseUrl: 'src',
              paths: [{ pattern: '@/*', targets: ['*'] }],
            }
          : { extends: './tsconfig.base.json' },
      diagnostics: [],
    }));

    const result = await analyzeScan({
      analysisId,
      scan: makeScan(files),
      fileSystem: makeFileSystem({
        'tsconfig.base.json': '{"compilerOptions":{"baseUrl":"src","paths":{"@/*":["*"]}}}',
        'tsconfig.json': '{"extends":"./tsconfig.base.json"}',
        'src/entry.ts': 'import { helper } from "@/helper";',
        'src/util.ts': 'export const util = 1;',
        'src/helper.ts': 'export const helper = 1;',
      }),
      parsers: [parser],
      now: fixedNow,
    });

    expect(result.dependencies).toContainEqual(
      expect.objectContaining({
        specifier: '@/helper',
        kind: 'alias',
        resolvedPath: 'src/helper.ts',
      }),
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'TSCONFIG_EXTENDS_UNSUPPORTED' }),
    );
  });

  it('uses one nearest specialized tsconfig when no tsconfig.json exists in that directory', async () => {
    const files = [
      configFile('tsconfig.json'),
      configFile('apps/web/tsconfig.app.json'),
      sourceFile('apps/web/src/entry.ts', 'TypeScript', 128),
      sourceFile('src/helper.ts'),
    ];
    const parser = new FixtureParser();
    const parseDefault = parser.parse.getMockImplementation();
    if (parseDefault === undefined) {
      throw new Error('The fixture parser has no default source parser.');
    }
    parser.parse.mockImplementation((filePath) =>
      filePath === 'apps/web/src/entry.ts' ? makeEntryAst(filePath) : parseDefault(filePath),
    );
    vi.spyOn(parser, 'parseResolutionConfig').mockImplementation((filePath) => ({
      resolution:
        filePath === 'tsconfig.json'
          ? {
              baseUrl: 'src',
              paths: [{ pattern: '@/*', targets: ['*'] }],
            }
          : { extends: '../../tsconfig.json' },
      diagnostics: [],
    }));

    const result = await analyzeScan({
      analysisId,
      scan: makeScan(files),
      fileSystem: makeFileSystem({
        'tsconfig.json': '{"compilerOptions":{"baseUrl":"src","paths":{"@/*":["*"]}}}',
        'apps/web/tsconfig.app.json': '{"extends":"../../tsconfig.json"}',
        'apps/web/src/entry.ts': 'import { helper } from "@/helper";',
        'src/helper.ts': 'export const helper = 1;',
      }),
      parsers: [parser],
      now: fixedNow,
    });

    expect(result.dependencies).toContainEqual(
      expect.objectContaining({
        specifier: '@/helper',
        kind: 'alias',
        resolvedPath: 'src/helper.ts',
      }),
    );
  });

  it('fails closed on package-based tsconfig inheritance outside the scanned project', async () => {
    const parser = new FixtureParser();
    vi.spyOn(parser, 'parseResolutionConfig').mockReturnValue({
      resolution: { extends: '@acme/repolens-config/base' },
      diagnostics: [],
    });
    const fileSystem = makeFileSystem({
      'tsconfig.json': '{"extends":"@acme/repolens-config/base"}',
      'src/entry.ts': 'import { helper } from "@/helper";',
    });
    const result = await analyzeScan({
      analysisId,
      scan: makeScan([configFile('tsconfig.json'), sourceFile('src/entry.ts', 'TypeScript', 128)]),
      fileSystem,
      parsers: [parser],
      now: fixedNow,
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'TSCONFIG_EXTENDS_UNSUPPORTED',
        filePath: 'tsconfig.json',
      }),
    );
    expect(result.dependencies).toContainEqual(
      expect.objectContaining({ specifier: '@/helper', kind: 'unresolved' }),
    );
    expect(fileSystem.readTextFile).toHaveBeenCalledTimes(2);
  });

  it('resolves explicit extensionless JSON imports only against inventoried JSON files', async () => {
    const result = await analyzeScan({
      analysisId,
      scan: makeScan([sourceFile('src/entry.ts'), configFile('src/util.json')]),
      fileSystem: makeFileSystem({
        'src/entry.ts': 'import data from "./util";',
        'src/util.json': '{"answer":42}',
      }),
      parsers: [new FixtureParser()],
      now: fixedNow,
    });

    expect(
      result.dependencies.find((dependency) => dependency.specifier === './util'),
    ).toMatchObject({
      kind: 'local',
      resolvedPath: 'src/util.json',
    });
  });

  it('keeps partial results when a discovered file cannot be read', async () => {
    const scan = makeScan([sourceFile('src/entry.ts'), sourceFile('src/unavailable.ts')]);
    const parser = new FixtureParser();
    const fileSystem: StaticAnalysisFileSystem = {
      readTextFile: vi.fn(async (relativePath: string) => {
        if (relativePath === 'src/unavailable.ts') {
          throw new Error('Synthetic read failure');
        }
        return 'source';
      }),
    };

    const result = await analyzeScan({
      analysisId,
      scan,
      fileSystem,
      parsers: [parser],
      maxConcurrency: 1,
      now: fixedNow,
    });

    expect(result.status).toBe('partial');
    expect(result.filesAnalyzed).toBe(1);
    expect(result.filesSkipped).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FILE_READ_FAILED', filePath: 'src/unavailable.ts' }),
    );
    expect(result.symbols.some((symbol) => symbol.name === 'answer')).toBe(true);
  });

  it('bounds oversized parser records before validating the analysis result', async () => {
    const parser = new FixtureParser();
    parser.parse.mockImplementation((filePath) => ({
      symbols: [
        {
          key: 'module',
          name: 'entry.ts',
          kind: 'module',
          location: {
            filePath,
            startLine: 1,
            startColumn: 1,
            endLine: 3,
            endColumn: 1,
          },
          exported: false,
        },
        ...Array.from({ length: 1_001 }, (_, index) => ({
          key: `symbol-${index}`,
          name: 'answer',
          kind: 'function' as const,
          location: location(filePath, index + 2),
          parentKey: 'module',
          exported: false,
        })),
      ],
      imports: [
        {
          key: 'import-0',
          specifier: 'p'.repeat(600),
          kind: 'static',
          bindings: [
            {
              importedName: 'i'.repeat(600),
              localName: 'l'.repeat(600),
              kind: 'named',
              isTypeOnly: false,
            },
          ],
          isTypeOnly: false,
          location: location(filePath, 1),
        },
      ],
      exports: [
        {
          key: 'export-0',
          name: 'answer',
          kind: 'named',
          localName: 'answer',
          source: '',
          isTypeOnly: false,
          location: location(filePath, 2),
        },
      ],
      diagnostics: [],
      truncated: false,
    }));

    const result = await analyzeScan({
      analysisId,
      scan: makeScan([sourceFile('src/entry.ts')]),
      fileSystem: makeFileSystem({ 'src/entry.ts': 'source' }),
      parsers: [parser],
      now: fixedNow,
    });

    expect(analysisResultSchema.parse(result)).toEqual(result);
    expect(result.status).toBe('partial');
    expect(result.exports[0]?.symbolIds).toHaveLength(1_000);
    expect(result.exports[0]).not.toHaveProperty('source');
    expect(result.imports[0]?.bindings[0]?.importedName).toHaveLength(512);
    expect(result.dependencies[0]).toMatchObject({ kind: 'unresolved' });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'RESULT_LIMIT_REACHED' }),
    );
  });

  it('caps aggregate import bindings and export-to-symbol links', async () => {
    const parser = new FixtureParser();
    parser.parse.mockImplementation((filePath) => ({
      symbols: [
        {
          key: 'module',
          name: 'entry.ts',
          kind: 'module',
          location: {
            filePath,
            startLine: 1,
            startColumn: 1,
            endLine: 2,
            endColumn: 1,
          },
          exported: false,
        },
        ...Array.from({ length: 1_001 }, (_, index) => ({
          key: `symbol-${index}`,
          name: 'answer',
          kind: 'function' as const,
          location: location(filePath, index + 2),
          parentKey: 'module',
          exported: false,
        })),
      ],
      imports: Array.from({ length: 51 }, (_, index) => ({
        key: `import-${index}`,
        specifier: 'pkg',
        kind: 'static' as const,
        bindings: Array.from({ length: 1_000 }, () => ({
          importedName: 'value',
          localName: 'value',
          kind: 'named' as const,
          isTypeOnly: false,
        })),
        isTypeOnly: false,
        location: location(filePath, index + 1),
      })),
      exports: Array.from({ length: 51 }, (_, index) => ({
        key: `export-${index}`,
        name: 'answer',
        kind: 'named' as const,
        localName: 'answer',
        isTypeOnly: false,
        location: location(filePath, index + 100),
      })),
      diagnostics: [],
      truncated: false,
    }));

    const result = await analyzeScan({
      analysisId,
      scan: makeScan([sourceFile('src/entry.ts')]),
      fileSystem: makeFileSystem({ 'src/entry.ts': 'source' }),
      parsers: [parser],
      now: fixedNow,
    });

    expect(result.imports.reduce((total, item) => total + item.bindings.length, 0)).toBe(
      STATIC_ANALYSIS_LIMITS.maxImportBindings,
    );
    expect(result.exports.reduce((total, item) => total + item.symbolIds.length, 0)).toBe(
      STATIC_ANALYSIS_LIMITS.maxExportSymbolLinks,
    );
    expect(result.imports.at(-1)?.bindings).toHaveLength(0);
    expect(result.exports.at(-1)?.symbolIds).toHaveLength(0);
    expect(result.status).toBe('partial');
  });

  it('caps source reads by the scan inventory and enforces the aggregate source-byte limit', async () => {
    const files = Array.from({ length: 33 }, (_, index) =>
      sourceFile(`src/file-${String(index).padStart(2, '0')}.ts`, 'TypeScript', 1_048_576),
    );
    const parser = new FixtureParser();
    const readLimits: number[] = [];
    const fileSystem: StaticAnalysisFileSystem = {
      readTextFile: vi.fn(async (_relativePath: string, maxBytes: number) => {
        readLimits.push(maxBytes);
        return 'source';
      }),
    };

    const result = await analyzeScan({
      analysisId,
      scan: makeScan(files),
      fileSystem,
      parsers: [parser],
      now: fixedNow,
    });

    expect(readLimits).toHaveLength(32);
    expect(readLimits.every((limit) => limit === STATIC_ANALYSIS_LIMITS.maxFileBytes)).toBe(true);
    expect(result.filesSelected).toBe(33);
    expect(result.filesAnalyzed).toBe(32);
    expect(result.filesSkipped).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'RESULT_LIMIT_REACHED' }),
    );
  });

  it('rejects source text larger than its scanned size and bounds tsconfig file count', async () => {
    const files = [
      sourceFile('src/changed.ts', 'TypeScript', 4),
      ...Array.from({ length: 101 }, (_, index) =>
        configFile(`packages/pkg-${index}/tsconfig.json`),
      ),
    ];
    const parser = new FixtureParser();
    const readCalls: Array<{ readonly path: string; readonly maxBytes: number }> = [];
    const fileSystem: StaticAnalysisFileSystem = {
      readTextFile: vi.fn(async (path: string, maxBytes: number) => {
        readCalls.push({ path, maxBytes });
        return path === 'src/changed.ts' ? 'source became larger' : '{}';
      }),
    };

    const result = await analyzeScan({
      analysisId,
      scan: makeScan(files),
      fileSystem,
      parsers: [parser],
      now: fixedNow,
    });

    expect(readCalls.filter(({ path }) => path.endsWith('/tsconfig.json'))).toHaveLength(
      STATIC_ANALYSIS_LIMITS.maxTsconfigFiles,
    );
    expect(readCalls.find(({ path }) => path === 'src/changed.ts')?.maxBytes).toBe(4);
    expect(parser.parse).not.toHaveBeenCalledWith('src/changed.ts', expect.anything());
    expect(result.filesAnalyzed).toBe(0);
    expect(result.filesSkipped).toBe(1);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'FILE_TOO_LARGE', filePath: 'src/changed.ts' }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'RESULT_LIMIT_REACHED' }),
    );
  });

  it('caps aggregate tsconfig reads', async () => {
    const files = Array.from({ length: 9 }, (_, index) =>
      configFile(`packages/pkg-${index}/tsconfig.json`, STATIC_ANALYSIS_LIMITS.maxTsconfigBytes),
    );
    const readFile = vi.fn(async () => '{}');
    const parser = new FixtureParser();

    const result = await analyzeScan({
      analysisId,
      scan: makeScan(files),
      fileSystem: { readTextFile: readFile },
      parsers: [parser],
      now: fixedNow,
    });

    expect(readFile).toHaveBeenCalledTimes(8);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'RESULT_LIMIT_REACHED' }),
    );
  });

  it('caps path-alias resolution work across all scanned TypeScript configurations', async () => {
    const parser = new FixtureParser();
    const paths: ParsedPathMapping[] = Array.from({ length: 200 }, (_, index) => ({
      pattern: `@alias-${index}/*`,
      targets: ['*'],
    }));
    vi.spyOn(parser, 'parseResolutionConfig').mockReturnValue({
      resolution: { baseUrl: 'src', paths },
      diagnostics: [],
    });
    const result = await analyzeScan({
      analysisId,
      scan: makeScan([configFile('tsconfig.json'), configFile('packages/app/tsconfig.json')]),
      fileSystem: makeFileSystem({
        'tsconfig.json': '{}',
        'packages/app/tsconfig.json': '{}',
      }),
      parsers: [parser],
      now: fixedNow,
    });

    expect(result.status).toBe('partial');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'RESULT_LIMIT_REACHED',
        message: expect.stringContaining(`${STATIC_ANALYSIS_LIMITS.maxTsconfigPathMappings}`),
      }),
    );
  });

  it('stops reading more files once the aggregate symbol limit is crossed', async () => {
    const files = Array.from({ length: 4 }, (_, index) => sourceFile(`src/file-${index}.ts`));
    const parser = new FixtureParser();
    parser.parse.mockImplementation((filePath) => ({
      symbols: Array.from({ length: 25_001 }, (_, index) => ({
        key: `symbol-${index}`,
        name: `symbol-${index}`,
        kind: 'function' as const,
        location: location(filePath, index + 1),
        exported: false,
      })),
      imports: [],
      exports: [],
      diagnostics: [],
      truncated: false,
    }));
    const readTextFile = vi.fn(async () => 'source');

    const result = await analyzeScan({
      analysisId,
      scan: makeScan(files),
      fileSystem: { readTextFile },
      parsers: [parser],
      maxConcurrency: 1,
      now: fixedNow,
    });

    expect(parser.parse).toHaveBeenCalledTimes(2);
    expect(readTextFile).toHaveBeenCalledTimes(2);
    expect(result.filesAnalyzed).toBe(2);
    expect(result.filesSkipped).toBe(2);
    expect(result.symbols).toHaveLength(STATIC_ANALYSIS_LIMITS.maxSymbols);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'RESULT_LIMIT_REACHED' }),
    );
  });

  it('bounds read concurrency and cooperatively returns a cancelled result', async () => {
    const files = Array.from({ length: 8 }, (_, index) => sourceFile(`src/file-${index}.ts`));
    const parser = new FixtureParser();
    let concurrentReads = 0;
    let maximumConcurrentReads = 0;
    const fileSystem: StaticAnalysisFileSystem = {
      readTextFile: async () => {
        concurrentReads += 1;
        maximumConcurrentReads = Math.max(maximumConcurrentReads, concurrentReads);
        await new Promise((resolve) => setTimeout(resolve, 2));
        concurrentReads -= 1;
        return 'source';
      },
    };

    const complete = await analyzeScan({
      analysisId,
      scan: makeScan(files),
      fileSystem,
      parsers: [parser],
      maxConcurrency: 50,
      now: fixedNow,
    });
    expect(maximumConcurrentReads).toBeLessThanOrEqual(4);
    expect(maximumConcurrentReads).toBeGreaterThan(1);
    expect(complete.filesAnalyzed).toBe(8);

    const controller = { aborted: false };
    const cancelled = await analyzeScan({
      analysisId,
      scan: makeScan(files),
      fileSystem: {
        readTextFile: async () => {
          controller.aborted = true;
          return 'source';
        },
      },
      parsers: [parser],
      maxConcurrency: 1,
      signal: controller,
      now: fixedNow,
    });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.filesAnalyzed).toBe(0);
    expect(cancelled.filesSkipped).toBe(8);
  });
});
