import { Injectable } from '@angular/core';
import type {
  RepoLensAPI,
  Result,
  ScanConfig,
  ScanHistoryItem,
  ScanProgress,
  ScanResult,
} from '@repolens/shared';
import { RendererServiceError } from './project.service';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new RendererServiceError(result.error.message, result.error.code);
  }
  return result.data;
}

@Injectable({ providedIn: 'root' })
export class ScanService {
  async start(projectId: string, config: ScanConfig): Promise<ScanResult> {
    return unwrap(await this.getBridge().scans.start(projectId, config));
  }

  async cancel(scanId: string): Promise<void> {
    unwrap(await this.getBridge().scans.cancel(scanId));
  }

  async getHistory(projectId: string): Promise<readonly ScanHistoryItem[]> {
    return unwrap(await this.getBridge().scans.getHistory(projectId));
  }

  async getLatest(projectId: string): Promise<ScanHistoryItem | null> {
    return unwrap(await this.getBridge().scans.getLatest(projectId));
  }

  onProgress(callback: (progress: ScanProgress) => void): () => void {
    return this.getBridge().scans.onProgress(callback);
  }

  private getBridge(): RepoLensAPI {
    if (typeof window === 'undefined' || window.repolens === undefined) {
      throw new RendererServiceError(
        'Repository scanning is available in the RepoLens desktop application.',
        'DESKTOP_RUNTIME_UNAVAILABLE',
      );
    }
    return window.repolens;
  }
}
