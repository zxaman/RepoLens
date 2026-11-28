import type { Analyzer } from '@repolens/core';

export interface LanguageDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly extensions: readonly `.${string}`[];
}

/** Generic parser extension point for additional language-specific frontends. */
export interface LanguageParser<TSyntaxTree> {
  readonly language: LanguageDefinition;
  parse(filePath: string, sourceText: string): Promise<TSyntaxTree>;
}

/** Language-specific analysis stages can use the common core analyzer contract. */
export interface LanguageAnalyzer<TResult> extends Analyzer<TResult> {
  readonly language: LanguageDefinition;
}

export { TypeScriptParser } from './typescript-parser.js';
export type {
  ParsedDiagnostic,
  ParsedExport,
  ParsedImport,
  ParsedPathMapping,
  ParsedResolutionConfig,
  ParsedResolutionConfigResult,
  ParsedSourceFile,
  ParsedSymbol,
  StaticAnalysisParser,
} from '@repolens/core';
