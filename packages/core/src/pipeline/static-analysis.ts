import {
  analysisProgressSchema,
  analysisResultSchema,
  type AnalysisDiagnostic,
  type AnalysisDependency,
  type AnalysisExport,
  type AnalysisImport,
  type AnalysisProgress,
  type AnalysisResult,
  type AnalysisSymbol,
  scanResultSchema,
  type ScanFile,
  type ScanResult,
} from '@repolens/shared';
import type {
  ParsedDiagnostic,
  ParsedExport,
  ParsedImport,
  ParsedPathMapping,
  ParsedResolutionConfig,
  ParsedSourceFile,
  StaticAnalysisFileSystem,
  StaticAnalysisParser,
} from './static-analysis.types.js';

export const STATIC_ANALYSIS_LIMITS = Object.freeze({
  concurrency: 4,
  maxFiles: 10_000,
  maxFileBytes: 1_048_576,
  maxTotalSourceBytes: 32 * 1_048_576,
  maxSymbols: 50_000,
  maxRelationships: 50_000,
  maxImportBindings: 50_000,
  maxExportSymbolLinks: 50_000,
  maxDiagnostics: 2_000,
  maxTsconfigFiles: 100,
  maxTsconfigBytes: 512 * 1_024,
  maxTotalTsconfigBytes: 4 * 1_048_576,
  maxTsconfigBaseUrlLength: 1_024,
  maxTsconfigExtendsPathLength: 1_024,
  maxTsconfigExtendsDepth: 16,
  maxTsconfigPathMappings: 256,
});

const MAX_TSCONFIG_BYTES = STATIC_ANALYSIS_LIMITS.maxTsconfigBytes;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const RESOLUTION_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.d.ts',
  '.json',
] as const;

export interface AnalyzeScanOptions {
  readonly analysisId: string;
  readonly scan: ScanResult;
  readonly fileSystem: StaticAnalysisFileSystem;
  readonly parsers: readonly StaticAnalysisParser[];
  readonly signal?: { readonly aborted: boolean };
  readonly onProgress?: (progress: AnalysisProgress) => void;
  readonly maxConcurrency?: number;
  readonly now?: () => Date;
}

interface SelectedFile {
  readonly file: ScanFile;
  readonly parser: StaticAnalysisParser;
}

interface SourceSelection {
  readonly files: SelectedFile[];
  readonly totalEligible: number;
}

interface ParsedFileResult {
  readonly filePath: string;
  readonly parsed: ParsedSourceFile;
}

interface EffectivePathMapping extends ParsedPathMapping {
  readonly baseDirectory: string;
}

interface EffectiveResolution {
  readonly baseUrl?: string;
  readonly paths: readonly EffectivePathMapping[];
}

interface ConfigRecord {
  readonly path: string;
  readonly resolution: ParsedResolutionConfig | null;
  readonly effectiveResolution?: EffectiveResolution;
}

interface ResolvedDependency {
  readonly kind: AnalysisDependency['kind'];
  readonly resolvedPath?: string;
  readonly packageName?: string;
  readonly reason?: string;
}

interface CandidateResolution {
  readonly path: string | null;
  readonly ambiguous: boolean;
}

/**
 * Parses only eligible source files already discovered by the Phase 3 ScanResult. The injected
 * parser and path-only filesystem contract keep this pipeline independent of Electron and Angular.
 */
