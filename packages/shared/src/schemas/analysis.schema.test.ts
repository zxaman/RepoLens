import { describe, expect, it } from 'vitest';
import {
  analysisDependencySchema,
  analysisResultSchema,
  analysisSymbolSchema,
} from './analysis.schema.js';

const location = {
  filePath: 'src/index.ts',
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 8,
};

const result = {
  analysisId: '7d707ca0-312b-4a6f-8950-8df3441d973a',
  scanId: '92370c1b-8755-4057-ae23-0d885ad4d94b',
  projectId: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
  status: 'completed',
  startedAt: '2026-11-27T00:00:00.000Z',
  completedAt: '2026-11-27T00:00:01.000Z',
  durationMs: 1_000,
  filesSelected: 1,
  filesAnalyzed: 1,
  filesSkipped: 0,
  analyzedFiles: ['src/index.ts'],
  symbols: [
    {
      id: 'src/index.ts#module',
      name: 'index.ts',
      kind: 'module',
      location,
      exported: false,
    },
  ],
  imports: [],
  exports: [],
  dependencies: [],
  diagnostics: [],
};

describe('static-analysis schemas', () => {
  it('accepts validated analysis results and rejects unsafe or non-one-based locations', () => {
    expect(analysisResultSchema.parse(result)).toEqual(result);
    expect(
      analysisSymbolSchema.safeParse({
        id: 'bad',
        name: 'unsafe',
        kind: 'function',
        location: { ...location, filePath: '../outside.ts' },
        exported: false,
      }).success,
    ).toBe(false);
    expect(
      analysisSymbolSchema.safeParse({
        id: 'bad',
        name: 'zero',
        kind: 'function',
        location: { ...location, startLine: 0 },
        exported: false,
      }).success,
    ).toBe(false);
  });

  it('accepts only the bounded optional Angular semantic roles for symbols', () => {
    const moduleSymbol = result.symbols[0];
    expect(moduleSymbol).toBeDefined();
    const classSymbol = {
      ...moduleSymbol!,
      id: 'src/index.ts#class:AppComponent',
      name: 'AppComponent',
      kind: 'class' as const,
    };
    expect(
      analysisSymbolSchema.safeParse({ ...classSymbol, semanticRole: 'component' }).success,
    ).toBe(true);
    expect(analysisSymbolSchema.safeParse({ ...classSymbol, semanticRole: 'model' }).success).toBe(
      false,
    );
    expect(
      analysisSymbolSchema.safeParse({ ...moduleSymbol!, semanticRole: 'component' }).success,
    ).toBe(false);
  });

  it('ties analysis counts and every parser record to unique successfully analyzed files', () => {
    expect(analysisResultSchema.safeParse({ ...result, analyzedFiles: [] }).success).toBe(false);
    expect(
      analysisResultSchema.safeParse({ ...result, analyzedFiles: ['src/index.ts', 'src/index.ts'] })
        .success,
    ).toBe(false);
    expect(
      analysisResultSchema.safeParse({
        ...result,
        symbols: [
          {
            ...result.symbols[0],
            location: { ...location, filePath: 'src/other.ts' },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires resolved project paths only for local/alias dependencies', () => {
    expect(
      analysisDependencySchema.parse({
        id: 'src/index.ts#dep',
        importId: 'src/index.ts#import',
        fromPath: 'src/index.ts',
        specifier: './util',
        kind: 'local',
        resolvedPath: 'src/util.ts',
      }),
    ).toMatchObject({ kind: 'local', resolvedPath: 'src/util.ts' });
    expect(
      analysisDependencySchema.safeParse({
        id: 'src/index.ts#dep',
        importId: 'src/index.ts#import',
        fromPath: 'src/index.ts',
        specifier: 'react',
        kind: 'external-package',
      }).success,
    ).toBe(false);
    expect(
      analysisDependencySchema.safeParse({
        id: 'src/index.ts#dep',
        importId: 'src/index.ts#import',
        fromPath: 'src/index.ts',
        specifier: './missing',
        kind: 'unresolved',
        resolvedPath: 'src/missing.ts',
      }).success,
    ).toBe(false);
  });
});
