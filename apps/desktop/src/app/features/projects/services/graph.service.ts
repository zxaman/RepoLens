import { Injectable } from '@angular/core';
import type {
  GraphBuildProgress,
  GraphCycleReport,
  GraphGenerationReport,
  GraphNeighborhoodQuery,
  GraphNeighborhoodResult,
  GraphNodeQuery,
  GraphNodeQueryResult,
  GraphSummary,
  RepoLensAPI,
  Result,
} from '@repolens/shared';
import { RendererServiceError } from './project.service';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new RendererServiceError(result.error.message, result.error.code);
  }
  return result.data;
}

@Injectable({ providedIn: 'root' })
export class GraphService {
  async generate(
    projectId: string,
    scanId: string,
    analysisId: string,
  ): Promise<GraphGenerationReport> {
    return unwrap(await this.getBridge().graphs.generate(projectId, scanId, analysisId));
  }

  async summary(projectId: string): Promise<GraphSummary | null> {
    return unwrap(await this.getBridge().graphs.summary(projectId));
  }

  async query(projectId: string, query: GraphNodeQuery): Promise<GraphNodeQueryResult | null> {
    return unwrap(await this.getBridge().graphs.query(projectId, query));
  }

  async neighborhood(
    projectId: string,
    query: GraphNeighborhoodQuery,
  ): Promise<GraphNeighborhoodResult | null> {
    return unwrap(await this.getBridge().graphs.neighborhood(projectId, query));
  }

  async cycles(projectId: string): Promise<GraphCycleReport | null> {
    return unwrap(await this.getBridge().graphs.cycles(projectId));
  }

  onProgress(callback: (progress: GraphBuildProgress) => void): () => void {
    return this.getBridge().graphs.onProgress(callback);
  }

  private getBridge(): RepoLensAPI {
    if (typeof window === 'undefined' || window.repolens === undefined) {
      throw new RendererServiceError(
        'Dependency graph generation is available in the RepoLens desktop application.',
        'DESKTOP_RUNTIME_UNAVAILABLE',
      );
    }
    return window.repolens;
  }
}
