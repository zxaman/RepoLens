import { z } from 'zod';

const safeAnalysisPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !path.includes('\\') &&
      !path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'),
    'Expected a normalized project-relative path.',
  );

const stableAnalysisIdSchema = z.string().min(1).max(8192);
const sourceNameSchema = z.string().min(1).max(512);
const sourceLocationSchema = z
  .object({
    filePath: safeAnalysisPathSchema,
    startLine: z.number().int().positive(),
    startColumn: z.number().int().positive(),
    endLine: z.number().int().positive(),
    endColumn: z.number().int().positive(),
  })
  .strict()
  .superRefine((location, context) => {
    if (
      location.endLine < location.startLine ||
      (location.endLine === location.startLine && location.endColumn < location.startColumn)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endLine'],
        message: 'The source location end must not precede its start.',
      });
    }
  });

export const analysisStatusSchema = z.enum(['completed', 'partial', 'cancelled', 'failed']);
export const analysisPhaseSchema = z.enum([
  'initializing',
  'reading',
  'parsing',
  'resolving',
  'finalizing',
]);
export const analysisSymbolKindSchema = z.enum([
  'module',
  'class',
  'function',
  'method',
  'constructor',
  'property',
  'accessor',
  'variable',
  'parameter',
  'interface',
  'type',
  'enum',
  'enum-member',
  'namespace',
]);
export const analysisSymbolSemanticRoleSchema = z.enum(['component', 'service']);
export const analysisImportKindSchema = z.enum([
  'static',
  'type-only',
  'dynamic',
  'commonjs',
  'commonjs-resolve',
  're-export',
  'typescript-import-equals',
]);
export const analysisImportBindingKindSchema = z.enum(['default', 'named', 'namespace']);
export const analysisDependencyKindSchema = z.enum([
  'local',
  'alias',
  'external-package',
  'unresolved',
]);
export const analysisExportKindSchema = z.enum([
  'named',
  'default',
  'star',
  'namespace',
  'commonjs',
  'assignment',
]);
export const analysisDiagnosticSeveritySchema = z.enum(['info', 'warning', 'error']);
export const analysisDiagnosticCodeSchema = z.enum([
  'FILE_TOO_LARGE',
  'FILE_READ_FAILED',
  'PARSE_ERROR',
  'TSCONFIG_INVALID',
  'TSCONFIG_EXTENDS_UNSUPPORTED',
  'UNRESOLVED_DEPENDENCY',
  'RESULT_LIMIT_REACHED',
  'SCAN_FAILED',
  'SCAN_INCOMPLETE',
  'PARSER_FAILED',
]);

export const analysisSymbolSchema = z
  .object({
    id: stableAnalysisIdSchema,
    name: sourceNameSchema,
    kind: analysisSymbolKindSchema,
    location: sourceLocationSchema,
    parentId: stableAnalysisIdSchema.optional(),
    semanticRole: analysisSymbolSemanticRoleSchema.optional(),
    exported: z.boolean(),
  })
  .strict()
  .superRefine((symbol, context) => {
    if (symbol.semanticRole !== undefined && symbol.kind !== 'class') {
      context.addIssue({
        code: 'custom',
        path: ['semanticRole'],
        message: 'Framework semantic roles apply only to class symbols.',
      });
    }
  });

export const analysisImportBindingSchema = z
  .object({
    importedName: sourceNameSchema,
    localName: sourceNameSchema,
    kind: analysisImportBindingKindSchema,
    isTypeOnly: z.boolean(),
  })
  .strict();

export const analysisImportSchema = z
  .object({
    id: stableAnalysisIdSchema,
    filePath: safeAnalysisPathSchema,
    specifier: z.string().min(1).max(4096),
    kind: analysisImportKindSchema,
    bindings: z.array(analysisImportBindingSchema).max(1000).readonly(),
    isTypeOnly: z.boolean(),
    location: sourceLocationSchema,
  })
  .strict();

export const analysisDependencySchema = z
  .object({
    id: stableAnalysisIdSchema,
    importId: stableAnalysisIdSchema,
    fromPath: safeAnalysisPathSchema,
    specifier: z.string().min(1).max(4096),
    kind: analysisDependencyKindSchema,
    resolvedPath: safeAnalysisPathSchema.optional(),
    packageName: z.string().min(1).max(512).optional(),
    reason: z.string().min(1).max(512).optional(),
  })
  .strict()
  .superRefine((dependency, context) => {
    if (
      (dependency.kind === 'local' || dependency.kind === 'alias') !==
      (dependency.resolvedPath !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['resolvedPath'],
        message: 'Only resolved local and alias dependencies include a project-relative path.',
      });
    }
    if (dependency.kind === 'external-package' && dependency.packageName === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['packageName'],
        message: 'External module specifiers include their package name.',
      });
    }
  });