export async function analyzeScan(options: AnalyzeScanOptions): Promise<AnalysisResult> {
  const scan = scanResultSchema.parse(options.scan);
  const started = (options.now ?? (() => new Date()))();
  const now = options.now ?? (() => new Date());
  const signal = options.signal ?? NEVER_CANCELLED;
  const diagnostics: AnalysisDiagnostic[] = [];
  const selection = selectSourceFiles(scan.files, options.parsers);
  const selectedFiles = selection.files;
  const selectedFileCount = selection.totalEligible;
  let filesProcessed = 0;
  let filesAnalyzed = 0;
  let filesSkipped = 0;
  let sourceReadBytes = 0;
  let resultLimited = false;
  let diagnosticOverflow = false;

  const addDiagnostic = (diagnostic: AnalysisDiagnostic): void => {
    if (diagnostics.length < STATIC_ANALYSIS_LIMITS.maxDiagnostics - 1) {
      diagnostics.push(diagnostic);
      return;
    }
    if (!diagnosticOverflow) {
      diagnosticOverflow = true;
      diagnostics.push({
        code: 'RESULT_LIMIT_REACHED',
        severity: 'warning',
        message: 'Additional static-analysis diagnostics were omitted to keep the result bounded.',
      });
    }
  };

  const emitProgress = (
    phase: AnalysisProgress['phase'],
    details: { readonly currentPath?: string; readonly percentage?: number } = {},
  ): void => {
    if (options.onProgress === undefined) {
      return;
    }
    const progress = analysisProgressSchema.safeParse({
      analysisId: options.analysisId,
      scanId: scan.id,
      projectId: scan.projectId,
      phase,
      filesTotal: selectedFileCount,
      filesProcessed,
      ...(details.currentPath === undefined ? {} : { currentPath: details.currentPath }),
      ...(details.percentage === undefined ? {} : { percentage: details.percentage }),
    });
    if (progress.success) {
      try {
        options.onProgress(progress.data);
      } catch {
        // Progress observers cannot interrupt local analysis.
      }
    }
  };

  emitProgress('initializing');

  if (scan.status === 'failed') {
    addDiagnostic({
      code: 'SCAN_FAILED',
      severity: 'error',
      message: 'Static analysis requires a scan that returned a file inventory.',
    });
    filesSkipped = selectedFileCount;
    filesProcessed = selectedFileCount;
    emitProgress('finalizing', { percentage: 100 });
    return makeEmptyResult('failed');
  }

  if (scan.status === 'cancelled') {
    addDiagnostic({
      code: 'SCAN_INCOMPLETE',
      severity: 'warning',
      message:
        'The source inventory came from a cancelled scan and may not include every project file.',
    });
  }

  const configs = await loadResolutionConfigs(
    scan.files,
    options.fileSystem,
    options.parsers,
    signal,
    addDiagnostic,
    emitProgress,
  );
  const configByPath = new Map(configs.map((config) => [config.path, config]));
  const configByDirectory = new Map<string, ConfigRecord[]>();
  for (const config of configs) {
    const directory = dirname(config.path);
    const siblings = configByDirectory.get(directory) ?? [];
    siblings.push(config);
    configByDirectory.set(directory, siblings);
  }

  const boundedFiles = selectedFiles;
  if (selectedFileCount > boundedFiles.length) {
    const skippedByFileLimit = selectedFileCount - boundedFiles.length;
    filesSkipped += skippedByFileLimit;
    filesProcessed += skippedByFileLimit;
    resultLimited = true;
    addDiagnostic({
      code: 'RESULT_LIMIT_REACHED',
      severity: 'warning',
      message: `Only the first ${STATIC_ANALYSIS_LIMITS.maxFiles} eligible source files were selected.`,
    });
  }

  const workItems: SelectedFile[] = [];
  for (const selected of boundedFiles) {
    if (selected.file.sizeBytes > STATIC_ANALYSIS_LIMITS.maxFileBytes) {
      filesSkipped += 1;
      filesProcessed += 1;
      addDiagnostic({
        code: 'FILE_TOO_LARGE',
        severity: 'warning',
        message: `The source file exceeds the ${STATIC_ANALYSIS_LIMITS.maxFileBytes}-byte analysis limit.`,
        filePath: selected.file.relativePath,
      });
      continue;
    }
    if (sourceReadBytes + selected.file.sizeBytes > STATIC_ANALYSIS_LIMITS.maxTotalSourceBytes) {
      filesSkipped += 1;
      filesProcessed += 1;
      resultLimited = true;
      addDiagnostic({
        code: 'RESULT_LIMIT_REACHED',
        severity: 'warning',
        message: 'The total source-byte analysis limit was reached; remaining files were skipped.',
        filePath: selected.file.relativePath,
      });
      continue;
    }
    sourceReadBytes += selected.file.sizeBytes;
    workItems.push(selected);
  }

  const parsedFiles: Array<ParsedFileResult | null> = new Array(workItems.length).fill(null);
  let nextWorkItem = 0;
  let completedWorkItems = 0;
  let parsedSymbolCount = 0;
  let parsedRelationshipCount = 0;
  let parserResultLimitReached = false;
  const maxConcurrency = Math.max(
    1,
    Math.min(
      STATIC_ANALYSIS_LIMITS.concurrency,
      Math.floor(options.maxConcurrency ?? STATIC_ANALYSIS_LIMITS.concurrency),
    ),
  );

  const parseWorker = async (): Promise<void> => {
    while (!signal.aborted) {
      if (parserResultLimitReached) {
        return;
      }
      const workIndex = nextWorkItem;
      nextWorkItem += 1;
      const selected = workItems[workIndex];
      if (selected === undefined) {
        return;
      }
      const filePath = selected.file.relativePath;

      emitProgress('reading', {
        currentPath: filePath,
        percentage: percentage(filesProcessed, selectedFileCount),
      });
      try {
        const sourceText = await options.fileSystem.readTextFile(filePath, selected.file.sizeBytes);
        if (signal.aborted) {
          return;
        }
        if (sourceText === null) {
          filesSkipped += 1;
          addDiagnostic({
            code: 'FILE_READ_FAILED',
            severity: 'error',
            message: 'RepoLens could not read this discovered source file.',
            filePath,
          });
        } else if (utf8ByteLength(sourceText, selected.file.sizeBytes) > selected.file.sizeBytes) {
          filesSkipped += 1;
          addDiagnostic({
            code: 'FILE_TOO_LARGE',
            severity: 'warning',
            message:
              'The source file changed after the scan and exceeded its recorded size; it was not analyzed.',
            filePath,
          });
        } else {
          emitProgress('parsing', { currentPath: filePath });
          try {
            const parsed = selected.parser.parse(filePath, sourceText);
            parsedFiles[workIndex] = { filePath, parsed };
            filesAnalyzed += 1;
            parsedSymbolCount += parsed.symbols.length;
            parsedRelationshipCount += parsed.imports.length + parsed.exports.length;
            if (
              parsedSymbolCount > STATIC_ANALYSIS_LIMITS.maxSymbols ||
              parsedRelationshipCount > STATIC_ANALYSIS_LIMITS.maxRelationships
            ) {
              parserResultLimitReached = true;
              resultLimited = true;
            }
            for (const parserDiagnostic of parsed.diagnostics) {
              addDiagnostic(toAnalysisDiagnostic(filePath, parserDiagnostic));
            }
            if (parsed.truncated) {
              resultLimited = true;
              addDiagnostic({
                code: 'RESULT_LIMIT_REACHED',
                severity: 'warning',
                message: 'Some syntax records in this file were omitted to keep analysis bounded.',
                filePath,
              });
            }
          } catch {
            filesSkipped += 1;
            addDiagnostic({
              code: 'PARSER_FAILED',
              severity: 'error',
              message: 'The language parser could not analyze this source file.',
              filePath,
            });
          }
        }
      } catch {
        if (!signal.aborted) {
          filesSkipped += 1;
          addDiagnostic({
            code: 'FILE_READ_FAILED',
            severity: 'error',
            message: 'RepoLens could not read this discovered source file.',
            filePath,
          });
        }
      } finally {
        if (!signal.aborted) {
          filesProcessed += 1;
          completedWorkItems += 1;
          if (completedWorkItems % 8 === 0 || completedWorkItems === workItems.length) {
            await options.fileSystem.yieldToEventLoop?.();
          }
          emitProgress('parsing', {
            currentPath: filePath,
            percentage: percentage(filesProcessed, selectedFileCount),
          });
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, Math.max(1, workItems.length)) }, () =>
      parseWorker(),
    ),
  );

  if (signal.aborted) {
    const unfinished = workItems.length - completedWorkItems;
    filesSkipped += unfinished;
    filesProcessed += unfinished;
  } else if (parserResultLimitReached) {
    const unstarted = workItems.length - nextWorkItem;
    filesSkipped += unstarted;
    filesProcessed += unstarted;
  }

  if (
    parsedSymbolCount > STATIC_ANALYSIS_LIMITS.maxSymbols ||
    parsedRelationshipCount > STATIC_ANALYSIS_LIMITS.maxRelationships
  ) {
    resultLimited = true;
    addDiagnostic({
      code: 'RESULT_LIMIT_REACHED',
      severity: 'warning',
      message: 'The analysis result reached its symbol or relationship limit.',
    });
  }

  emitProgress('resolving');
  const symbols: AnalysisSymbol[] = [];
  const imports: AnalysisImport[] = [];
  const exports: AnalysisExport[] = [];
  const dependencies: AnalysisDependency[] = [];
  const exportedSymbolIds = new Set<string>();
  let importBindingCount = 0;
  let exportSymbolLinkCount = 0;
  const knownPaths = new Set(
    scan.files
      .filter(
        (file) =>
          (file.classification === 'source' &&
            file.language !== null &&
            SOURCE_EXTENSIONS.has(file.extension.toLowerCase())) ||
          (file.extension.toLowerCase() === '.json' && file.language === 'JSON'),
      )
      .map((file) => file.relativePath),
  );
  let outputLimitReported = false;

  const reportOutputLimit = (filePath?: string): void => {
    resultLimited = true;
    if (outputLimitReported) {
      return;
    }
    outputLimitReported = true;
    addDiagnostic({
      code: 'RESULT_LIMIT_REACHED',
      severity: 'warning',
      message:
        'Additional syntax records or links were omitted or shortened because the analysis result reached a safe size limit.',
      ...(filePath === undefined ? {} : { filePath }),
    });
  };

  for (const fileResult of parsedFiles) {
    if (fileResult === null) {
      continue;
    }
    const { filePath, parsed } = fileResult;
    const symbolIdByKey = new Map<string, string>();
    const symbolIdCounts = new Map<string, number>();

    for (const parsedSymbol of parsed.symbols) {
      symbolIdByKey.set(parsedSymbol.key, symbolId(filePath, parsedSymbol, symbolIdCounts));
    }

    const emittedSymbolIdsByName = new Map<string, string[]>();
    for (const parsedSymbol of parsed.symbols) {
      if (symbols.length >= STATIC_ANALYSIS_LIMITS.maxSymbols) {
        reportOutputLimit(filePath);
        break;
      }
      const id = symbolIdByKey.get(parsedSymbol.key);
      if (id === undefined) {
        continue;
      }
      const parentId =
        parsedSymbol.parentKey === undefined
          ? undefined
          : (symbolIdByKey.get(parsedSymbol.parentKey) ?? `${filePath}#module`);
      const boundedName = parsedSymbol.name.slice(0, 512) || '<anonymous>';
      const sameName = emittedSymbolIdsByName.get(boundedName) ?? [];
      sameName.push(id);
      emittedSymbolIdsByName.set(boundedName, sameName);
      symbols.push({
        id,
        name: boundedName,
        kind: parsedSymbol.kind,
        location: parsedSymbol.location,
        ...(parentId === undefined ? {} : { parentId }),
        ...(parsedSymbol.semanticRole === undefined
          ? {}
          : { semanticRole: parsedSymbol.semanticRole }),
        exported: parsedSymbol.exported,
      });
    }

    const importIdByKey = new Map<string, string>();
    const importIdCounts = new Map<string, number>();
    const dependencyIds = new Set<string>();
    const fileConfig = findConfigForFile(filePath, configByPath, configByDirectory);
    const reExportImportBySpecifier = new Map<string, ParsedImport>();
    for (const candidate of parsed.imports) {
      if (
        candidate.kind === 're-export' &&
        candidate.specifier.length <= 4096 &&
        !reExportImportBySpecifier.has(candidate.specifier)
      ) {
        reExportImportBySpecifier.set(candidate.specifier, candidate);
      }
    }
    for (const parsedImport of parsed.imports) {
      if (imports.length >= STATIC_ANALYSIS_LIMITS.maxRelationships) {
        reportOutputLimit(filePath);
        break;
      }
      if (parsedImport.specifier.length === 0) {
        reportOutputLimit(filePath);
        continue;
      }
      const id = relationshipId(filePath, 'import', parsedImport, importIdCounts);
      importIdByKey.set(parsedImport.key, id);
      const specifier = parsedImport.specifier.slice(0, 4096);
      if (specifier.length !== parsedImport.specifier.length) {
        reportOutputLimit(filePath);
      }
      const bindingLimit = Math.min(
        1_000,
        STATIC_ANALYSIS_LIMITS.maxImportBindings - importBindingCount,
      );
      const boundedBindings = parsedImport.bindings.slice(0, bindingLimit).map((binding) => ({
        ...binding,
        importedName: binding.importedName.slice(0, 512) || '<anonymous>',
        localName: binding.localName.slice(0, 512) || '<anonymous>',
      }));
      if (
        boundedBindings.length !== parsedImport.bindings.length ||
        boundedBindings.some(
          (binding, index) =>
            binding.importedName !== parsedImport.bindings[index]?.importedName ||
            binding.localName !== parsedImport.bindings[index]?.localName,
        )
      ) {
        reportOutputLimit(filePath);
      }
      importBindingCount += boundedBindings.length;
      imports.push({
        id,
        filePath,
        specifier,
        kind: parsedImport.kind,
        bindings: boundedBindings,
        isTypeOnly: parsedImport.isTypeOnly,
        location: parsedImport.location,
      });

      if (dependencies.length >= STATIC_ANALYSIS_LIMITS.maxRelationships) {
        reportOutputLimit(filePath);
        continue;
      }
      const resolved =
        specifier.length !== parsedImport.specifier.length
          ? unresolved('The module specifier exceeded the safe analysis length.')
          : resolveDependency(filePath, specifier, fileConfig, knownPaths);
      const dependencyId = `${id}#dependency`;
      dependencyIds.add(dependencyId);
      dependencies.push({
        id: dependencyId,
        importId: id,
        fromPath: filePath,
        specifier,
        kind: resolved.kind,
        ...(resolved.resolvedPath === undefined ? {} : { resolvedPath: resolved.resolvedPath }),
        ...(resolved.packageName === undefined ? {} : { packageName: resolved.packageName }),
        ...(resolved.reason === undefined ? {} : { reason: resolved.reason }),
      });
      if (resolved.kind === 'unresolved') {
        addDiagnostic({
          code: 'UNRESOLVED_DEPENDENCY',
          severity: 'warning',
          message:
            resolved.reason ??
            'RepoLens could not resolve this module specifier from the scanned files.',
          filePath,
          line: parsedImport.location.startLine,
          column: parsedImport.location.startColumn,
        });
      }
    }

    const exportIdCounts = new Map<string, number>();
    for (const parsedExport of parsed.exports) {
      if (exports.length >= STATIC_ANALYSIS_LIMITS.maxRelationships) {
        reportOutputLimit(filePath);
        break;
      }
      const localNameIsSafe =
        parsedExport.localName === undefined ||
        (parsedExport.localName.length > 0 && parsedExport.localName.length <= 512);
      const localName = parsedExport.localName?.slice(0, 512);
      const candidateSymbolIds =
        localName === undefined || !localNameIsSafe
          ? []
          : (emittedSymbolIdsByName.get(localName) ?? []);
      const symbolLinkLimit = Math.min(
        1_000,
        STATIC_ANALYSIS_LIMITS.maxExportSymbolLinks - exportSymbolLinkCount,
      );
      if (candidateSymbolIds.length > symbolLinkLimit || !localNameIsSafe) {
        reportOutputLimit(filePath);
      }
      const symbolIds = candidateSymbolIds.slice(0, symbolLinkLimit);
      exportSymbolLinkCount += symbolIds.length;
      for (const id of symbolIds) {
        exportedSymbolIds.add(id);
      }

      const sourceIsSafe =
        parsedExport.source === undefined ||
        (parsedExport.source.length > 0 && parsedExport.source.length <= 4096);
      if (
        parsedExport.name.length > 512 ||
        !sourceIsSafe ||
        (parsedExport.localName !== undefined && !localNameIsSafe)
      ) {
        reportOutputLimit(filePath);
      }
      const linkedImport =
        parsedExport.source === undefined || !sourceIsSafe
          ? undefined
          : reExportImportBySpecifier.get(parsedExport.source);
      const linkedImportId =
        linkedImport === undefined ? undefined : importIdByKey.get(linkedImport.key);
      const candidateDependencyId =
        linkedImportId === undefined ? undefined : `${linkedImportId}#dependency`;
      const linkedDependencyId =
        candidateDependencyId !== undefined && dependencyIds.has(candidateDependencyId)
          ? candidateDependencyId
          : undefined;
      const id = relationshipId(filePath, 'export', parsedExport, exportIdCounts);
      exports.push({
        id,
        filePath,
        name: parsedExport.name.slice(0, 512) || '<anonymous>',
        kind: parsedExport.kind,
        ...(parsedExport.localName === undefined || parsedExport.localName.length === 0
          ? {}
          : { localName: parsedExport.localName.slice(0, 512) }),
        ...(parsedExport.source === undefined || parsedExport.source.length === 0
          ? {}
          : { source: parsedExport.source.slice(0, 4096) }),
        symbolIds,
        ...(linkedDependencyId === undefined ? {} : { dependencyId: linkedDependencyId }),
        isTypeOnly: parsedExport.isTypeOnly,
        location: parsedExport.location,
      });
    }
  }

  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index];
    if (symbol !== undefined && exportedSymbolIds.has(symbol.id) && !symbol.exported) {
      symbols[index] = { ...symbol, exported: true };
    }
  }

  const completed = now();
  const status: AnalysisResult['status'] = signal.aborted
    ? 'cancelled'
    : diagnostics.some((diagnostic) => diagnostic.severity !== 'info') ||
        scan.status === 'cancelled' ||
        resultLimited
      ? 'partial'
      : 'completed';
  emitProgress('finalizing', signal.aborted ? {} : { percentage: 100 });

  return analysisResultSchema.parse({
    analysisId: options.analysisId,
    scanId: scan.id,
    projectId: scan.projectId,
    status,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationMs: Math.max(0, completed.getTime() - started.getTime()),
    filesSelected: selectedFileCount,
    filesAnalyzed,
    filesSkipped,
    analyzedFiles: parsedFiles.flatMap((fileResult) =>
      fileResult === null ? [] : [fileResult.filePath],
    ),
    symbols,
    imports,
    exports,
    dependencies,
    diagnostics,
  });

  function makeEmptyResult(status: AnalysisResult['status']): AnalysisResult {
    const completed = now();
    return analysisResultSchema.parse({
      analysisId: options.analysisId,
      scanId: scan.id,
      projectId: scan.projectId,
      status,
      startedAt: started.toISOString(),
      completedAt: completed.toISOString(),
      durationMs: Math.max(0, completed.getTime() - started.getTime()),
      filesSelected: selectedFileCount,
      filesAnalyzed: 0,
      filesSkipped,
      analyzedFiles: [],
      symbols: [],
      imports: [],
      exports: [],
      dependencies: [],
      diagnostics,
    });
  }
}

