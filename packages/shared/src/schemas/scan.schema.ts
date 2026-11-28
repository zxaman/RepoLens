import { z } from 'zod';

export const DEFAULT_EXCLUDED_DIRECTORIES = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.angular',
  'vendor',
  'bower_components',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.vercel',
  '.netlify',
  '.turbo',
  '.parcel-cache',
  '.vite',
  '.cache',
  '.tmp',
  'temp',
  'tmp',
  'out',
  'output',
  'release',
  'target',
  '.gradle',
  'Pods',
  'DerivedData',
  'storybook-static',
  'playwright-report',
  'test-results',
] as const;

export const DEFAULT_EXCLUDED_PATTERNS = [
  '**/chunk-*.js',
  '**/chunk-*.mjs',
  '**/*.chunk.js',
  '**/*.chunk.mjs',
  '**/*.bundle.js',
  '**/*.bundle.mjs',
  '**/*.map',
  'android/app/src/main/assets/public',
  'ios/App/App/public',
] as const;

export const scanStatusSchema = z.enum(['completed', 'failed', 'cancelled']);
export const scanPhaseSchema = z.enum([
  'initializing',
  'walking',
  'classifying',
  'detecting',
  'hashing',
  'finalizing',
]);
export const scanClassificationSchema = z.enum([
  'source',
  'configuration',
  'package-manifest',
  'documentation',
  'asset',
  'other',
]);
export const scanHashStatusSchema = z.enum([
  'hashed',
  'skipped-size-limit',
  'failed',
  'not-attempted',
]);
export const scanTechnologyCategorySchema = z.enum(['frontend', 'backend', 'database', 'tooling']);
export const scanTechnologyCertaintySchema = z.enum(['confirmed', 'inferred']);
export const scanTechnologyConfidenceSchema = z.enum(['high', 'medium']);

const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'),
    'Expected a normalized relative path.',
  );

const exclusionDirectorySchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\'),
    'An excluded directory must be a single path segment.',
  );

const exclusionPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (value) =>
      !value.startsWith('!') &&
      !value.startsWith('/') &&
      !/^[a-z]:[\\/]/i.test(value) &&
      !value.split(/[\\/]/).some((segment) => segment === '..'),
    'User exclusions must be relative, positive ignore patterns.',
  );

export const scanConfigSchema = z
  .object({
    excludedDirectories: z
      .array(exclusionDirectorySchema)
      .max(100)
      .default([...DEFAULT_EXCLUDED_DIRECTORIES]),
    excludePatterns: z
      .array(exclusionPatternSchema)
      .max(100)
      .default([...DEFAULT_EXCLUDED_PATTERNS]),
    includeSensitiveFiles: z.boolean().default(false),
    acknowledgeSensitiveFileRisk: z.boolean().default(false),
    maxHashBytes: z.number().int().min(0).max(1_073_741_824).default(52_428_800),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.includeSensitiveFiles && !config.acknowledgeSensitiveFileRisk) {
      context.addIssue({
        code: 'custom',
        path: ['acknowledgeSensitiveFileRisk'],
        message: 'Sensitive-file inclusion requires explicit acknowledgement.',
      });
    }
  });

export const DEFAULT_SCAN_CONFIG = scanConfigSchema.parse({});

export const scanLanguageStatSchema = z
  .object({
    name: z.string().min(1).max(100),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  })
  .strict();

export const scanTechnologySchema = z
  .object({
    name: z.string().min(1).max(100),
    category: scanTechnologyCategorySchema,
    certainty: scanTechnologyCertaintySchema,
    confidence: scanTechnologyConfidenceSchema,
    evidence: z.array(z.string().min(1).max(1024)).min(1).max(100).readonly(),
  })
  .strict();

export const scanFileSchema = z
  .object({
    relativePath: safeRelativePathSchema,
    extension: z.string().max(32),
    sizeBytes: z.number().int().nonnegative(),
    modifiedAt: z.iso.datetime(),
    classification: scanClassificationSchema,
    language: z.string().min(1).max(100).nullable(),
    hashStatus: scanHashStatusSchema,
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .superRefine((file, context) => {
    if (file.hashStatus === 'hashed' && file.sha256 === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['sha256'],
        message: 'Hashed files must include a SHA-256 digest.',
      });
    }
    if (file.hashStatus !== 'hashed' && file.sha256 !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['sha256'],
        message: 'Files without a completed hash must not include a digest.',
      });
    }
  });