export const analysisExportSchema = z
  .object({
    id: stableAnalysisIdSchema,
    filePath: safeAnalysisPathSchema,
    name: sourceNameSchema,
    kind: analysisExportKindSchema,
    localName: sourceNameSchema.optional(),
    source: z.string().min(1).max(4096).optional(),
    symbolIds: z.array(stableAnalysisIdSchema).max(1000).readonly(),
    dependencyId: stableAnalysisIdSchema.optional(),
    isTypeOnly: z.boolean(),
    location: sourceLocationSchema,
  })
  .strict();

export const analysisDiagnosticSchema = z
  .object({
    code: analysisDiagnosticCodeSchema,
    severity: analysisDiagnosticSeveritySchema,
    message: z.string().min(1).max(1024),
    filePath: safeAnalysisPathSchema.optional(),
    line: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
  })
  .strict();

export const analysisProgressSchema = z
  .object({
    analysisId: z.uuid(),
    scanId: z.uuid(),
    projectId: z.uuid(),
    phase: analysisPhaseSchema,
    filesTotal: z.number().int().nonnegative(),
    filesProcessed: z.number().int().nonnegative(),
    currentPath: safeAnalysisPathSchema.optional(),
    percentage: z.number().min(0).max(100).optional(),
  })
  .strict();

export const analysisResultSchema = z
  .object({
    analysisId: z.uuid(),
    scanId: z.uuid(),
    projectId: z.uuid(),
    status: analysisStatusSchema,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
    durationMs: z.number().int().nonnegative(),
    filesSelected: z.number().int().nonnegative(),
    filesAnalyzed: z.number().int().nonnegative(),
    filesSkipped: z.number().int().nonnegative(),
    analyzedFiles: z.array(safeAnalysisPathSchema).max(10_000).readonly(),
    symbols: z.array(analysisSymbolSchema).max(50_000).readonly(),
    imports: z.array(analysisImportSchema).max(50_000).readonly(),
    exports: z.array(analysisExportSchema).max(50_000).readonly(),
    dependencies: z.array(analysisDependencySchema).max(50_000).readonly(),
    diagnostics: z.array(analysisDiagnosticSchema).max(2_000).readonly(),
  })
  .strict()
  .superRefine((analysis, context) => {
    if (analysis.filesAnalyzed !== analysis.analyzedFiles.length) {
      context.addIssue({
        code: 'custom',
        path: ['analyzedFiles'],
        message: 'Analyzed file paths must match filesAnalyzed.',
      });
    }
    if (analysis.filesAnalyzed > analysis.filesSelected) {
      context.addIssue({
        code: 'custom',
        path: ['filesAnalyzed'],
        message: 'The number of analyzed files cannot exceed filesSelected.',
      });
    }

    const analyzedFiles = new Set(analysis.analyzedFiles);
    if (analyzedFiles.size !== analysis.analyzedFiles.length) {
      context.addIssue({
        code: 'custom',
        path: ['analyzedFiles'],
        message: 'Analyzed file paths must be unique.',
      });
    }

    const requireAnalyzedFile = (filePath: string, path: (string | number)[]): void => {
      if (!analyzedFiles.has(filePath)) {
        context.addIssue({
          code: 'custom',
          path,
          message: 'Analysis records must refer to a file that was successfully analyzed.',
        });
      }
    };
    analysis.symbols.forEach((symbol, index) =>
      requireAnalyzedFile(symbol.location.filePath, ['symbols', index, 'location', 'filePath']),
    );
    analysis.imports.forEach((item, index) =>
      requireAnalyzedFile(item.filePath, ['imports', index, 'filePath']),
    );
    analysis.exports.forEach((item, index) =>
      requireAnalyzedFile(item.filePath, ['exports', index, 'filePath']),
    );
    analysis.dependencies.forEach((item, index) =>
      requireAnalyzedFile(item.fromPath, ['dependencies', index, 'fromPath']),
    );
  });

export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;
export type AnalysisPhase = z.infer<typeof analysisPhaseSchema>;
export type AnalysisSymbol = z.infer<typeof analysisSymbolSchema>;
export type AnalysisImport = z.infer<typeof analysisImportSchema>;
export type AnalysisImportBinding = z.infer<typeof analysisImportBindingSchema>;
export type AnalysisDependency = z.infer<typeof analysisDependencySchema>;
export type AnalysisExport = z.infer<typeof analysisExportSchema>;
export type AnalysisDiagnostic = z.infer<typeof analysisDiagnosticSchema>;
export type AnalysisProgress = z.infer<typeof analysisProgressSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