const NEVER_CANCELLED = Object.freeze({ aborted: false });

function selectSourceFiles(
  files: readonly ScanFile[],
  parsers: readonly StaticAnalysisParser[],
): SourceSelection {
  const selected: SelectedFile[] = [];
  let totalEligible = 0;
  for (const file of files) {
    if (file.classification !== 'source' || file.language === null) {
      continue;
    }
    const extension = file.extension.toLowerCase();
    if (!SOURCE_EXTENSIONS.has(extension)) {
      continue;
    }
    const parser = parsers.find(
      (candidate) =>
        candidate.languageNames.includes(file.language ?? '') &&
        candidate.extensions.includes(extension),
    );
    if (parser !== undefined) {
      totalEligible += 1;
      if (selected.length < STATIC_ANALYSIS_LIMITS.maxFiles) {
        selected.push({ file, parser });
      }
    }
  }
  selected.sort((left, right) => left.file.relativePath.localeCompare(right.file.relativePath));
  return { files: selected, totalEligible };
}

async function loadResolutionConfigs(
  files: readonly ScanFile[],
  fileSystem: StaticAnalysisFileSystem,
  parsers: readonly StaticAnalysisParser[],
  signal: { readonly aborted: boolean },
  addDiagnostic: (diagnostic: AnalysisDiagnostic) => void,
  emitProgress: (
    phase: AnalysisProgress['phase'],
    details?: { readonly currentPath?: string; readonly percentage?: number },
  ) => void,
): Promise<ConfigRecord[]> {
  const configFiles: ScanFile[] = [];
  let totalConfigFileCount = 0;
  for (const file of files) {
    if (!isTypeScriptConfigPath(file.relativePath)) {
      continue;
    }
    totalConfigFileCount += 1;
    if (configFiles.length < STATIC_ANALYSIS_LIMITS.maxTsconfigFiles) {
      configFiles.push(file);
    }
  }
  configFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const configs: ConfigRecord[] = [];
  const parser = parsers.find((candidate) => candidate.parseResolutionConfig !== undefined);
  if (parser === undefined) {
    return configs;
  }
  if (totalConfigFileCount > configFiles.length) {
    addDiagnostic({
      code: 'RESULT_LIMIT_REACHED',
      severity: 'warning',
      message: `Only the first ${STATIC_ANALYSIS_LIMITS.maxTsconfigFiles} TypeScript configuration files were considered.`,
    });
  }

  let totalConfigBytes = 0;
  let totalPathMappings = 0;
  let configByteLimitReported = false;
  let pathMappingLimitReported = false;
  for (const file of configFiles) {
    if (signal.aborted) {
      break;
    }
    if (file.sizeBytes > MAX_TSCONFIG_BYTES) {
      addDiagnostic({
        code: 'TSCONFIG_INVALID',
        severity: 'warning',
        message:
          'The TypeScript configuration file exceeds its safe read limit; path aliases were not used.',
        filePath: file.relativePath,
      });
      configs.push({ path: file.relativePath, resolution: null });
      continue;
    }
    if (totalConfigBytes + file.sizeBytes > STATIC_ANALYSIS_LIMITS.maxTotalTsconfigBytes) {
      if (!configByteLimitReported) {
        configByteLimitReported = true;
        addDiagnostic({
          code: 'RESULT_LIMIT_REACHED',
          severity: 'warning',
          message:
            'The total TypeScript configuration read limit was reached; remaining aliases were not used.',
        });
      }
      configs.push({ path: file.relativePath, resolution: null });
      continue;
    }
    totalConfigBytes += file.sizeBytes;
    emitProgress('reading', { currentPath: file.relativePath });
    try {
      const source = await fileSystem.readTextFile(file.relativePath, file.sizeBytes);
      if (source === null) {
        addDiagnostic({
          code: 'TSCONFIG_INVALID',
          severity: 'warning',
          message:
            'RepoLens could not read this TypeScript configuration; path aliases were not used.',
          filePath: file.relativePath,
        });
        configs.push({ path: file.relativePath, resolution: null });
        continue;
      }
      if (utf8ByteLength(source, file.sizeBytes) > file.sizeBytes) {
        addDiagnostic({
          code: 'TSCONFIG_INVALID',
          severity: 'warning',
          message:
            'The TypeScript configuration changed after the scan and exceeded its recorded size; aliases were not used.',
          filePath: file.relativePath,
        });
        configs.push({ path: file.relativePath, resolution: null });
        continue;
      }
      const parsed = parser.parseResolutionConfig?.(file.relativePath, source);
      if (parsed === undefined) {
        configs.push({ path: file.relativePath, resolution: null });
        continue;
      }
      for (const diagnostic of parsed.diagnostics) {
        addDiagnostic(toAnalysisDiagnostic(file.relativePath, diagnostic));
      }

      if (parsed.resolution === null) {
        configs.push({ path: file.relativePath, resolution: null });
        continue;
      }

      const rawBaseUrl = parsed.resolution.baseUrl;
      let baseUrl = rawBaseUrl;
      if (
        rawBaseUrl !== undefined &&
        (typeof rawBaseUrl !== 'string' ||
          rawBaseUrl.length > STATIC_ANALYSIS_LIMITS.maxTsconfigBaseUrlLength)
      ) {
        baseUrl = undefined;
        addDiagnostic({
          code: 'TSCONFIG_INVALID',
          severity: 'warning',
          message: 'The TypeScript baseUrl exceeds its safe length and was ignored.',
          filePath: file.relativePath,
        });
      }

      const rawMappings = parsed.resolution.paths ?? [];
      const remainingMappings = Math.max(
        0,
        STATIC_ANALYSIS_LIMITS.maxTsconfigPathMappings - totalPathMappings,
      );
      if (rawMappings.length > remainingMappings && !pathMappingLimitReported) {
        pathMappingLimitReported = true;
        addDiagnostic({
          code: 'RESULT_LIMIT_REACHED',
          severity: 'warning',
          message: `At most ${STATIC_ANALYSIS_LIMITS.maxTsconfigPathMappings} TypeScript path mappings are used across all scanned configurations.`,
          filePath: file.relativePath,
        });
      }

      const boundedMappings: ParsedPathMapping[] = [];
      for (const mapping of rawMappings.slice(0, remainingMappings)) {
        if (
          mapping.pattern.length === 0 ||
          mapping.pattern.length > 512 ||
          (mapping.pattern.match(/\*/g)?.length ?? 0) > 1
        ) {
          addDiagnostic({
            code: 'TSCONFIG_INVALID',
            severity: 'warning',
            message: 'An invalid TypeScript path mapping was ignored.',
            filePath: file.relativePath,
          });
          continue;
        }
        const consideredTargets = mapping.targets.slice(0, 100);
        const targets = consideredTargets.filter(
          (target) => target.length > 0 && target.length <= 1_024,
        );
        if (targets.length !== mapping.targets.length) {
          addDiagnostic({
            code: 'TSCONFIG_INVALID',
            severity: 'warning',
            message:
              'One or more TypeScript path-alias targets were invalid or exceeded their safe limit.',
            filePath: file.relativePath,
          });
        }
        if (targets.length > 0) {
          boundedMappings.push({ pattern: mapping.pattern, targets });
        }
      }
      totalPathMappings += boundedMappings.length;
      const resolution: ParsedResolutionConfig = {
        ...(parsed.resolution.extends === undefined ? {} : { extends: parsed.resolution.extends }),
        ...(baseUrl === undefined ? {} : { baseUrl }),
        ...(parsed.resolution.paths === undefined ? {} : { paths: boundedMappings }),
      };
      configs.push({ path: file.relativePath, resolution });
    } catch {
      addDiagnostic({
        code: 'TSCONFIG_INVALID',
        severity: 'warning',
        message:
          'RepoLens could not parse this TypeScript configuration; path aliases were not used.',
        filePath: file.relativePath,
      });
      configs.push({ path: file.relativePath, resolution: null });
    }
  }
  return resolveConfigInheritance(configs, addDiagnostic);
}

