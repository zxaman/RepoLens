import { parentPort } from 'node:worker_threads';
import { scanConfigSchema, scanResultSchema } from '@repolens/shared';
import type { ScanConfig, ScanProgress, ScanResult } from '@repolens/shared';
import { scanProject } from '@repolens/core';
import { NodeScanFileSystem } from './node-scan-file-system.js';
import { safeErrorDetails } from './diagnostic-logging.js';

const startRequestSchema = scanConfigSchema.transform((config) => config);

interface StartMessage {
  readonly type: 'start';
  readonly scanId: string;
  readonly projectId: string;
  readonly rootPath: string;
  readonly config: ScanConfig;
}

interface CancelMessage {
  readonly type: 'cancel';
}

type WorkerRequest = StartMessage | CancelMessage;

type WorkerResponse =
  | { readonly type: 'progress'; readonly progress: ScanProgress }
  | { readonly type: 'result'; readonly result: ScanResult }
  | { readonly type: 'failure'; readonly message: string };

if (parentPort === null) {
  throw new Error('RepoLens scan worker must be started as a worker thread.');
}

let controller: AbortController | null = null;
let started = false;

parentPort.on('message', (value: unknown) => {
  const message = parseWorkerRequest(value);
  if (message === null) {
    postMessage({ type: 'failure', message: 'The scan worker received an invalid request.' });
    return;
  }
  if (message.type === 'cancel') {
    controller?.abort();
    return;
  }
  if (started) {
    postMessage({ type: 'failure', message: 'A scan worker can process only one scan.' });
    return;
  }

  started = true;
  controller = new AbortController();
  void runScan(message, controller);
});

async function runScan(message: StartMessage, abortController: AbortController): Promise<void> {
  const fileSystem = new NodeScanFileSystem();
  let lastProgressAt = 0;
  let pendingProgress: ScanProgress | null = null;
  const reportProgress = (progress: ScanProgress): void => {
    const now = Date.now();
    if (now - lastProgressAt >= 75 || progress.phase === 'finalizing') {
      lastProgressAt = now;
      pendingProgress = null;
      postMessage({ type: 'progress', progress });
      return;
    }
    pendingProgress = progress;
  };

  try {
    const result = await scanProject({
      scanId: message.scanId,
      projectId: message.projectId,
      rootPath: message.rootPath,
      config: message.config,
      signal: abortController.signal,
      fileSystem,
      onProgress: reportProgress,
    });
    if (pendingProgress !== null) {
      postMessage({ type: 'progress', progress: pendingProgress });
    }
    postMessage({ type: 'result', result: scanResultSchema.parse(result) });
  } catch (error) {
    console.error('RepoLens scan worker failed.', safeErrorDetails(error, [message.rootPath]));
    postMessage({
      type: 'failure',
      message: 'The scan worker stopped unexpectedly before it could return a result.',
    });
  } finally {
    parentPort?.close();
  }
}

function parseWorkerRequest(value: unknown): WorkerRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record['type'] === 'cancel' && Object.keys(record).length === 1) {
    return { type: 'cancel' };
  }
  if (
    record['type'] !== 'start' ||
    typeof record['scanId'] !== 'string' ||
    typeof record['projectId'] !== 'string' ||
    typeof record['rootPath'] !== 'string'
  ) {
    return null;
  }
  const config = startRequestSchema.safeParse(record['config']);
  if (!config.success) {
    return null;
  }
  return {
    type: 'start',
    scanId: record['scanId'],
    projectId: record['projectId'],
    rootPath: record['rootPath'],
    config: config.data,
  };
}

function postMessage(message: WorkerResponse): void {
  try {
    parentPort?.postMessage(message);
  } catch {
    // The window or worker client may have been torn down during shutdown.
  }
}
