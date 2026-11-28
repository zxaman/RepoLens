import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SCAN_CONFIG } from '@repolens/shared';
import { InMemoryGraphProvider } from '@repolens/core';
import { createRepoLensAPI } from '../apps/desktop/dist/electron/ipc/bridge.js';
import { registerIpcHandlers } from '../apps/desktop/dist/electron/ipc/register-ipc.js';
import { AnalysisManagementService } from '../apps/desktop/dist/electron/services/analysis-management.service.js';
import { GraphManagementService } from '../apps/desktop/dist/electron/services/graph-management.service.js';
import { AppSettingsService } from '../apps/desktop/dist/electron/services/app-settings.service.js';
import { JsonProjectRepository } from '../apps/desktop/dist/electron/services/json-project-repository.js';
import { JsonScanHistoryRepository } from '../apps/desktop/dist/electron/services/json-scan-history-repository.js';
import { JsonSettingsRepository } from '../apps/desktop/dist/electron/services/json-settings-repository.js';
import { ProjectManagementService } from '../apps/desktop/dist/electron/services/project-management.service.js';
import { ScanManagementService } from '../apps/desktop/dist/electron/services/scan-management.service.js';

const temporaryRoot = await mkdtemp(join(tmpdir(), 'repolens-desktop-workflow-'));
const userDataPath = join(temporaryRoot, 'user-data');
const projectPath = join(temporaryRoot, 'sample-project');
const cancellationProjectPath = join(temporaryRoot, 'cancellation-project');
const registryPath = join(userDataPath, 'project-registry.json');
const settingsPath = join(userDataPath, 'settings.json');
const historyPath = join(userDataPath, 'scan-history.json');
const sourceFiles = [
  join(projectPath, 'src', 'index.ts'),
  join(projectPath, 'src', 'helper.ts'),
  join(projectPath, 'src', 'cycle-a.ts'),
  join(projectPath, 'src', 'cycle-b.ts'),
];
let selectedPath = projectPath;

function createProjectServices() {
  const projectRepository = new JsonProjectRepository(registryPath);
  const settingsRepository = new JsonSettingsRepository(settingsPath);
  const settings = new AppSettingsService(settingsRepository, projectRepository);
  const projects = new ProjectManagementService(projectRepository, settings, {
    pickDirectory: async () => selectedPath,
  });
  return { projectRepository, settingsRepository, settings, projects };
}

function createBridge(services) {
  const handlers = new Map();
  const subscribers = new Map();
  const rendererUrl = 'http://127.0.0.1:4200/';
  const sender = {
    mainFrame: { url: rendererUrl },
    isDestroyed: () => false,
    send(channel, payload) {
      for (const listener of subscribers.get(channel) ?? []) {
        listener(payload);
      }
    },
  };
  const event = { sender, senderFrame: { url: rendererUrl } };

  registerIpcHandlers(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { name: 'RepoLens', version: '0.2.0', platform: process.platform },
    () => undefined,
    services.projects,
    services.settings,
    services.scans,
    services.analyses,
    services.graphs,
  );

  return createRepoLensAPI(
    {
      invoke: async (channel, payload) => {
        const handler = handlers.get(channel);
        if (handler === undefined) {
          throw new Error(`No IPC handler is registered for ${channel}.`);
        }
        return payload === undefined ? handler(event) : handler(event, payload);
      },
    },
    {
      subscribe: (channel, listener) => {
        const listeners = subscribers.get(channel) ?? new Set();
        listeners.add(listener);
        subscribers.set(channel, listeners);
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) {
            subscribers.delete(channel);
          }
        };
      },
    },
  );
}

