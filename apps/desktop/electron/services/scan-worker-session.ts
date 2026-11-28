import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProgressSchema, scanResultSchema } from '@repolens/shared';
import type { ScanConfig, ScanProgress, ScanResult } from '@repolens/shared';

const serviceDirectory = dirname(fileURLToPath(import.meta.url));

export interface WorkerScanInput {
  readonly scanId: string;
  readonly projectId: string;
  readonly rootPath: string;
  readonly config: ScanConfig;
}

export interface ScanWorkerSession {
  readonly finished: boolean;
  run(input: WorkerScanInput, onProgress: (progress: ScanProgress) => void): Promise<ScanResult>;
  cancel(): void;
  terminate(): Promise<void>;
}

export class ElectronScanWorkerSession implements ScanWorkerSession {
  private readonly worker: Worker;
  private settled = false;
  private terminated = false;

  constructor(workerPath = join(serviceDirectory, 'scan-worker.js')) {
    this.worker = new Worker(workerPath);
  }

  get finished(): boolean {
    return this.settled;
  }

  run(input: WorkerScanInput, onProgress: (progress: ScanProgress) => void): Promise<ScanResult> {
    return new Promise<ScanResult>((resolveResult, rejectResult) => {
      const finishResolve = (result: ScanResult): void => {
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
          const progressResult = scanProgressSchema.safeParse(value['progress']);
          if (
            progressResult.success &&
            progressResult.data.scanId === input.scanId &&
            progressResult.data.projectId === input.projectId
          ) {
            try {
              onProgress(progressResult.data);
            } catch {
              // A progress listener must not interrupt the scan worker.
            }
          }
          return;
        }
        if (value['type'] === 'result') {
          const result = scanResultSchema.safeParse(value['result']);
          if (
            result.success &&
            result.data.id === input.scanId &&
            result.data.projectId === input.projectId
          ) {
            finishResolve(result.data);
          } else {
            finishReject(new Error('The scan worker returned an invalid result.'));
          }
          return;
        }
        if (value['type'] === 'failure') {
          const message =
            typeof value['message'] === 'string'
              ? value['message']
              : 'The scan worker failed unexpectedly.';
          finishReject(new Error(message));
        }
      });
      this.worker.once('error', () => {
        finishReject(new Error('The scan worker could not complete the scan.'));
      });
      this.worker.once('exit', (code) => {
        if (!this.settled) {
          finishReject(
            new Error(
              code === 0
                ? 'The scan worker exited before returning a result.'
                : 'The scan worker stopped unexpectedly.',
            ),
          );
        }
      });

      try {
        this.worker.postMessage({ type: 'start', ...input });
      } catch {
        finishReject(new Error('The scan worker could not be started.'));
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