function resolveConfigInheritance(
  configs: readonly ConfigRecord[],
  addDiagnostic: (diagnostic: AnalysisDiagnostic) => void,
): ConfigRecord[] {
  const configByPath = new Map(configs.map((config) => [config.path, config] as const));
  const stateByPath = new Map<string, 'visiting' | 'resolved' | 'invalid'>();
  const effectiveByPath = new Map<string, EffectiveResolution>();
  const reported = new Set<string>();

  const reportConfigIssue = (
    path: string,
    code: AnalysisDiagnostic['code'],
    message: string,
  ): void => {
    const key = `${path}:${code}:${message}`;
    if (reported.has(key)) {
      return;
    }
    reported.add(key);
    addDiagnostic({ code, severity: 'warning', message, filePath: path });
  };

  const resolve = (config: ConfigRecord, depth: number): EffectiveResolution | null => {
    const state = stateByPath.get(config.path);
    if (state === 'resolved') {
      return effectiveByPath.get(config.path) ?? null;
    }
    if (state === 'invalid') {
      return null;
    }
    if (state === 'visiting') {
      stateByPath.set(config.path, 'invalid');
      reportConfigIssue(
        config.path,
        'TSCONFIG_EXTENDS_UNSUPPORTED',
        'A TypeScript configuration extends cycle was detected; inherited aliases were not used.',
      );
      return null;
    }

    stateByPath.set(config.path, 'visiting');
    const parsedResolution = config.resolution;
    if (parsedResolution === null) {
      stateByPath.set(config.path, 'invalid');
      return null;
    }

    let inherited: EffectiveResolution | null = null;
    if (parsedResolution.extends !== undefined) {
      if (depth >= STATIC_ANALYSIS_LIMITS.maxTsconfigExtendsDepth) {
        reportConfigIssue(
          config.path,
          'TSCONFIG_EXTENDS_UNSUPPORTED',
          `TypeScript configuration inheritance exceeded the safe depth of ${STATIC_ANALYSIS_LIMITS.maxTsconfigExtendsDepth}; remaining inherited aliases were not used.`,
        );
      } else {
        const parentPath = resolveLocalExtendsPath(config.path, parsedResolution.extends);
        const parent = parentPath === null ? undefined : configByPath.get(parentPath);
        if (parent === undefined) {
          reportConfigIssue(
            config.path,
            'TSCONFIG_EXTENDS_UNSUPPORTED',
            'This TypeScript configuration extends a package, an unsafe path, or a config outside the scanned inventory; inherited aliases were not used.',
          );
        } else {
          inherited = resolve(parent, depth + 1);
        }
      }
    }

    if (stateByPath.get(config.path) === 'invalid') {
      return null;
    }

    let baseUrl: string | undefined;
    if (parsedResolution.baseUrl !== undefined) {
      baseUrl = toProjectPath(dirname(config.path), parsedResolution.baseUrl) ?? undefined;
      if (baseUrl === undefined) {
        reportConfigIssue(
          config.path,
          'TSCONFIG_INVALID',
          'The TypeScript baseUrl resolves outside the scanned project inventory and was ignored.',
        );
      }
    } else {
      baseUrl = inherited?.baseUrl;
    }

    const paths =
      parsedResolution.paths === undefined
        ? (inherited?.paths ?? [])
        : parsedResolution.paths.map((mapping) => ({
            ...mapping,
            baseDirectory: baseUrl ?? dirname(config.path),
          }));
    const effective: EffectiveResolution = {
      ...(baseUrl === undefined ? {} : { baseUrl }),
      paths,
    };
    stateByPath.set(config.path, 'resolved');
    effectiveByPath.set(config.path, effective);
    return effective;
  };

  const configsByDirectory = new Map<string, ConfigRecord[]>();
  for (const config of configs) {
    const directory = dirname(config.path);
    const siblings = configsByDirectory.get(directory) ?? [];
    siblings.push(config);
    configsByDirectory.set(directory, siblings);
  }
  for (const [directory, siblings] of configsByDirectory) {
    const standardPath = directory === '' ? 'tsconfig.json' : `${directory}/tsconfig.json`;
    if (siblings.length > 1 && !configByPath.has(standardPath)) {
      reportConfigIssue(
        siblings[0]?.path ?? standardPath,
        'TSCONFIG_EXTENDS_UNSUPPORTED',
        'Multiple specialized TypeScript configurations share a directory; RepoLens did not guess which one applies.',
      );
    }
  }

  return configs.map((config) => {
    const effectiveResolution = resolve(config, 0);
    return effectiveResolution === null ? config : { ...config, effectiveResolution };
  });
}