export const scanWarningCodeSchema = z.enum([
  'DIRECTORY_UNAVAILABLE',
  'FILE_UNAVAILABLE',
  'IGNORE_FILE_UNAVAILABLE',
  'IGNORE_FILE_TOO_LARGE',
  'MALFORMED_IGNORE_PATTERN',
  'MALFORMED_PACKAGE_MANIFEST',
  'PACKAGE_MANIFEST_TOO_LARGE',
  'HASH_FAILED',
  'FILE_CHANGED_DURING_SCAN',
  'SYMLINK_OUTSIDE_ROOT',
  'SYMLINK_CYCLE',
  'DUPLICATE_FILE_SKIPPED',
  'SENSITIVE_FILE_EXCLUDED',
  'WARNINGS_TRUNCATED',
  'HISTORY_SAVE_FAILED',
  'UNSAFE_PATH_SKIPPED',
]);

export const scanWarningSchema = z
  .object({
    code: scanWarningCodeSchema,
    message: z.string().min(1).max(1024),
    relativePath: safeRelativePathSchema.optional(),
  })
  .strict();

export const scanErrorCodeSchema = z.enum([
  'ROOT_UNAVAILABLE',
  'ROOT_NOT_DIRECTORY',
  'PERMISSION_DENIED',
  'WORKER_FAILED',
  'INTERNAL_ERROR',
]);

export const scanErrorSchema = z
  .object({
    code: scanErrorCodeSchema,
    message: z.string().min(1).max(1024),
    relativePath: safeRelativePathSchema.optional(),
  })
  .strict();

const scanHistoryFields = {
  id: z.uuid(),
  projectId: z.uuid(),
  status: scanStatusSchema,
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  directoriesDiscovered: z.number().int().nonnegative(),
  filesDiscovered: z.number().int().nonnegative(),
  filesProcessed: z.number().int().nonnegative(),
  sourceFiles: z.number().int().nonnegative(),
  configurationFiles: z.number().int().nonnegative(),
  packageManifests: z.number().int().nonnegative(),
  documentationFiles: z.number().int().nonnegative(),
  assetFiles: z.number().int().nonnegative(),
  otherFiles: z.number().int().nonnegative(),
  ignoredFiles: z.number().int().nonnegative(),
  ignoredDirectories: z.number().int().nonnegative(),
  sensitiveEntriesExcluded: z.number().int().nonnegative(),
  symlinksSkipped: z.number().int().nonnegative(),
  bytesHashed: z.number().int().nonnegative(),
  languages: z.array(scanLanguageStatSchema).readonly(),
  technologies: z.array(scanTechnologySchema).readonly(),
  warnings: z.array(scanWarningSchema).readonly(),
  errorSummary: z.string().min(1).max(1024).optional(),
};

export const scanHistoryItemSchema = z.object(scanHistoryFields).strict();

export const scanResultSchema = z
  .object({
    ...scanHistoryFields,
    files: z.array(scanFileSchema).readonly(),
    errors: z.array(scanErrorSchema).readonly(),
  })
  .strict();

export const scanProgressSchema = z
  .object({
    scanId: z.uuid(),
    projectId: z.uuid(),
    phase: scanPhaseSchema,
    filesDiscovered: z.number().int().nonnegative(),
    filesProcessed: z.number().int().nonnegative(),
    directoriesProcessed: z.number().int().nonnegative(),
    totalBytesProcessed: z.number().int().nonnegative(),
    filesTotal: z.number().int().nonnegative().optional(),
    currentPath: safeRelativePathSchema.optional(),
    percentage: z.number().min(0).max(100).optional(),
  })
  .strict();

export type ScanStatus = z.infer<typeof scanStatusSchema>;
export type ScanPhase = z.infer<typeof scanPhaseSchema>;
export type ScanConfig = z.infer<typeof scanConfigSchema>;
export type ScanClassification = z.infer<typeof scanClassificationSchema>;
export type ScanHashStatus = z.infer<typeof scanHashStatusSchema>;
export type ScanLanguageStat = z.infer<typeof scanLanguageStatSchema>;
export type ScanTechnology = z.infer<typeof scanTechnologySchema>;
export type ScanFile = z.infer<typeof scanFileSchema>;
export type ScanWarning = z.infer<typeof scanWarningSchema>;
export type ScanError = z.infer<typeof scanErrorSchema>;
export type ScanHistoryItem = z.infer<typeof scanHistoryItemSchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
export type ScanProgress = z.infer<typeof scanProgressSchema>;

/** Backwards-compatible name for a scan's persisted, file-list-free summary. */
export const scanSummarySchema = scanHistoryItemSchema;
export type ScanSummary = ScanHistoryItem;
