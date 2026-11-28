import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import cytoscape from 'cytoscape';
import { BehaviorSubject } from 'rxjs';
import {
  analysisResultSchema,
  DEFAULT_APP_SETTINGS,
  graphCycleReportSchema,
  graphGenerationReportSchema,
  graphNeighborhoodResultSchema,
  graphNodeQueryResultSchema,
  graphSummarySchema,
  scanHistoryItemSchema,
  scanResultSchema,
  type AnalysisProgress,
  type AnalysisResult,
  type GraphBuildProgress,
  type Project,
  type ScanHistoryItem,
  type ScanProgress,
  type ScanResult,
} from '@repolens/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../../settings/settings.service';
import { AnalysisService } from '../services/analysis.service';
import { ConfirmRemoveDialogComponent } from '../components/confirm-remove-dialog.component';
import {
  CYTOSCAPE_FACTORY,
  GraphVisualizationComponent,
} from '../components/graph-visualization.component';
import { GraphService } from '../services/graph.service';
import { ProjectService } from '../services/project.service';
import { ScanService } from '../services/scan.service';
import { ProjectDetailsPageComponent } from './project-details-page.component';

const project: Project = {
  id: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
  name: 'fixture-project',
  rootPath: '/fixture/scanner/basic',
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
  status: 'registered',
  repositoryType: 'local',
  repositoryIndicators: [],
};

const summary: ScanHistoryItem = scanHistoryItemSchema.parse({
  id: '92370c1b-8755-4057-ae23-0d885ad4d94b',
  projectId: project.id,
  status: 'completed',
  startedAt: '2026-11-27T00:00:00.000Z',
  completedAt: '2026-11-27T00:00:01.000Z',
  durationMs: 1_000,
  directoriesDiscovered: 2,
  filesDiscovered: 1,
  filesProcessed: 1,
  sourceFiles: 1,
  configurationFiles: 0,
  packageManifests: 0,
  documentationFiles: 0,
  assetFiles: 0,
  otherFiles: 0,
  ignoredFiles: 0,
  ignoredDirectories: 0,
  sensitiveEntriesExcluded: 0,
  symlinksSkipped: 0,
  bytesHashed: 8,
  languages: [{ name: 'TypeScript', fileCount: 1, totalBytes: 8 }],
  technologies: [
    {
      name: 'React',
      category: 'frontend',
      certainty: 'confirmed',
      confidence: 'high',
      evidence: ['package.json: react'],
    },
  ],
  warnings: [],
});

const result: ScanResult = scanResultSchema.parse({
  ...summary,
  files: [
    {
      relativePath: 'src/index.ts',
      extension: '.ts',
      sizeBytes: 8,
      modifiedAt: '2026-11-27T00:00:00.000Z',
      classification: 'source',
      language: 'TypeScript',
      hashStatus: 'hashed',
      sha256: 'a'.repeat(64),
    },
  ],
  errors: [],
});

const moduleSymbolId = 'src/index.ts#module';
const renderSymbolId = 'src/index.ts#symbol:function:3:14';
const importId = 'src/index.ts#import:static:1:1';
const analysisResult: AnalysisResult = analysisResultSchema.parse({
  analysisId: '7d707ca0-312b-4a6f-8950-8df3441d973a',
  scanId: result.id,
  projectId: project.id,
  status: 'partial',
  startedAt: '2026-11-27T00:00:00.000Z',
  completedAt: '2026-11-27T00:00:01.000Z',
  durationMs: 1_000,
  filesSelected: 1,
  filesAnalyzed: 1,
  filesSkipped: 0,
  analyzedFiles: ['src/index.ts'],
  symbols: [
    {
      id: moduleSymbolId,
      name: 'index.ts',
      kind: 'module',
      location: {
        filePath: 'src/index.ts',
        startLine: 1,
        startColumn: 1,
        endLine: 5,
        endColumn: 1,
      },
      exported: false,
    },
    {
      id: renderSymbolId,
      name: 'renderPage',
      kind: 'function',
      location: {
        filePath: 'src/index.ts',
        startLine: 3,
        startColumn: 14,
        endLine: 3,
        endColumn: 24,
      },
      parentId: moduleSymbolId,
      exported: true,
    },
  ],
  imports: [
    {
      id: importId,
      filePath: 'src/index.ts',
      specifier: './util',
      kind: 'static',
      bindings: [],
      isTypeOnly: false,
      location: {
        filePath: 'src/index.ts',
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 20,
      },
    },
  ],
  exports: [
    {
      id: 'src/index.ts#export:named:3:14',
      filePath: 'src/index.ts',
      name: 'renderPage',
      kind: 'named',
      localName: 'renderPage',
      symbolIds: [renderSymbolId],
      isTypeOnly: false,
      location: {
        filePath: 'src/index.ts',
        startLine: 3,
        startColumn: 14,
        endLine: 3,
        endColumn: 24,
      },
    },
  ],
  dependencies: [
    {
      id: `${importId}#dependency`,
      importId,
      fromPath: 'src/index.ts',
      specifier: './util',
      kind: 'local',
      resolvedPath: 'src/util.ts',
    },
  ],
  diagnostics: [
    {
      code: 'UNRESOLVED_DEPENDENCY',
      severity: 'warning',
      message: 'A local import was not included in this scan result.',
      filePath: 'src/index.ts',
      line: 4,
      column: 1,
    },
  ],
});