function resolveLocalExtendsPath(configPath: string, extendsPath: string): string | null {
  if (
    (!extendsPath.startsWith('./') && !extendsPath.startsWith('../')) ||
    extendsPath.includes('\\')
  ) {
    return null;
  }
  const candidatePath = extendsPath.toLowerCase().endsWith('.json')
    ? extendsPath
    : `${extendsPath}.json`;
  const resolved = toProjectPath(dirname(configPath), candidatePath);
  return resolved !== null && isTypeScriptConfigPath(resolved) ? resolved : null;
}

function isTypeScriptConfigPath(path: string): boolean {
  return /(^|\/)tsconfig(?:\.[^/]+)?\.json$/i.test(path);
}

function toAnalysisDiagnostic(filePath: string, diagnostic: ParsedDiagnostic): AnalysisDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.code === 'PARSE_ERROR' ? 'error' : 'warning',
    message: diagnostic.message.slice(0, 1024) || 'Static analysis reported an issue.',
    filePath,
    ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
    ...(diagnostic.column === undefined ? {} : { column: diagnostic.column }),
  };
}

function findConfigForFile(
  filePath: string,
  configByPath: ReadonlyMap<string, ConfigRecord>,
  configByDirectory: ReadonlyMap<string, readonly ConfigRecord[]>,
): ConfigRecord | null | undefined {
  let directory = dirname(filePath);
  while (true) {
    const candidatePath = directory === '' ? 'tsconfig.json' : `${directory}/tsconfig.json`;
    const config = configByPath.get(candidatePath);
    if (config !== undefined) {
      return config;
    }
    const siblings = configByDirectory.get(directory) ?? [];
    if (siblings.length === 1) {
      return siblings[0];
    }
    if (siblings.length > 1) {
      return null;
    }
    if (directory === '') {
      return undefined;
    }
    directory = dirname(directory);
  }
}

