import { InMemoryGraphProvider } from '@repolens/core';
import {
  analysisResultSchema,
  graphExportJsonSchema,
  projectSchema,
  scanResultSchema,
  type AnalysisResult,
  type ScanResult,
} from '@repolens/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisManagementService } from './analysis-management.service.js';
import type { ProjectManagementService } from './project-management.service.js';
import { GraphManagementService } from './graph-management.service.js';
import type { ScanManagementService } from './scan-management.service.js';

const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const analysisId = '7d707ca0-312b-4a6f-8950-8df3441d973a';
const scanId = '92370c1b-8755-4057-ae23-0d885ad4d94b';
const timestamp = '2026-11-27T00:00:00.000Z';
const project = projectSchema.parse({
  id: projectId,
  name: 'graph-fixture',
  rootPath: '/fixture/graph-fixture',
  createdAt: timestamp,
  updatedAt: timestamp,
  status: 'registered',
  repositoryType: 'local',
  repositoryIndicators: [],
});
const scan: ScanResult = scanResultSchema.parse({
  id: scanId,
  projectId,
  status: 'completed',
  startedAt: timestamp,
  completedAt: timestamp,
  durationMs: 0,
  directoriesDiscovered: 1,
  filesDiscovered: 2,
  filesProcessed: 2,
  sourceFiles: 2,
  configurationFiles: 0,
  packageManifests: 0,
  documentationFiles: 0,
  assetFiles: 0,
  otherFiles: 0,
  ignoredFiles: 0,
  ignoredDirectories: 0,
  sensitiveEntriesExcluded: 0,
  symlinksSkipped: 0,
  bytesHashed: 0,
  languages: [],
  technologies: [],
  warnings: [],
  files: ['src/index.ts', 'src/helper.ts'].map((relativePath) => ({
    relativePath,
    extension: '.ts',
    sizeBytes: 32,
    modifiedAt: timestamp,
    classification: 'source',
    language: 'TypeScript',
    hashStatus: 'not-attempted',
  })),
  errors: [],
});
const analysis: AnalysisResult = analysisResultSchema.parse({
  analysisId,
  scanId,
  projectId,
  status: 'completed',
  startedAt: timestamp,
  completedAt: timestamp,
  durationMs: 0,
  filesSelected: 2,
  filesAnalyzed: 2,
  filesSkipped: 0,
  analyzedFiles: ['src/index.ts', 'src/helper.ts'],
  symbols: [
    {
      id: 'src/index.ts#module',
      name: 'index.ts',
      kind: 'module',
      location: {
        filePath: 'src/index.ts',
        startLine: 1,
        startColumn: 1,
        endLine: 2,
        endColumn: 1,
      },
      exported: false,
    },
    {
      id: 'src/index.ts#function:greet',
      name: 'greet',
      kind: 'function',
      location: {
        filePath: 'src/index.ts',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 5,
      },
      parentId: 'src/index.ts#module',
      exported: true,
    },
    {
      id: 'src/helper.ts#module',
      name: 'helper.ts',
      kind: 'module',
      location: {
        filePath: 'src/helper.ts',
        startLine: 1,
        startColumn: 1,
        endLine: 2,
        endColumn: 1,
      },
      exported: false,
    },
  ],
  imports: [
    {
      id: 'src/index.ts#import:static:1:1',
      filePath: 'src/index.ts',
      specifier: './helper',
      kind: 'static',
      bindings: [],
      isTypeOnly: false,
      location: {
        filePath: 'src/index.ts',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 5,
      },
    },
    {
      id: 'src/index.ts#import:static:2:1',
      filePath: 'src/index.ts',
      specifier: './missing',
      kind: 'static',
      bindings: [],
      isTypeOnly: false,
      location: {
        filePath: 'src/index.ts',
        startLine: 2,
        startColumn: 1,
        endLine: 2,
        endColumn: 10,
      },
    },
    {
      id: 'src/index.ts#import:static:3:1',
      filePath: 'src/index.ts',
      specifier: 'react',
      kind: 'static',
      bindings: [],
      isTypeOnly: false,
      location: {
        filePath: 'src/index.ts',
        startLine: 3,
        startColumn: 1,
        endLine: 3,
        endColumn: 13,
      },
    },
  ],
  exports: [],
  dependencies: [
    {
      id: 'src/index.ts#import:static:1:1#dependency',
      importId: 'src/index.ts#import:static:1:1',
      fromPath: 'src/index.ts',
      specifier: './helper',
      kind: 'local',
      resolvedPath: 'src/helper.ts',
    },
    {
      id: 'src/index.ts#import:static:2:1#dependency',
      importId: 'src/index.ts#import:static:2:1',
      fromPath: 'src/index.ts',
      specifier: './missing',
      kind: 'unresolved',
      reason: 'No matching scanned path.',
    },
    {
      id: 'src/index.ts#import:static:3:1#dependency',
      importId: 'src/index.ts#import:static:3:1',
      fromPath: 'src/index.ts',
      specifier: 'react',
      kind: 'external-package',
      packageName: 'react',
    },
  ],
  diagnostics: [],
});

