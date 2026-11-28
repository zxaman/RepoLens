import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ElectronAnalysisWorkerSession } from '../apps/desktop/dist/electron/services/analysis-worker-session.js';
import { ElectronScanWorkerSession } from '../apps/desktop/dist/electron/services/scan-worker-session.js';
import { buildProjectGraph } from '@repolens/core';
import { DEFAULT_SCAN_CONFIG } from '@repolens/shared';

const projectId = randomUUID();
const rootPath = await mkdtemp(join(tmpdir(), 'repolens-electron-worker-test-'));
let scanWorker;
let analysisWorker;

try {
  await mkdir(join(rootPath, 'src'), { recursive: true });
  await writeFile(
    join(rootPath, 'src/index.ts'),
    "import { helper } from './helper';\nexport function greet(name: string): string { return helper(name); }\n",
    'utf8',
  );
  await writeFile(
    join(rootPath, 'src/helper.ts'),
    'export const helper = (value: string) => `Hello ${value}`;\n',
    'utf8',
  );

  const scanId = randomUUID();
  scanWorker = new ElectronScanWorkerSession();
  const scan = await scanWorker.run(
    { scanId, projectId, rootPath, config: DEFAULT_SCAN_CONFIG },
    () => undefined,
  );
  assert.equal(scan.status, 'completed');
  assert.equal(scan.id, scanId);
  assert.equal(scan.files.filter((file) => file.classification === 'source').length, 2);

  analysisWorker = new ElectronAnalysisWorkerSession();
  const analysis = await analysisWorker.run(
    {
      analysisId: randomUUID(),
      projectId,
      scanId: scan.id,
      rootPath,
      scan,
    },
    () => undefined,
  );
  assert.equal(analysis.status, 'completed');
  assert.equal(analysis.scanId, scan.id);
  assert.equal(analysis.filesAnalyzed, 2);
  assert.deepEqual([...analysis.analyzedFiles].sort(), ['src/helper.ts', 'src/index.ts']);
  assert.ok(analysis.symbols.some((symbol) => symbol.name === 'greet'));
  assert.ok(
    analysis.dependencies.some(
      (dependency) => dependency.kind === 'local' && dependency.resolvedPath === 'src/helper.ts',
    ),
  );
  const graph = await buildProjectGraph(analysis, { projectName: 'worker-fixture' });
  assert.equal(graph.getSummary().metrics.fileCount, 2);
  assert.equal(graph.getSummary().metrics.dependencyEdgeCount, 1);
  assert.deepEqual(graph.findCycles().cycles, []);

  console.log(
    `Electron worker smoke test passed: scan ${scan.id}; analyzed ${analysis.filesAnalyzed} files, ${analysis.symbols.length} symbols, resolved ${analysis.dependencies.length} dependencies, and built ${graph.getSummary().metrics.nodeCount} graph nodes with ${graph.getSummary().metrics.edgeCount} edges.`,
  );
} finally {
  await analysisWorker?.terminate();
  await scanWorker?.terminate();
  await rm(rootPath, { recursive: true, force: true });
}
