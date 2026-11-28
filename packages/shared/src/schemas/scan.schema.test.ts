import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXCLUDED_DIRECTORIES,
  DEFAULT_EXCLUDED_PATTERNS,
  scanConfigSchema,
  scanFileSchema,
} from './scan.schema.js';

describe('scanner contracts', () => {
  it('provides safe scan defaults and requires an explicit sensitive-file risk acknowledgement', () => {
    const defaults = scanConfigSchema.parse({});
    expect(defaults.excludedDirectories).toEqual([...DEFAULT_EXCLUDED_DIRECTORIES]);
    expect(defaults.excludePatterns).toEqual([...DEFAULT_EXCLUDED_PATTERNS]);
    expect(defaults.includeSensitiveFiles).toBe(false);
    expect(defaults.maxHashBytes).toBe(52_428_800);
    expect(scanConfigSchema.safeParse({ includeSensitiveFiles: true }).success).toBe(false);
    expect(
      scanConfigSchema.safeParse({
        includeSensitiveFiles: true,
        acknowledgeSensitiveFileRisk: true,
      }).success,
    ).toBe(true);
  });

  it('rejects unsafe or negated user exclusion patterns', () => {
    for (const pattern of ['!keep.ts', '/absolute/path', '../outside', 'C:\\secret']) {
      expect(scanConfigSchema.safeParse({ excludePatterns: [pattern] }).success).toBe(false);
    }
    expect(scanConfigSchema.safeParse({ excludePatterns: ['reports/**', '*.local'] }).success).toBe(
      true,
    );
  });

  it('requires a normalized relative file path and a digest for every completed hash', () => {
    const file = {
      relativePath: 'src/index.ts',
      extension: '.ts',
      sizeBytes: 8,
      modifiedAt: '2026-11-27T00:00:00.000Z',
      classification: 'source',
      language: 'TypeScript',
      hashStatus: 'hashed',
    };
    expect(scanFileSchema.safeParse(file).success).toBe(false);
    expect(scanFileSchema.parse({ ...file, sha256: 'a'.repeat(64) }).relativePath).toBe(
      'src/index.ts',
    );
    expect(
      scanFileSchema.safeParse({ ...file, relativePath: '../outside', sha256: 'a'.repeat(64) })
        .success,
    ).toBe(false);
  });
});