function resolveDependency(
  fromPath: string,
  specifier: string,
  configRecord: ConfigRecord | null | undefined,
  knownPaths: ReadonlySet<string>,
): ResolvedDependency {
  if (specifier.length === 0 || specifier.includes('\\')) {
    return unresolved('The module specifier is not a normalized static path.');
  }

  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const target = resolveScannedPath(dirname(fromPath), specifier, knownPaths);
    return target.path === null
      ? unresolved(
          target.ambiguous
            ? 'Multiple scanned files match this local module specifier; RepoLens did not guess.'
            : 'No matching local source file was present in the scan result.',
        )
      : { kind: 'local', resolvedPath: target.path };
  }

  if (specifier.startsWith('/') || /^[a-z]:[\\/]/i.test(specifier)) {
    return unresolved(
      'Absolute module paths are not resolved outside the project-relative scan inventory.',
    );
  }

  const resolution = configRecord?.effectiveResolution ?? null;
  if (resolution !== null) {
    const bestMappings: Array<{ readonly mapping: EffectivePathMapping; readonly match: string }> =
      [];
    let bestPrefixLength = -1;
    for (const mapping of resolution.paths ?? []) {
      const match = matchPathPattern(mapping.pattern, specifier);
      if (match === null) {
        continue;
      }
      const wildcardIndex = mapping.pattern.indexOf('*');
      const prefixLength = wildcardIndex === -1 ? mapping.pattern.length : wildcardIndex;
      if (prefixLength > bestPrefixLength) {
        bestPrefixLength = prefixLength;
        bestMappings.length = 0;
      }
      if (prefixLength === bestPrefixLength) {
        bestMappings.push({ mapping, match });
      }
    }

    if (bestMappings.length > 0) {
      if (bestMappings.length !== 1) {
        return unresolved(
          'Multiple TypeScript path-alias patterns match this specifier; RepoLens did not guess.',
        );
      }
      const bestMapping = bestMappings[0];
      if (bestMapping === undefined) {
        return unresolved('The TypeScript path alias could not be selected safely.');
      }
      for (const target of bestMapping.mapping.targets) {
        const substituted = bestMapping.mapping.pattern.includes('*')
          ? target.replace('*', bestMapping.match)
          : target;
        const candidate = resolveScannedPath(
          bestMapping.mapping.baseDirectory,
          substituted,
          knownPaths,
        );
        if (candidate.ambiguous) {
          return unresolved(
            'Multiple scanned files match the configured TypeScript path alias; RepoLens did not guess.',
          );
        }
        if (candidate.path !== null) {
          return { kind: 'alias', resolvedPath: candidate.path };
        }
      }
      return unresolved(
        'The configured TypeScript path alias did not match a file in the scan result.',
      );
    }

    if (resolution.baseUrl !== undefined) {
      const resolved = resolveScannedPath(resolution.baseUrl, specifier, knownPaths);
      if (resolved.path !== null) {
        return { kind: 'alias', resolvedPath: resolved.path };
      }
      if (resolved.ambiguous) {
        return unresolved(
          'Multiple scanned files match this baseUrl module; RepoLens did not guess.',
        );
      }
    }
  }

  const packageName = getPackageName(specifier);
  return packageName === null
    ? unresolved('The bare module specifier is not a valid package-style name or configured alias.')
    : packageName.length > 512
      ? unresolved('The external package name exceeds the safe analysis length.')
      : { kind: 'external-package', packageName };
}

