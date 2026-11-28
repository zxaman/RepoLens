import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analysisProgressSchema, analysisResultSchema, scanResultSchema } from '@repolens/shared';
import type { AnalysisProgress, AnalysisResult, ScanResult } from '@repolens/shared';

const serviceDirectory = dirname(fileURLToPath(import.meta.url));

export interface WorkerAnalysisInput {
  readonly analysisId: string;
  readonly projectId: string;
  readonly scanId: string;
  readonly rootPath: string;
  readonly scan: ScanResult;
}

export interface AnalysisWorkerSession {
  readonly finished: boolean;
  run(
    input: WorkerAnalysisInput,
    onProgress: (progress: AnalysisProgress) => void,
  ): Promise<AnalysisResult>;
  cancel(): void;
  terminate(): Promise<void>;
}

export class ElectronAnalysisWorkerSession implements AnalysisWorkerSession {
  private readonly worker: Worker;
  private settled = false;
  private terminated = false;

  constructor(workerPath = join(serviceDirectory, 'analysis-worker.js')) {
    this.worker = new Worker(workerPath);
  }

  get finished(): boolean {
    return this.settled;
  }

  run(
    input: WorkerAnalysisInput,
    onProgress: (progress: AnalysisProgress) => void,
  ): Promise<AnalysisResult> {
    return new Promise<AnalysisResult>((resolveResult, rejectResult) => {
      const finishResolve = (result: AnalysisResult): void => {
        if (this.settled) {
          return;
        }
        this.settled = true;
        resolveResult(result);
      };
      const finishReject = (error: Error): void => {
        if (this.settled) {
          return;
        }
        this.settled = true;
        rejectResult(error);
      };

      this.worker.on('message', (value: unknown) => {
        if (!isRecord(value) || typeof value['type'] !== 'string') {
          return;
        }
        if (value['type'] === 'progress') {
          const progress = analysisProgressSchema.safeParse(value['progress']);
          if (
            progress.success &&
            progress.data.analysisId === input.analysisId &&
            progress.data.projectId === input.projectId &&
            progress.data.scanId === input.scanId
          ) {
            try {
              onProgress(progress.data);
            } catch {
              // A progress listener cannot interrupt the analysis worker.
            }
          }
          return;
        }
        if (value['type'] === 'result') {
          const result = analysisResultSchema.safeParse(value['result']);
          if (
            result.success &&
            result.data.analysisId === input.analysisId &&
            result.data.projectId === input.projectId &&
            result.data.scanId === input.scanId
          ) {
            finishResolve(result.data);
          } else {
            finishReject(new Error('The analysis worker returned an invalid result.'));
          }
          return;
        }
        if (value['type'] === 'failure') {
          const message =
            typeof value['message'] === 'string'
              ? value['message']
              : 'The analysis worker failed unexpectedly.';
          finishReject(new Error(message));
        }
      });
      this.worker.once('error', () => {
        finishReject(new Error('The analysis worker could not complete static analysis.'));
      });
      this.worker.once('exit', (code) => {
        if (!this.settled) {
          finishReject(
            new Error(
              code === 0
                ? 'The analysis worker exited before returning a result.'
                : 'The analysis worker stopped unexpectedly.',
            ),
          );
        }
      });

      try {
        const scan = scanResultSchema.parse(input.scan);
        if (scan.id !== input.scanId || scan.projectId !== input.projectId) {
          finishReject(new Error('The analysis request did not match its validated scan.'));
          return;
        }
        this.worker.postMessage({ type: 'start', ...input, scan });
      } catch {
        finishReject(new Error('The analysis worker could not be started.'));
      }
    });
  }

  cancel(): void {
    if (this.settled) {
      return;
    }
    try {
      this.worker.postMessage({ type: 'cancel' });
    } catch {
      // Worker shutdown is handled by the pending run promise.
    }
  }

  async terminate(): Promise<void> {
    if (this.terminated) {
      return;
    }
    this.terminated = true;
    if (!this.settled) {
      this.cancel();
    }
    await this.worker.terminate();
    this.settled = true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