function createService(
  projectLookup: () => Promise<typeof project | null> = async () => project,
  currentScan: ScanResult | null = scan,
  currentAnalysis: AnalysisResult | null = analysis,
) {
  const provider = new InMemoryGraphProvider();
  const projects = { getById: vi.fn(projectLookup) } as unknown as ProjectManagementService;
  const scans = {
    getCurrentResult: vi.fn((id: string, requestedScanId: string) =>
      id === projectId && requestedScanId === scanId ? currentScan : null,
    ),
  } as unknown as ScanManagementService;
  const analyses = {
    getLatestResult: vi.fn((id: string) => (id === projectId ? currentAnalysis : null)),
    getCurrentResult: vi.fn((id: string, requestedScanId: string, requestedAnalysisId: string) =>
      id === projectId &&
      currentAnalysis?.scanId === requestedScanId &&
      currentAnalysis.analysisId === requestedAnalysisId
        ? currentAnalysis
        : null,
    ),
  } as unknown as AnalysisManagementService;
  return {
    provider,
    projects,
    scans,
    analyses,
    service: new GraphManagementService(projects, provider, scans, analyses),
  };
}

describe('graph management service', () => {
  it('validates scan and analysis, publishes the real graph, reports progress and summary, and serves graph data', async () => {
    const { provider, projects, service } = createService();
    const progress: string[] = [];
    const report = await service.generate(projectId, scanId, analysisId, (event) => {
      progress.push(event.phase);
    });

    expect(report).toMatchObject({
      projectId,
      analysisId,
      analysisStatus: 'completed',
      status: 'completed',
      totalNodes: expect.any(Number),
      totalEdges: expect.any(Number),
      resolvedDependencies: 1,
      unresolvedDependencies: 1,
      externalDependencies: 1,
      cycleCount: 0,
      warnings: expect.arrayContaining([
        expect.stringContaining('unresolved import'),
        expect.stringContaining('external package import'),
      ]),
    });
    expect(report.nodesByType['file']).toBe(2);
    expect(progress).toContain('preparing');
    expect(progress).toContain('nodes');
    expect(progress).toContain('edges');
    expect(progress).toContain('metrics');

    const graphSummary = await service.summary(projectId);
    expect(graphSummary).toMatchObject({
      projectId,
      analysisId,
      scanId,
      metrics: { fileCount: 2, dependencyEdgeCount: 1, unresolvedDependencyCount: 1 },
    });
    await expect(
      service.query(projectId, { types: ['function'], exported: true }),
    ).resolves.toMatchObject({
      total: 1,
      nodes: [expect.objectContaining({ name: 'greet', type: 'function' })],
    });
    await expect(
      service.dependencies(projectId, { relativePath: 'src/index.ts', direction: 'dependencies' }),
    ).resolves.toMatchObject({ files: [{ relativePath: 'src/helper.ts', distance: 1 }] });
    await expect(
      service.shortestPath(projectId, { fromPath: 'src/index.ts', toPath: 'src/helper.ts' }),
    ).resolves.toMatchObject({ filePaths: ['src/index.ts', 'src/helper.ts'], hops: 1 });
    await expect(service.cycles(projectId, {})).resolves.toMatchObject({
      cycles: [],
      truncated: false,
    });

    const json = await service.exportJson(projectId);
    expect(graphExportJsonSchema.parse(json)).toBe(json);
    expect(JSON.parse(json ?? 'null')).toMatchObject({ schemaVersion: '1.0.0', projectId });
    await expect(service.dispose(projectId)).resolves.toEqual({ disposed: true });
    await expect(service.summary(projectId)).resolves.toBeNull();
    expect(provider.get(projectId)).toBeNull();
    expect(projects.getById).toHaveBeenCalled();
  });

  it('rejects graph reads after the project registration disappears', async () => {
    const { service } = createService(async () => null);
    await expect(service.summary(projectId)).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });

  it('supports partial analyses while keeping skipped files and unresolved imports explicit', async () => {
    const partialAnalysis = analysisResultSchema.parse({
      ...analysis,
      status: 'partial',
      filesSelected: 3,
      filesAnalyzed: 2,
      filesSkipped: 1,
    });
    const { service } = createService(async () => project, scan, partialAnalysis);

    const report = await service.generate(projectId, scanId, analysisId);
    expect(report).toMatchObject({
      status: 'partial',
      analysisStatus: 'partial',
      resolvedDependencies: 1,
      unresolvedDependencies: 1,
      externalDependencies: 1,
      warnings: expect.arrayContaining([
        expect.stringContaining('partial'),
        expect.stringContaining('could not be analyzed'),
      ]),
    });
  });

  it('requires a completed scan and rejects stale, empty, or out-of-inventory analyses', async () => {
    const cancelledScan = scanResultSchema.parse({ ...scan, status: 'cancelled' });
    const incompleteScan = createService(async () => project, cancelledScan, analysis);
    await expect(
      incompleteScan.service.generate(projectId, scanId, analysisId),
    ).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'SCAN_NOT_COMPLETED',
    });

    const staleAnalysis = analysisResultSchema.parse({
      ...analysis,
      analysisId: '8d707ca0-312b-4a6f-8950-8df3441d973a',
    });
    const staleService = createService(async () => project, scan, staleAnalysis);
    await expect(
      staleService.service.generate(projectId, scanId, analysisId),
    ).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'ANALYSIS_STALE',
    });

    const emptyAnalysis = analysisResultSchema.parse({
      ...analysis,
      status: 'partial',
      filesSelected: 2,
      filesAnalyzed: 0,
      filesSkipped: 2,
      analyzedFiles: [],
      symbols: [],
      imports: [],
      exports: [],
      dependencies: [],
    });
    const emptyService = createService(async () => project, scan, emptyAnalysis);
    await expect(
      emptyService.service.generate(projectId, scanId, analysisId),
    ).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'ANALYSIS_EMPTY',
      totalNodes: 0,
      totalEdges: 0,
    });

    const outOfInventoryAnalysis = analysisResultSchema.parse({
      ...emptyAnalysis,
      filesAnalyzed: 1,
      filesSkipped: 1,
      analyzedFiles: ['src/unscanned.ts'],
    });
    const invalidService = createService(async () => project, scan, outOfInventoryAnalysis);
    await expect(
      invalidService.service.generate(projectId, scanId, analysisId),
    ).resolves.toMatchObject({
      status: 'failed',
      failureCode: 'ANALYSIS_INVALID',
    });
  });

  it('reports failed and cancelled analyses without publishing a graph', async () => {
    for (const status of ['failed', 'cancelled'] as const) {
      const unsuccessfulAnalysis = analysisResultSchema.parse({ ...analysis, status });
      const { provider, service } = createService(async () => project, scan, unsuccessfulAnalysis);
      const report = await service.generate(projectId, scanId, analysisId);

      expect(report).toMatchObject({
        status: 'failed',
        analysisId,
        analysisStatus: status,
        failureCode: 'ANALYSIS_FAILED',
        totalNodes: 0,
        totalEdges: 0,
      });
      expect(provider.get(projectId)).toBeNull();
    }
  });

  it('does not publish if the current scan changes during graph construction', async () => {
    const { provider, scans, service } = createService();
    vi.mocked(scans.getCurrentResult)
      .mockImplementationOnce(() => scan)
      .mockImplementation(() => null);

    const report = await service.generate(projectId, scanId, analysisId);
    expect(report).toMatchObject({
      status: 'failed',
      failureCode: 'GRAPH_SUPERSEDED',
      errorMessage: expect.stringContaining('changed while'),
    });
    expect(provider.get(projectId)).toBeNull();
  });

  it('returns a clear failed report and publishes no empty graph when scan or analysis is missing', async () => {
    const noScan = createService(async () => project, null, analysis);
    const scanReport = await noScan.service.generate(projectId, scanId, analysisId);
    expect(scanReport).toMatchObject({ status: 'failed', failureCode: 'SCAN_REQUIRED' });
    expect(noScan.provider.get(projectId)).toBeNull();

    const noAnalysis = createService(async () => project, scan, null);
    const analysisReport = await noAnalysis.service.generate(projectId, scanId, analysisId);
    expect(analysisReport).toMatchObject({ status: 'failed', failureCode: 'ANALYSIS_REQUIRED' });
    expect(noAnalysis.provider.get(projectId)).toBeNull();
  });
});
