import type { Analyzer } from '@repolens/core';

export interface LanguageDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly extensions: readonly `.${string}`[];
}

/** Parser extension point only; no language parser is registered in the foundation milestone. */
export interface LanguageParser<TSyntaxTree> {
  readonly language: LanguageDefinition;
  parse(filePath: string, sourceText: string): Promise<TSyntaxTree>;
}

/** Language-specific analysis stages can use the common core analyzer contract. */
export interface LanguageAnalyzer<TResult> extends Analyzer<TResult> {
  readonly language: LanguageDefinition;
}
