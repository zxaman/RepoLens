import { parentPort } from 'node:worker_threads';
import { isAbsolute } from 'node:path';
import { analysisResultSchema, scanResultSchema } from '@repolens/shared';
import type { AnalysisProgress, ScanResult } from '@repolens/shared';
import { z } from 'zod';
import { analyzeScan } from '@repolens/core';
import { TypeScriptParser } from '@repolens/language-support';
import { NodeAnalysisFileSystem } from './node-analysis-file-system.js';
import { safeErrorDetails } from './diagnostic-logging.js';

interface StartMessage {
  readonly type: 'start';
  readonly analysisId: string;
  readonly projectId: string;
  readonly scanId: string;
  readonly rootPath: string;
  readonly scan: ScanResult;
}

interface CancelMessage {
  readonly type: 'cancel';
}

type WorkerRequest = StartMessage | CancelMessage;

type WorkerResponse =
  | { readonly type: 'progress'; readonly progress: AnalysisProgress }
  | { readonly type: 'result'; readonly result: unknown }
  | { readonly type: 'failure'; readonly message: string };

const startRequestSchema = z
  .object({
    type: z.literal('start'),
    analysisId: z.uuid(),
    projectId: z.uuid(),
    scanId: z.uuid(),
    rootPath: z.string().min(1).max(4096),
    scan: scanResultSchema,
  })
  .strict();

if (parentPort === null) {
  throw new Error('RepoLens analysis worker must be started as a worker thread.');
}

let controller: AbortController | null = null;
let started = false;

parentPort.on('message', (value: unknown) => {
  const message = parseWorkerRequest(value);
  if (message === null) {
    postMessage({ type: 'failure', message: 'The analysis worker received an invalid request.' });
    parentPort?.close();
    return;
  }
  if (message.type === 'cancel') {
    controller?.abort();
    return;
  }
  if (started) {
    postMessage({ type: 'failure', message: 'An analysis worker can process only one request.' });
    return;
  }

  started = true;
  controller = new AbortController();
  void runAnalysis(message, controller);
});

async function runAnalysis(message: StartMessage, abortController: AbortController): Promise<void> {
  let lastProgressAt = 0;
  let pendingProgress: AnalysisProgress | null = null;
  const reportProgress = (progress: AnalysisProgress): void => {
    const now = Date.now();
    if (now - lastProgressAt >= 75 || progress.phase === 'finalizing') {
      lastProgressAt = now;
      pendingProgress = null;
      postMessage({ type: 'progress', progress });
    } else {
      pendingProgress = progress;
    }
  };

  try {
    const allowedPaths = new Set(message.scan.files.map((file) => file.relativePath));
    const result = await analyzeScan({
      analysisId: message.analysisId,
      scan: message.scan,
      fileSystem: new NodeAnalysisFileSystem(message.rootPath, allowedPaths),
      parsers: [new TypeScriptParser()],
      signal: abortController.signal,
      onProgress: reportProgress,
    });
    if (pendingProgress !== null) {
      postMessage({ type: 'progress', progress: pendingProgress });
    }
    postMessage({ type: 'result', result: analysisResultSchema.parse(result) });
  } catch (error) {
    console.error(
      'RepoLens static-analysis worker failed.',
      safeErrorDetails(error, [message.rootPath]),
    );
    postMessage({
      type: 'failure',
      message: 'The analysis worker stopped before it could return a validated result.',
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
  const parsed = startRequestSchema.safeParse(value);
  if (
    !parsed.success ||
    !isAbsolute(parsed.data.rootPath) ||
    parsed.data.scan.id !== parsed.data.scanId ||
    parsed.data.scan.projectId !== parsed.data.projectId
  ) {
    return null;
  }
  return parsed.data;
}

function postMessage(message: WorkerResponse): void {
  try {
    parentPort?.postMessage(message);
  } catch {
    // A closed window or worker must not interrupt local analysis cleanup.
  }
}