function resolveScannedPath(
  baseDirectory: string,
  specifier: string,
  knownPaths: ReadonlySet<string>,
): CandidateResolution {
  const requested = toProjectPath(baseDirectory, specifier);
  if (requested === null) {
    return { path: null, ambiguous: false };
  }
  if (knownPaths.has(requested)) {
    return { path: requested, ambiguous: false };
  }

  const extension = getExtension(requested);
  const variants =
    extension.length === 0
      ? [
          ...RESOLUTION_EXTENSIONS.map((candidateExtension) => `${requested}${candidateExtension}`),
          ...RESOLUTION_EXTENSIONS.map(
            (candidateExtension) => `${requested}/index${candidateExtension}`,
          ),
        ]
      : substituteTypeScriptExtension(requested, extension);
  return resolveCandidates(variants, knownPaths);
}

function resolveCandidates(
  candidates: readonly string[],
  knownPaths: ReadonlySet<string>,
): CandidateResolution {
  const matches = [...new Set(candidates)].filter((candidate) => knownPaths.has(candidate)).sort();
  if (matches.length === 1) {
    return { path: matches[0] ?? null, ambiguous: false };
  }
  return { path: null, ambiguous: matches.length > 1 };
}

function substituteTypeScriptExtension(path: string, extension: string): string[] {
  const substitutions: Readonly<Record<string, readonly string[]>> = {
    '.js': ['.ts', '.tsx', '.d.ts'],
    '.jsx': ['.tsx'],
    '.mjs': ['.mts'],
    '.cjs': ['.cts'],
  };
  const mapped = substitutions[extension];
  if (mapped === undefined) {
    return [];
  }
  const stem = path.slice(0, -extension.length);
  return mapped.map((candidateExtension) => `${stem}${candidateExtension}`);
}

