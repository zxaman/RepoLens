import type { Project } from '@repolens/shared';

export interface AnalysisContext {
  readonly project: Readonly<Pick<Project, 'id' | 'rootPath'>>;
}

/** Defines the common contract future analyzers will implement; it performs no analysis itself. */
export interface Analyzer<TResult> {
  readonly id: string;
  run(context: AnalysisContext): Promise<TResult>;
}

/** A composable pipeline contract. Concrete stages are introduced with the analysis milestones. */
export interface AnalysisPipeline<TResult> {
  run(context: AnalysisContext): Promise<TResult>;
}

export function createAnalysisContext(project: Pick<Project, 'id' | 'rootPath'>): AnalysisContext {
  return {
    project: {
      id: project.id,
      rootPath: project.rootPath,
    },
  };
}
