import type {
  AnalysisImport,
  AnalysisImportBinding,
  AnalysisSymbol,
  AnalysisExport,
} from '@repolens/shared';

export type SourceLocation = AnalysisSymbol['location'];
export type SourceSymbolKind = AnalysisSymbol['kind'];
export type SourceImportKind = AnalysisImport['kind'];
export type SourceExportKind = AnalysisExport['kind'];

export interface ParsedSymbol {
  readonly key: string;
  readonly name: string;
  readonly kind: SourceSymbolKind;
  readonly location: SourceLocation;
  readonly parentKey?: string;
  readonly exported: boolean;
}

export interface ParsedImport {
  readonly key: string;
  readonly specifier: string;
  readonly kind: SourceImportKind;
  readonly bindings: readonly AnalysisImportBinding[];
  readonly isTypeOnly: boolean;
  readonly location: SourceLocation;
}

export interface ParsedExport {
  readonly key: string;
  readonly name: string;
  readonly kind: SourceExportKind;
  readonly localName?: string;
  readonly source?: string;
  readonly isTypeOnly: boolean;
  readonly location: SourceLocation;
}

export interface ParsedDiagnostic {
  readonly code:
    'PARSE_ERROR' | 'TSCONFIG_INVALID' | 'TSCONFIG_EXTENDS_UNSUPPORTED' | 'RESULT_LIMIT_REACHED';
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ParsedSourceFile {
  readonly symbols: readonly ParsedSymbol[];
  readonly imports: readonly ParsedImport[];
  readonly exports: readonly ParsedExport[];
  readonly diagnostics: readonly ParsedDiagnostic[];
  readonly truncated: boolean;
}

export interface ParsedPathMapping {
  readonly pattern: string;
  readonly targets: readonly string[];
}

export interface ParsedResolutionConfig {
  readonly baseUrl?: string;
  readonly paths?: readonly ParsedPathMapping[];
}

export interface ParsedResolutionConfigResult {
  readonly resolution: ParsedResolutionConfig | null;
  readonly diagnostics: readonly ParsedDiagnostic[];
}

/** A language parser normalizes syntax into framework-independent static-analysis records. */
export interface StaticAnalysisParser {
  readonly id: string;
  readonly languageNames: readonly string[];
  readonly extensions: readonly string[];
  parse(filePath: string, sourceText: string): ParsedSourceFile;
  parseResolutionConfig?(filePath: string, sourceText: string): ParsedResolutionConfigResult;
}

export interface StaticAnalysisFileSystem {
  /** Reads only a project-relative path selected from a validated ScanResult. */
  readTextFile(relativePath: string, maxBytes: number): Promise<string | null>;
  yieldToEventLoop?(): Promise<void>;
}

export interface AnalysisCancellation {
  readonly aborted: boolean;
}