function getPackageName(specifier: string): string | null {
  if (specifier.startsWith('node:')) {
    return specifier;
  }
  if (specifier.startsWith('@')) {
    if (specifier.startsWith('@/')) {
      return null;
    }
    const segments = specifier.split('/');
    return segments.length >= 2 && segments[0] !== '@' && segments[1]
      ? `${segments[0]}/${segments[1]}`
      : null;
  }
  if (specifier.startsWith('#') || specifier.startsWith('~')) {
    return null;
  }
  const firstSegment = specifier.split('/')[0];
  return firstSegment === undefined || firstSegment.length === 0 ? null : firstSegment;
}

function matchPathPattern(pattern: string, value: string): string | null {
  const firstStar = pattern.indexOf('*');
  if (firstStar === -1) {
    return pattern === value ? '' : null;
  }
  if (pattern.indexOf('*', firstStar + 1) !== -1) {
    return null;
  }
  const prefix = pattern.slice(0, firstStar);
  const suffix = pattern.slice(firstStar + 1);
  if (
    !value.startsWith(prefix) ||
    !value.endsWith(suffix) ||
    value.length < prefix.length + suffix.length
  ) {
    return null;
  }
  return value.slice(prefix.length, value.length - suffix.length);
}

function symbolId(
  filePath: string,
  symbol: ParsedSourceFile['symbols'][number],
  counts: Map<string, number>,
): string {
  if (symbol.kind === 'module') {
    return `${filePath}#module`;
  }
  return makeElementId(filePath, 'symbol', symbol.kind, symbol.location, counts);
}

function relationshipId(
  filePath: string,
  category: 'import' | 'export',
  record: ParsedImport | ParsedExport,
  counts: Map<string, number>,
): string {
  return makeElementId(filePath, category, record.kind, record.location, counts);
}

function makeElementId(
  filePath: string,
  category: 'symbol' | 'import' | 'export',
  kind: string,
  location: { readonly startLine: number; readonly startColumn: number },
  counts: Map<string, number>,
): string {
  const base = `${filePath}#${category}:${kind}:${location.startLine}:${location.startColumn}`;
  const ordinal = counts.get(base) ?? 0;
  counts.set(base, ordinal + 1);
  return ordinal === 0 ? base : `${base}:${ordinal}`;
}

function toProjectPath(baseDirectory: string, path: string): string | null {
  if (path.startsWith('/') || /^[a-z]:[\\/]/i.test(path) || path.includes('\\')) {
    return null;
  }
  return normalizeProjectPath(joinProjectPath(baseDirectory, path));
}

function normalizeProjectPath(path: string): string | null {
  if (path.startsWith('/') || /^[a-z]:[\\/]/i.test(path) || path.includes('\\')) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

function joinProjectPath(...paths: readonly string[]): string {
  return paths.filter((path) => path.length > 0).join('/');
}

function utf8ByteLength(value: string, maxBytes = Number.POSITIVE_INFINITY): number {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charCodeAt(index);
    if (character <= 0x7f) {
      byteLength += 1;
    } else if (character <= 0x7ff) {
      byteLength += 2;
    } else if (
      character >= 0xd800 &&
      character <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      byteLength += 4;
      index += 1;
    } else {
      byteLength += 3;
    }
    if (byteLength > maxBytes) {
      return byteLength;
    }
  }
  return byteLength;
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function getExtension(path: string): string {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  const dot = basename.lastIndexOf('.');
  return dot <= 0 ? '' : basename.slice(dot).toLowerCase();
}

function percentage(processed: number, total: number): number {
  return total === 0 ? 100 : Math.min(100, Math.floor((processed / total) * 100));
}

function unresolved(reason: string): ResolvedDependency {
  return { kind: 'unresolved', reason };
}