const graphReport = graphGenerationReportSchema.parse({
  projectId: project.id,
  analysisId: analysisResult.analysisId,
  analysisStatus: 'partial',
  status: 'partial',
  totalNodes: 2,
  totalEdges: 1,
  nodesByType: { project: 1, file: 1 },
  edgesByType: { contains: 1 },
  resolvedDependencies: 1,
  unresolvedDependencies: 0,
  externalDependencies: 0,
  cycleCount: 0,
  cyclesTruncated: false,
  warnings: ['Static analysis was partial.'],
});
const graphSummary = graphSummarySchema.parse({
  projectId: project.id,
  analysisId: analysisResult.analysisId,
  scanId: result.id,
  analysisStatus: 'partial',
  metrics: {
    nodeCount: 2,
    edgeCount: 1,
    nodesByType: [
      { type: 'project', count: 1 },
      { type: 'file', count: 1 },
    ],
    edgesByType: [{ type: 'contains', count: 1 }],
    fileCount: 1,
    folderCount: 0,
    symbolCount: 0,
    analysisFilesAnalyzed: 1,
    dependencyEdgeCount: 0,
    uniqueDependencyPairCount: 0,
    externalDependencyCount: 0,
    unresolvedDependencyCount: 0,
    isolatedFileCount: 1,
    averageDependenciesPerFile: 0,
    maxDependenciesPerFile: 0,
    stronglyConnectedComponentCount: 1,
    cyclicComponentCount: 0,
    selfLoopCount: 0,
  },
});
const graphNodes = graphNodeQueryResultSchema.parse({
  nodes: [
    {
      id: 'file:src/index.ts',
      projectId: project.id,
      type: 'file',
      name: 'index.ts',
      relativePath: 'src/index.ts',
    },
    {
      id: `project:${project.id}`,
      projectId: project.id,
      type: 'project',
      name: 'fixture-project',
    },
  ],
  edges: [
    {
      id: 'edge:contains:project:file',
      projectId: project.id,
      type: 'contains',
      sourceId: `project:${project.id}`,
      targetId: 'file:src/index.ts',
    },
  ],
  edgesTruncated: false,
  total: 2,
  offset: 0,
  limit: 100,
});
const graphSecondSearchPage = graphNodeQueryResultSchema.parse({
  nodes: [
    {
      id: 'symbol:src/app.component.ts#class:AppComponent',
      projectId: project.id,
      type: 'component',
      name: 'AppComponent',
      filePath: 'src/app.component.ts',
      symbolId: 'src/app.component.ts#class:AppComponent',
      symbolKind: 'class',
      location: {
        filePath: 'src/app.component.ts',
        startLine: 4,
        startColumn: 1,
        endLine: 4,
        endColumn: 29,
      },
    },
  ],
  edges: [],
  edgesTruncated: false,
  total: 3,
  offset: 2,
  limit: 100,
});
const graphNeighborhood = graphNeighborhoodResultSchema.parse({
  anchorNodeId: `project:${project.id}`,
  depth: 2,
  limit: 180,
  nodes: graphNodes.nodes,
  edges: graphNodes.edges,
  nodesTruncated: false,
  edgesTruncated: false,
});
const fileNeighborhood = graphNeighborhoodResultSchema.parse({
  anchorNodeId: 'file:src/index.ts',
  depth: 1,
  limit: 250,
  nodes: graphNodes.nodes,
  edges: graphNodes.edges,
  nodesTruncated: false,
  edgesTruncated: false,
});
const graphCycles = graphCycleReportSchema.parse({
  projectId: project.id,
  analysisId: analysisResult.analysisId,
  stronglyConnectedComponentCount: 1,
  cyclicComponents: [],
  cycles: [],
  maxCycles: 100,
  truncated: false,
  exploredTransitions: 0,
});

