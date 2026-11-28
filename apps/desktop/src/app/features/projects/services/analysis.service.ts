import { Injectable } from '@angular/core';
import type { AnalysisProgress, AnalysisResult, RepoLensAPI, Result } from '@repolens/shared';
import { RendererServiceError } from './project.service';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new RendererServiceError(result.error.message, result.error.code);
  }
  return result.data;
}

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  async start(projectId: string, scanId: string): Promise<AnalysisResult> {
    return unwrap(await this.getBridge().analysis.start(projectId, scanId));
  }

  async cancel(analysisId: string): Promise<void> {
    unwrap(await this.getBridge().analysis.cancel(analysisId));
  }

  onProgress(callback: (progress: AnalysisProgress) => void): () => void {
    return this.getBridge().analysis.onProgress(callback);
  }

  private getBridge(): RepoLensAPI {
    if (typeof window === 'undefined' || window.repolens === undefined) {
      throw new RendererServiceError(
        'Static analysis is available in the RepoLens desktop application.',
        'DESKTOP_RUNTIME_UNAVAILABLE',
      );
    }
    return window.repolens;
  }
}