function unwrap(result) {
  assert.equal(result.ok, true, result.ok ? undefined : result.error.message);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readSourceHashes(paths) {
  return Promise.all(paths.map(async (path) => hash(await readFile(path))));
}

try {
  await mkdir(join(projectPath, 'src'), { recursive: true });
  await writeFile(
    sourceFiles[0],
    "import { helper } from './helper';\nexport const greet = (name: string) => helper(name);\n",
    'utf8',
  );
  await writeFile(
    sourceFiles[1],
    'export const helper = (value: string) => `Hello ${value}`;\n',
    'utf8',
  );
  await writeFile(
    sourceFiles[2],
    "import { cycleB } from './cycle-b';\nexport const cycleA = () => cycleB;\n",
    'utf8',
  );
  await writeFile(
    sourceFiles[3],
    "import { cycleA } from './cycle-a';\nexport const cycleB = () => cycleA;\n",
    'utf8',
  );
  await writeFile(join(projectPath, 'README.md'), '# Local fixture\n', 'utf8');
  const sourceHashesBefore = await readSourceHashes(sourceFiles);

  const services = createProjectServices();
  const initialScans = new ScanManagementService(
    services.projects,
    new JsonScanHistoryRepository(historyPath),
  );
  const initialGraphProvider = new InMemoryGraphProvider();
  const initialAnalyses = new AnalysisManagementService(
    services.projects,
    initialScans,
    undefined,
    initialGraphProvider,
  );
  const initialGraphs = new GraphManagementService(
    services.projects,
    initialGraphProvider,
    initialScans,
    initialAnalyses,
  );
  const initialBridge = createBridge({
    ...services,
    scans: initialScans,
    analyses: initialAnalyses,
    graphs: initialGraphs,
  });
  const selection = unwrap(await initialBridge.projects.importFolder());
  assert.equal(selection.kind, 'selected', 'an ordinary folder should be selectable');
  if (selection.kind !== 'selected') {
    throw new Error('The project folder was not selected.');
  }
  assert.equal(selection.preview.name, 'sample-project');
  assert.deepEqual(selection.preview.repositoryIndicators, []);
  assert.equal(selection.preview.repositoryType, 'local');

  const registration = unwrap(
    await initialBridge.projects.confirmImport(selection.preview.selectionId),
  );
  assert.equal(registration.kind, 'created');
  if (registration.kind !== 'created') {
    throw new Error('The project folder was not registered.');
  }
  const project = registration.project;
  assert.equal(project.rootPath, projectPath);
  assert.match(project.id, /^[0-9a-f-]{36}$/i);
  const openedProject = unwrap(await initialBridge.projects.setActive(project.id));
  assert.ok(openedProject.lastOpenedAt);

  // Recreate repositories and services to exercise persisted registration and recent-project state.
  const restarted = createProjectServices();
  const persistedProjects = await restarted.projects.list();
  assert.equal(persistedProjects.length, 1);
  assert.equal(persistedProjects[0]?.id, project.id);
  assert.equal(persistedProjects[0]?.name, 'sample-project');
  assert.equal(persistedProjects[0]?.lastOpenedAt, openedProject.lastOpenedAt);
  assert.equal((await restarted.projects.getActive())?.id, project.id);

  const history = new JsonScanHistoryRepository(historyPath);
  const scans = new ScanManagementService(restarted.projects, history);
  const graphProvider = new InMemoryGraphProvider();
  const analyses = new AnalysisManagementService(
    restarted.projects,
    scans,
    undefined,
    graphProvider,
  );
  const graphs = new GraphManagementService(restarted.projects, graphProvider, scans, analyses);
  const bridge = createBridge({ ...restarted, scans, analyses, graphs });
  const scanProgress = [];
  const unsubscribeScanProgress = bridge.scans.onProgress((progress) => {
    scanProgress.push(progress.phase);
  });
  const scan = unwrap(await bridge.scans.start(project.id, DEFAULT_SCAN_CONFIG));
  unsubscribeScanProgress();
  assert.equal(scan.status, 'completed');
  assert.equal(scan.filesDiscovered, 5);
  assert.equal(scan.sourceFiles, 4);
  assert.equal(scan.ignoredFiles, 0);
  assert.ok(scan.directoriesDiscovered >= 1);
  assert.ok(scan.durationMs >= 0);
  assert.deepEqual(scan.languages.map((language) => language.name).sort(), [
    'Markdown',
    'TypeScript',
  ]);
  assert.ok(scanProgress.includes('initializing'));
  assert.ok(scanProgress.includes('finalizing'));
  assert.equal(
    (await new JsonScanHistoryRepository(historyPath).getLatest(project.id))?.id,
    scan.id,
  );

  const analysisProgress = [];
  const graphProgress = [];
  const unsubscribeAnalysisProgress = bridge.analysis.onProgress((progress) => {
    analysisProgress.push(progress.phase);
  });
  const unsubscribeGraphProgress = bridge.graphs.onProgress((progress) => {
    graphProgress.push(progress.phase);
  });
  const analysis = unwrap(await bridge.analysis.start(project.id, scan.id));
  unsubscribeAnalysisProgress();
  assert.equal(analysis.status, 'completed');
  assert.equal(analysis.filesAnalyzed, 4);
  assert.equal(analysis.analyzedFiles.length, 4);
  assert.ok(analysis.symbols.some((symbol) => symbol.name === 'greet'));
  assert.ok(analysis.imports.some((item) => item.specifier === './helper'));
  assert.ok(analysis.exports.some((item) => item.name === 'greet'));
  assert.ok(
    analysis.dependencies.some(
      (dependency) => dependency.kind === 'local' && dependency.resolvedPath === 'src/helper.ts',
    ),
  );
  assert.ok(
    analysis.dependencies.some((dependency) => dependency.resolvedPath === 'src/cycle-b.ts'),
  );
  assert.ok(
    analysis.dependencies.some((dependency) => dependency.resolvedPath === 'src/cycle-a.ts'),
  );
  assert.ok(analysisProgress.includes('initializing'));
  assert.ok(analysisProgress.includes('finalizing'));
  assert.equal(unwrap(await bridge.graphs.summary(project.id)), null);

  const generationReport = unwrap(
    await bridge.graphs.generate(project.id, scan.id, analysis.analysisId),
  );
  unsubscribeGraphProgress();
  assert.equal(generationReport.status, 'completed');
  assert.equal(generationReport.resolvedDependencies, 3);
  assert.equal(generationReport.cycleCount, 1);
  assert.ok(graphProgress.includes('preparing'));
  assert.ok(graphProgress.includes('nodes'));
  assert.ok(graphProgress.includes('edges'));
  assert.ok(graphProgress.includes('metrics'));

  const graphSummary = unwrap(await bridge.graphs.summary(project.id));
  assert.equal(graphSummary.analysisId, analysis.analysisId);
  assert.equal(graphSummary.scanId, scan.id);
  assert.equal(graphSummary.metrics.fileCount, 4);
  assert.equal(graphSummary.metrics.dependencyEdgeCount, 3);
  assert.ok(graphSummary.metrics.symbolCount >= 2);
  const graphFunctions = unwrap(
    await bridge.graphs.query(project.id, { types: ['function'], name: 'greet' }),
  );
  assert.ok(graphFunctions.nodes.some((node) => node.name === 'greet'));
  assert.ok(
    graphFunctions.edges.every(
      (edge) =>
        graphFunctions.nodes.some((node) => node.id === edge.sourceId) &&
        graphFunctions.nodes.some((node) => node.id === edge.targetId),
    ),
  );
  const projectNeighborhood = unwrap(
    await bridge.graphs.neighborhood(project.id, {
      nodeId: `project:${project.id}`,
      direction: 'both',
      depth: 2,
      limit: 100,
    }),
  );
  assert.equal(projectNeighborhood.anchorNodeId, `project:${project.id}`);
  assert.ok(projectNeighborhood.nodes.length <= 100);
  const projectNeighborhoodNodeIds = new Set(projectNeighborhood.nodes.map((node) => node.id));
  assert.ok(
    projectNeighborhood.edges.every(
      (edge) =>
        projectNeighborhoodNodeIds.has(edge.sourceId) &&
        projectNeighborhoodNodeIds.has(edge.targetId),
    ),
  );
  const dependencyNeighborhood = unwrap(
    await bridge.graphs.neighborhood(project.id, {
      nodeId: 'file:src/index.ts',
      direction: 'outgoing',
      edgeTypes: ['imports'],
      depth: 1,
      limit: 50,
    }),
  );
  assert.ok(
    dependencyNeighborhood.edges.some(
      (edge) => edge.type === 'imports' && edge.specifier === './helper',
    ),
  );
  const graphDependencies = unwrap(
    await bridge.graphs.dependencies(project.id, {
      relativePath: 'src/index.ts',
      direction: 'dependencies',
      depth: 1,
    }),
  );
  assert.deepEqual(graphDependencies.files, [{ relativePath: 'src/helper.ts', distance: 1 }]);
  assert.deepEqual(
    unwrap(
      await bridge.graphs.shortestPath(project.id, {
        fromPath: 'src/index.ts',
        toPath: 'src/helper.ts',
      }),
    ).filePaths,
    ['src/index.ts', 'src/helper.ts'],
  );
  const graphCycles = unwrap(await bridge.graphs.cycles(project.id));
  assert.deepEqual(graphCycles.cycles, [['src/cycle-a.ts', 'src/cycle-b.ts']]);
  const graphJson = unwrap(await bridge.graphs.exportJson(project.id));
  const graphExport = JSON.parse(graphJson);
  assert.equal(graphExport.schemaVersion, '1.0.0');
  assert.equal(graphExport.analysisId, analysis.analysisId);
  assert.equal(
    graphExport.nodes.some((node) => node.type === 'file'),
    true,
  );
  assert.equal(graphJson.includes('Graphology'), false);
  assert.equal(generationReport.totalNodes, graphExport.nodes.length);
  assert.equal(generationReport.totalEdges, graphExport.edges.length);
  assert.equal(generationReport.cycleCount, graphCycles.cycles.length);

  // Cancellation is exercised through the same scan service and real worker used by Electron.
  await mkdir(cancellationProjectPath);
  await Promise.all(
    Array.from({ length: 500 }, (_, index) =>
      writeFile(join(cancellationProjectPath, `file-${index}.txt`), `fixture ${index}\n`, 'utf8'),
    ),
  );
  selectedPath = cancellationProjectPath;
  const cancellationSelection = unwrap(await bridge.projects.importFolder());
  assert.equal(cancellationSelection.kind, 'selected');
  if (cancellationSelection.kind !== 'selected') {
    throw new Error('The cancellation fixture folder was not selected.');
  }
  const cancellationRegistration = unwrap(
    await bridge.projects.confirmImport(cancellationSelection.preview.selectionId),
  );
  assert.equal(cancellationRegistration.kind, 'created');
  if (cancellationRegistration.kind !== 'created') {
    throw new Error('The cancellation fixture folder was not registered.');
  }

  let cancellationRequest = null;
  const unsubscribeCancellationProgress = bridge.scans.onProgress((progress) => {
    if (progress.phase === 'initializing' && cancellationRequest === null) {
      cancellationRequest = bridge.scans.cancel(progress.scanId);
    }
  });
  const cancelledScan = unwrap(
    await bridge.scans.start(cancellationRegistration.project.id, DEFAULT_SCAN_CONFIG),
  );
  unsubscribeCancellationProgress();
  assert.notEqual(cancellationRequest, null, 'the active scan should expose a cancelable ID');
  unwrap(await cancellationRequest);
  assert.equal(cancelledScan.status, 'cancelled');

  const sourceHashesAfter = await readSourceHashes(sourceFiles);
  assert.deepEqual(sourceHashesAfter, sourceHashesBefore, 'RepoLens must not modify project files');

  // The IPC removal path removes only RepoLens registration/history, never the original folder.
  unwrap(await bridge.projects.remove(project.id));
  assert.equal(
    graphProvider.get(project.id),
    null,
    'project removal should dispose its in-memory graph',
  );
  assert.equal(await restarted.projects.getById(project.id), null);
  assert.equal(await new JsonScanHistoryRepository(historyPath).getLatest(project.id), null);
  assert.equal((await readFile(sourceFiles[0], 'utf8')).startsWith('import '), true);

  console.log(
    `Desktop workflow integration passed: import/restart, ${scan.filesDiscovered} real files scanned, ${analysis.symbols.length} symbols, graph ${generationReport.totalNodes} nodes/${generationReport.totalEdges} edges/${generationReport.cycleCount} cycle(s) from the real circular-dependency fixture, local dependency resolution, scan cancellation, history persistence, and source-file integrity.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