describe('ProjectDetailsPageComponent scan and analysis UI', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let scanProgressListener: ((progress: ScanProgress) => void) | null;
  let analysisProgressListener: ((progress: AnalysisProgress) => void) | null;
  let graphProgressListener: ((progress: GraphBuildProgress) => void) | null;
  let scanService: {
    start: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    getHistory: ReturnType<typeof vi.fn>;
    getLatest: ReturnType<typeof vi.fn>;
    onProgress: ReturnType<typeof vi.fn>;
  };
  let analysisService: {
    start: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
    onProgress: ReturnType<typeof vi.fn>;
  };
  let graphService: {
    generate: ReturnType<typeof vi.fn>;
    summary: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    neighborhood: ReturnType<typeof vi.fn>;
    cycles: ReturnType<typeof vi.fn>;
    onProgress: ReturnType<typeof vi.fn>;
  };
  let projectService: {
    getProject: ReturnType<typeof vi.fn>;
    openProject: ReturnType<typeof vi.fn>;
    refreshProject: ReturnType<typeof vi.fn>;
    removeProject: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    params = new BehaviorSubject(convertToParamMap({ projectId: project.id }));
    scanProgressListener = null;
    analysisProgressListener = null;
    graphProgressListener = null;
    scanService = {
      start: vi.fn(async () => result),
      cancel: vi.fn(async () => undefined),
      getHistory: vi.fn(async () => [] as readonly ScanHistoryItem[]),
      getLatest: vi.fn(async () => null as ScanHistoryItem | null),
      onProgress: vi.fn((callback: (progress: ScanProgress) => void) => {
        scanProgressListener = callback;
        return vi.fn();
      }),
    };
    analysisService = {
      start: vi.fn(async () => analysisResult),
      cancel: vi.fn(async () => undefined),
      onProgress: vi.fn((callback: (progress: AnalysisProgress) => void) => {
        analysisProgressListener = callback;
        return vi.fn();
      }),
    };
    graphService = {
      generate: vi.fn(async () => graphReport),
      summary: vi.fn(async () => graphSummary),
      query: vi.fn(async () => graphNodes),
      neighborhood: vi.fn(async () => graphNeighborhood),
      cycles: vi.fn(async () => graphCycles),
      onProgress: vi.fn((callback: (progress: GraphBuildProgress) => void) => {
        graphProgressListener = callback;
        return vi.fn();
      }),
    };
    projectService = {
      getProject: vi.fn(async () => project),
      openProject: vi.fn(async () => project),
      refreshProject: vi.fn(async () => project),
      removeProject: vi.fn(async () => undefined),
    };

    await TestBed.configureTestingModule({
      imports: [ProjectDetailsPageComponent],
      providers: [
        { provide: ProjectService, useValue: projectService },
        { provide: ScanService, useValue: scanService },
        { provide: AnalysisService, useValue: analysisService },
        { provide: GraphService, useValue: graphService },
        {
          provide: CYTOSCAPE_FACTORY,
          useValue: (options: cytoscape.CytoscapeOptions) => {
            const headlessOptions = { ...options };
            delete headlessOptions.container;
            return cytoscape({ ...headlessOptions, headless: true });
          },
        },
        {
          provide: SettingsService,
          useValue: { load: async () => ({ ...DEFAULT_APP_SETTINGS }) },
        },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
      ],
    })
      .overrideComponent(ProjectDetailsPageComponent, {
        set: {
          imports: [DatePipe, ConfirmRemoveDialogComponent, GraphVisualizationComponent],
        },
      })
      .compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows scan results, starts actual static analysis, and browses symbols/imports/exports/dependencies/diagnostics', async () => {
    const fixture = TestBed.createComponent(ProjectDetailsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.textContent).toContain('Repository scan');
    expect(page.textContent).toContain('Configure scan exclusions');
    expect(page.textContent).toContain('Not scanned yet');

    const component = fixture.componentInstance;
    component.scanningProjectId.set(project.id);
    component.scanning.set(true);
    scanProgressListener?.({
      scanId: result.id,
      projectId: project.id,
      phase: 'walking',
      filesDiscovered: 2,
      filesProcessed: 0,
      directoriesProcessed: 1,
      totalBytesProcessed: 0,
    });
    fixture.detectChanges();
    expect(page.textContent).toContain('Discovering project files');
    component.scanning.set(false);
    component.scanningProjectId.set(null);

    await component.startScan();
    fixture.detectChanges();

    expect(scanService.start).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({
        includeSensitiveFiles: false,
        acknowledgeSensitiveFileRisk: false,
      }),
    );
    expect(page.textContent).toContain('Scan completed');
    expect(page.textContent).toContain('files discovered');
    expect(page.textContent).toContain('directories');
    expect(page.textContent).toContain('ignored files');
    expect(page.textContent).toContain('scan duration');
    expect(page.textContent).toContain('React');
    expect(page.textContent).toContain('src/index.ts');
    expect(page.textContent).toContain('aaaaaaaaaaaaaaaa…');

    await component.startAnalysis();
    fixture.detectChanges();
    expect(analysisService.start).toHaveBeenCalledWith(project.id, result.id);
    expect(page.textContent).toContain('TypeScript and JavaScript analysis');
    expect(page.textContent).toContain('renderPage');
    expect(page.textContent).toContain('./util');
    expect(page.textContent).toContain('Dependencies');
    expect(page.textContent).toContain('UNRESOLVED_DEPENDENCY');
    expect(page.textContent).toContain('2');
    expect(analysisProgressListener).not.toBeNull();

    const generation = component.generateGraph();
    graphProgressListener?.({
      analysisId: analysisResult.analysisId,
      scanId: result.id,
      projectId: project.id,
      phase: 'nodes',
      processed: 1,
      total: 2,
      percentage: 50,
    });
    fixture.detectChanges();
    expect(page.textContent).toContain('Building graph nodes');
    await generation;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(graphService.generate).toHaveBeenCalledWith(
      project.id,
      result.id,
      analysisResult.analysisId,
    );
    expect(graphService.summary).toHaveBeenCalledWith(project.id);
    expect(graphService.query).not.toHaveBeenCalled();
    expect(graphService.neighborhood).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({
        nodeId: `project:${project.id}`,
        depth: 2,
        direction: 'both',
      }),
    );
    expect(page.textContent).toContain('Dependency graph');
    expect(page.textContent).toContain('graph nodes');
    expect(page.textContent).toContain('Architecture Explorer');
    expect(page.textContent).toContain('2 nodes and 1 relationships loaded for this view');
    expect(page.querySelector('.graph-canvas')).not.toBeNull();
    expect(page.textContent).toContain('Cycle paths (0 found)');

    const explorer = fixture.debugElement.query(By.directive(GraphVisualizationComponent))
      .componentInstance as GraphVisualizationComponent;
    explorer.searchName.set('AppComponent');
    explorer.toggleNodeType('service', false);
    graphService.query
      .mockResolvedValueOnce(graphNodeQueryResultSchema.parse({ ...graphNodes, total: 3 }))
      .mockResolvedValueOnce(graphSecondSearchPage);
    await explorer.searchGraph();
    fixture.detectChanges();
    expect(explorer.mode()).toBe('search');
    expect(explorer.searchLoaded()).toBe(2);
    expect(explorer.searchHasMore()).toBe(true);
    expect(graphService.query).toHaveBeenNthCalledWith(
      1,
      project.id,
      expect.objectContaining({
        name: 'AppComponent',
        limit: 100,
        offset: 0,
        types: expect.not.arrayContaining(['service']),
      }),
    );

    explorer.searchName.set('Unsubmitted search change');
    await explorer.loadMoreSearchResults();
    fixture.detectChanges();
    expect(explorer.searchLoaded()).toBe(3);
    expect(explorer.searchHasMore()).toBe(false);
    expect(explorer.nodes()).toHaveLength(3);
    expect(graphService.query).toHaveBeenNthCalledWith(
      2,
      project.id,
      expect.objectContaining({ name: 'AppComponent', offset: 2, limit: 100 }),
    );

    explorer.searchName.set('UserService');
    graphService.query.mockResolvedValueOnce(graphNodes);
    explorer.toggleNodeType('component', false);
    await vi.waitFor(() => expect(graphService.query).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(explorer.searchLoading()).toBe(false));
    expect(explorer.searchLoaded()).toBe(2);
    expect(graphService.query).toHaveBeenNthCalledWith(
      3,
      project.id,
      expect.objectContaining({
        name: 'UserService',
        offset: 0,
        limit: 100,
        types: expect.not.arrayContaining(['component']),
      }),
    );

    explorer.selectNodeById('file:src/index.ts');
    explorer.setNeighborhoodDepth('1');
    explorer.setNeighborhoodDirection('incoming');
    graphService.neighborhood.mockResolvedValueOnce(fileNeighborhood);
    await explorer.exploreSelectedNode();
    fixture.detectChanges();
    expect(explorer.mode()).toBe('neighborhood');
    expect(graphService.neighborhood).toHaveBeenLastCalledWith(
      project.id,
      expect.objectContaining({
        nodeId: 'file:src/index.ts',
        direction: 'incoming',
        depth: 1,
        limit: 250,
      }),
    );
  });

  it('shows analysis progress, cancels an in-flight worker, and surfaces worker errors', async () => {
    const fixture = TestBed.createComponent(ProjectDetailsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));

    const component = fixture.componentInstance;
    const page = fixture.nativeElement as HTMLElement;
    await component.startScan();
    fixture.detectChanges();

    let finishAnalysis: ((value: AnalysisResult) => void) | undefined;
    analysisService.start = vi.fn(
      () => new Promise<AnalysisResult>((resolve) => (finishAnalysis = resolve)),
    );
    const startPromise = component.startAnalysis();
    fixture.detectChanges();
    expect(component.analyzing()).toBe(true);

    analysisProgressListener?.({
      analysisId: analysisResult.analysisId,
      scanId: result.id,
      projectId: project.id,
      phase: 'parsing',
      filesTotal: 1,
      filesProcessed: 0,
      currentPath: 'src/index.ts',
      percentage: 50,
    });
    fixture.detectChanges();
    expect(page.textContent).toContain('Parsing TypeScript and JavaScript syntax');
    expect(page.textContent).toContain('src/index.ts');
    expect(component.activeAnalysisId()).toBe(analysisResult.analysisId);

    await component.cancelAnalysis();
    fixture.detectChanges();
    expect(analysisService.cancel).toHaveBeenCalledWith(analysisResult.analysisId);
    expect(component.cancellingAnalysis()).toBe(true);
    finishAnalysis?.({ ...analysisResult, status: 'cancelled' });
    await startPromise;
    fixture.detectChanges();
    expect(component.currentAnalysis()?.status).toBe('cancelled');
    expect(component.analyzing()).toBe(false);

    analysisService.start = vi.fn(async () => {
      throw new Error('worker unavailable');
    });
    await component.startAnalysis();
    fixture.detectChanges();
    expect(page.querySelector('[role="alert"]')?.textContent).toContain(
      'RepoLens could not complete static analysis.',
    );
  });

  it('cancels a pending analysis if the project route changes before progress supplies its analysis ID', async () => {
    const fixture = TestBed.createComponent(ProjectDetailsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));

    const component = fixture.componentInstance;
    await component.startScan();
    let finishAnalysis: ((value: AnalysisResult) => void) | undefined;
    analysisService.start = vi.fn(
      () => new Promise<AnalysisResult>((resolve) => (finishAnalysis = resolve)),
    );
    const request = component.startAnalysis();
    params.next(convertToParamMap({ projectId: 'b1b2c3d4-e5f6-47a8-9012-abcdef123456' }));
    await fixture.whenStable();
    expect(component.project()).toBe(project);
    expect(component.currentScan()).toBeNull();
    expect(component.currentAnalysis()).toBeNull();
    finishAnalysis?.(analysisResult);
    await request;
    await vi.waitFor(() =>
      expect(analysisService.cancel).toHaveBeenCalledWith(analysisResult.analysisId),
    );
    fixture.destroy();
  });

  it('does not start a scan until sensitive-file inclusion is explicitly acknowledged', async () => {
    const fixture = TestBed.createComponent(ProjectDetailsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));

    const component = fixture.componentInstance;
    component.setSensitiveFileInclusion(true);
    expect(component.acknowledgeSensitiveFileRisk()).toBe(false);
    await component.startScan();
    expect(scanService.start).not.toHaveBeenCalled();

    component.acknowledgeSensitiveFileRisk.set(true);
    await component.startScan();
    expect(scanService.start).toHaveBeenCalledOnce();
    expect(scanService.start).toHaveBeenCalledWith(
      project.id,
      expect.objectContaining({
        includeSensitiveFiles: true,
        acknowledgeSensitiveFileRisk: true,
      }),
    );
  });
});
