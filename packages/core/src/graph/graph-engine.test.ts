import {
  analysisResultSchema,
  graphCycleReportSchema,
  graphExportJsonSchema,
  graphExportSchema,
  graphSummarySchema,
  graphNeighborhoodResultSchema,
  GRAPH_MAX_QUERY_EDGES,
  type AnalysisResult,
  type GraphBuildProgress,
} from '@repolens/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildProjectGraph, GraphBuildCancelledError, GraphEngineError } from './graph-engine.js';

const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const analysisId = '7d707ca0-312b-4a6f-8950-8df3441d973a';
const scanId = '92370c1b-8755-4057-ae23-0d885ad4d94b';
const timestamp = '2026-11-27T00:00:00.000Z';

function location(filePath: string, line: number) {
  return {
    filePath,
    startLine: line,
    startColumn: 1,
    endLine: line,
    endColumn: 8,
  };
}

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return analysisResultSchema.parse({
    analysisId,
    scanId,
    projectId,
    status: 'partial',
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 0,
    filesSelected: 4,
    filesAnalyzed: 4,
    filesSkipped: 0,
    analyzedFiles: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/isolated.ts'],
    symbols: [
      {
        id: 'src/a.ts#module',
        name: 'a.ts',
        kind: 'module',
        location: location('src/a.ts', 1),
        exported: false,
      },
      {
        id: 'src/a.ts#function:A',
        name: 'A',
        kind: 'function',
        location: location('src/a.ts', 2),
        parentId: 'src/a.ts#module',
        exported: true,
      },
      {
        id: 'src/b.ts#module',
        name: 'b.ts',
        kind: 'module',
        location: location('src/b.ts', 1),
        exported: false,
      },
      {
        id: 'src/b.ts#class:BService',
        name: 'BService',
        kind: 'class',
        location: location('src/b.ts', 2),
        parentId: 'src/b.ts#module',
        exported: true,
      },
      {
        id: 'src/c.ts#module',
        name: 'c.ts',
        kind: 'module',
        location: location('src/c.ts', 1),
        exported: false,
      },
      {
        id: 'src/c.ts#interface:C',
        name: 'C',
        kind: 'interface',
        location: location('src/c.ts', 2),
        parentId: 'src/c.ts#module',
        exported: true,
      },
      {
        id: 'src/isolated.ts#module',
        name: 'isolated.ts',
        kind: 'module',
        location: location('src/isolated.ts', 1),
        exported: false,
      },
    ],
    imports: [
      importRecord('imp:a-b-1', 'src/a.ts', './b', 3),
      importRecord('imp:a-b-2', 'src/a.ts', './b', 4),
      importRecord('imp:a-external', 'src/a.ts', '@scope/pkg/subpath', 5),
      importRecord('imp:a-unresolved', 'src/a.ts', './missing', 6),
      importRecord('imp:b-a', 'src/b.ts', './a', 3),
      importRecord('imp:b-c', 'src/b.ts', './c', 4),
      importRecord('imp:c-a', 'src/c.ts', './a', 3),
    ],
    dependencies: [
      dependencyRecord('dep:a-b-1', 'imp:a-b-1', 'src/a.ts', './b', 'local', 'src/b.ts'),
      dependencyRecord('dep:a-b-2', 'imp:a-b-2', 'src/a.ts', './b', 'local', 'src/b.ts'),
      {
        id: 'dep:a-external',
        importId: 'imp:a-external',
        fromPath: 'src/a.ts',
        specifier: '@scope/pkg/subpath',
        kind: 'external-package',
        packageName: '@scope/pkg',
      },
      {
        id: 'dep:a-unresolved',
        importId: 'imp:a-unresolved',
        fromPath: 'src/a.ts',
        specifier: './missing',
        kind: 'unresolved',
        reason: 'No matching scanned path.',
      },
      dependencyRecord('dep:b-a', 'imp:b-a', 'src/b.ts', './a', 'local', 'src/a.ts'),
      dependencyRecord('dep:b-c', 'imp:b-c', 'src/b.ts', './c', 'alias', 'src/c.ts'),
      dependencyRecord('dep:c-a', 'imp:c-a', 'src/c.ts', './a', 'local', 'src/a.ts'),
    ],
    exports: [
      exportRecord('exp:a', 'src/a.ts', 'A', 'src/a.ts#function:A', 2),
      exportRecord('exp:b', 'src/b.ts', 'BService', 'src/b.ts#class:BService', 2),
      exportRecord('exp:c', 'src/c.ts', 'C', 'src/c.ts#interface:C', 2),
      {
        id: 'exp:a-re-export',
        filePath: 'src/a.ts',
        name: 'B',
        kind: 'named',
        source: './b',
        symbolIds: [],
        dependencyId: 'dep:a-b-1',
        isTypeOnly: false,
        location: location('src/a.ts', 8),
      },
    ],
    diagnostics: [],
    ...overrides,
  });
}

function importRecord(id: string, filePath: string, specifier: string, line: number) {
  return {
    id,
    filePath,
    specifier,
    kind: 'static' as const,
    bindings: [],
    isTypeOnly: false,
    location: location(filePath, line),
  };
}

function dependencyRecord(
  id: string,
  importId: string,
  fromPath: string,
  specifier: string,
  kind: 'local' | 'alias',
  resolvedPath: string,
) {
  return { id, importId, fromPath, specifier, kind, resolvedPath };
}

function exportRecord(id: string, filePath: string, name: string, symbolId: string, line: number) {
  return {
    id,
    filePath,
    name,
    kind: 'named' as const,
    localName: name,
    symbolIds: [symbolId],
    isTypeOnly: false,
    location: location(filePath, line),
  };
}

describe('Graphology in-memory graph engine', () => {
  it('builds normalized, evidence-backed nodes and edges with distinct local, external, and unresolved relations', async () => {
    const graph = await buildProjectGraph(makeAnalysis());
    const exported = graph.toExport();

    expect(graphExportSchema.parse(exported)).toEqual(exported);
    expect(exported.nodes.map((node) => node.type)).toEqual(
      expect.arrayContaining(['project', 'folder', 'file', 'function', 'class', 'interface']),
    );
    expect(exported.nodes.find((node) => node.name === 'BService')).toMatchObject({
      type: 'class',
      symbolKind: 'class',
      filePath: 'src/b.ts',
      location: location('src/b.ts', 2),
      exported: true,
    });
    expect(exported.nodes.some((node) => node.type === 'service')).toBe(false);
    expect(exported.nodes.some((node) => node.name === 'missing')).toBe(false);
    expect(exported.dependencies.map((dependency) => dependency.kind)).toEqual([
      'local',
      'local',
      'external-package',
      'unresolved',
      'local',
      'alias',
      'local',
    ]);
    const external = exported.dependencies.find((item) => item.kind === 'external-package');
    expect(external).toMatchObject({ packageName: '@scope/pkg' });
    expect(external).not.toHaveProperty('toNodeId');
    const unresolved = exported.dependencies.find((item) => item.kind === 'unresolved');
    expect(unresolved).toMatchObject({ reason: 'No matching scanned path.' });
    expect(unresolved).not.toHaveProperty('toNodeId');
    expect(exported.edges.filter((edge) => edge.type === 'imports')).toHaveLength(5);
    expect(exported.edges.filter((edge) => edge.type === 'exports')).toHaveLength(4);
    expect(exported.edges.every((edge) => edge.sourceId && edge.targetId)).toBe(true);
    expect(JSON.stringify(exported)).not.toContain('sourceText');
    expect(JSON.stringify(exported)).not.toContain('const A');
  });

  it('includes analyzed files without symbols and rejects an analysis with no parsed files', async () => {
    const analyzedFile = analysisResultSchema.parse({
      ...makeAnalysis(),
      filesSelected: 1,
      filesAnalyzed: 1,
      filesSkipped: 0,
      analyzedFiles: ['src/isolated.ts'],
      symbols: [],
      imports: [],
      exports: [],
      dependencies: [],
      diagnostics: [],
    });
    const graph = await buildProjectGraph(analyzedFile);
    expect(graph.getSummary().metrics.fileCount).toBe(1);
    expect(graph.queryNodes({ types: ['file'] }).nodes).toEqual([
      expect.objectContaining({
        id: 'file:src/isolated.ts',
        relativePath: 'src/isolated.ts',
      }),
    ]);

    const emptyAnalysis = analysisResultSchema.parse({
      ...analyzedFile,
      filesSelected: 0,
      filesAnalyzed: 0,
      filesSkipped: 0,
      analyzedFiles: [],
    });
    await expect(buildProjectGraph(emptyAnalysis)).rejects.toMatchObject({
      code: 'INVALID_ANALYSIS',
    });
  });

  it('calculates file, relationship, degree, and SCC metrics from the graph', async () => {
    const metrics = (await buildProjectGraph(makeAnalysis())).getSummary().metrics;

    expect(
      graphSummarySchema.parse({
        projectId,
        analysisId,
        scanId,
        analysisStatus: 'partial',
        metrics,
      }),
    ).toMatchObject({
      metrics: {
        nodeCount: 9,
        fileCount: 4,
        folderCount: 1,
        symbolCount: 3,
        analysisFilesAnalyzed: 4,
        dependencyEdgeCount: 5,
        uniqueDependencyPairCount: 4,
        externalDependencyCount: 1,
        unresolvedDependencyCount: 1,
        isolatedFileCount: 1,
        averageDependenciesPerFile: 1,
        maxDependenciesPerFile: 2,
        stronglyConnectedComponentCount: 2,
        cyclicComponentCount: 1,
        selfLoopCount: 0,
      },
    });
  });

  it('supports direct, transitive, reverse, depth-limited, and shortest-path dependency queries', async () => {
    const graph = await buildProjectGraph(makeAnalysis());

    expect(
      graph.traverseDependencies({ relativePath: 'src/a.ts', direction: 'dependencies', depth: 1 })
        ?.files,
    ).toEqual([{ relativePath: 'src/b.ts', distance: 1 }]);
    expect(
      graph.traverseDependencies({ relativePath: 'src/a.ts', direction: 'dependencies', depth: 2 })
        ?.files,
    ).toEqual([
      { relativePath: 'src/b.ts', distance: 1 },
      { relativePath: 'src/c.ts', distance: 2 },
    ]);
    expect(
      graph.traverseDependencies({ relativePath: 'src/a.ts', direction: 'dependents', depth: 1 })
        ?.files,
    ).toEqual([
      { relativePath: 'src/b.ts', distance: 1 },
      { relativePath: 'src/c.ts', distance: 1 },
    ]);
    expect(graph.findDependencyPath({ fromPath: 'src/a.ts', toPath: 'src/c.ts' })).toEqual({
      fromPath: 'src/a.ts',
      toPath: 'src/c.ts',
      hops: 2,
      filePaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    });
    expect(
      graph.findDependencyPath({ fromPath: 'src/a.ts', toPath: 'src/isolated.ts' }),
    ).toBeNull();
    expect(graph.traverseDependencies({ relativePath: 'src/not-scanned.ts', depth: 1 })).toBeNull();
  });

  it('returns only bounded relationships whose endpoints are present on the queried node page', async () => {
    const graph = await buildProjectGraph(makeAnalysis());
    const page = graph.queryNodes({ limit: 100 });
    const nodeIds = new Set(page.nodes.map((node) => node.id));

    expect(page.nodes).toHaveLength(9);
    expect(page.edgesTruncated).toBe(false);
    expect(page.edges.length).toBeGreaterThan(0);
    expect(
      page.edges.every((edge) => nodeIds.has(edge.sourceId) && nodeIds.has(edge.targetId)),
    ).toBe(true);
    expect(page.edges).toContainEqual(
      expect.objectContaining({
        type: 'imports',
        sourceId: 'file:src/a.ts',
        targetId: 'file:src/b.ts',
      }),
    );

    const filesPage = graph.queryNodes({ types: ['file'], limit: 100 });
    const fileIds = new Set(filesPage.nodes.map((node) => node.id));
    expect(filesPage.edges.length).toBeGreaterThan(0);
    expect(
      filesPage.edges.every((edge) => fileIds.has(edge.sourceId) && fileIds.has(edge.targetId)),
    ).toBe(true);
  });

  it('caps graph-query relationships and reports when the page is truncated', async () => {
    const base = makeAnalysis();
    const extraImports = Array.from({ length: GRAPH_MAX_QUERY_EDGES + 1 }, (_, index) => {
      const suffix = index.toString().padStart(4, '0');
      return importRecord(`imp:query-cap-${suffix}`, 'src/a.ts', './b', 20 + index);
    });
    const extraDependencies = extraImports.map((item, index) => {
      const suffix = index.toString().padStart(4, '0');
      return dependencyRecord(
        `dep:query-cap-${suffix}`,
        item.id,
        'src/a.ts',
        './b',
        'local',
        'src/b.ts',
      );
    });
    const analysis = analysisResultSchema.parse({
      ...base,
      imports: [...base.imports, ...extraImports],
      dependencies: [...base.dependencies, ...extraDependencies],
    });
    const page = (await buildProjectGraph(analysis)).queryNodes({ limit: 100 });

    expect(page.edges).toHaveLength(GRAPH_MAX_QUERY_EDGES);
    expect(page.edgesTruncated).toBe(true);
  });

  it('queries nodes by type, name, path prefix, export status, and stable pagination', async () => {
    const graph = await buildProjectGraph(makeAnalysis());

    expect(graph.queryNodes({ types: ['class'], pathPrefix: 'src', exported: true })).toMatchObject(
      {
        total: 1,
        nodes: [expect.objectContaining({ name: 'BService', type: 'class' })],
      },
    );
    expect(
      graph.queryNodes({ types: ['file', 'function'], name: 'a', limit: 2, offset: 0 }),
    ).toMatchObject({
      total: 3,
      limit: 2,
      offset: 0,
    });
    expect(
      graph.queryNodes({ types: ['file', 'function'], name: 'a', limit: 2, offset: 2 }).nodes,
    ).toHaveLength(1);
  });

  it('returns bounded directed neighborhoods with only real edges between returned nodes', async () => {
    const graph = await buildProjectGraph(makeAnalysis());
    const outgoing = graph.queryNeighborhood({
      nodeId: 'file:src/a.ts',
      direction: 'outgoing',
      edgeTypes: ['imports'],
      depth: 1,
      limit: 10,
    });

    expect(graphNeighborhoodResultSchema.parse(outgoing)).toEqual(outgoing);
    expect(outgoing).toMatchObject({
      anchorNodeId: 'file:src/a.ts',
      depth: 1,
      limit: 10,
      nodesTruncated: false,
      edgesTruncated: false,
    });
    expect(outgoing?.nodes.map((node) => node.id)).toEqual(['file:src/a.ts', 'file:src/b.ts']);
    expect(outgoing?.edges).toHaveLength(3);
    expect(outgoing?.edges.every((edge) => edge.type === 'imports')).toBe(true);
    expect(
      outgoing?.edges.every(
        (edge) =>
          outgoing.nodes.some((node) => node.id === edge.sourceId) &&
          outgoing.nodes.some((node) => node.id === edge.targetId),
      ),
    ).toBe(true);

    const incoming = graph.queryNeighborhood({
      nodeId: 'file:src/b.ts',
      direction: 'incoming',
      edgeTypes: ['imports'],
      depth: 1,
      limit: 10,
    });
    expect(incoming?.nodes.map((node) => node.id)).toEqual(['file:src/a.ts', 'file:src/b.ts']);
    expect(incoming?.edges).toHaveLength(3);

    const capped = graph.queryNeighborhood({
      nodeId: 'file:src/a.ts',
      direction: 'outgoing',
      depth: 1,
      limit: 1,
    });
    expect(capped).toMatchObject({ nodesTruncated: true, edges: [] });
    expect(graph.queryNeighborhood({ nodeId: 'file:src/missing.ts' })).toBeNull();
  });

  it('caps neighborhood relationships and marks a full edge page as truncated', async () => {
    const base = makeAnalysis();
    const extraImports = Array.from({ length: GRAPH_MAX_QUERY_EDGES + 1 }, (_, index) => {
      const suffix = index.toString().padStart(4, '0');
      return importRecord(`imp:neighborhood-cap-${suffix}`, 'src/a.ts', './b', 20 + index);
    });
    const extraDependencies = extraImports.map((item, index) => {
      const suffix = index.toString().padStart(4, '0');
      return dependencyRecord(
        `dep:neighborhood-cap-${suffix}`,
        item.id,
        'src/a.ts',
        './b',
        'local',
        'src/b.ts',
      );
    });
    const analysis = analysisResultSchema.parse({
      ...base,
      imports: [...base.imports, ...extraImports],
      dependencies: [...base.dependencies, ...extraDependencies],
    });
    const neighborhood = (await buildProjectGraph(analysis)).queryNeighborhood({
      nodeId: 'file:src/a.ts',
      direction: 'outgoing',
      edgeTypes: ['imports'],
      depth: 1,
      limit: 2,
    });

    if (neighborhood === null) {
      throw new Error('Expected an existing file node neighborhood.');
    }
    expect(graphNeighborhoodResultSchema.parse(neighborhood)).toEqual(neighborhood);
    expect(neighborhood.nodes).toHaveLength(2);
    expect(neighborhood.edges).toHaveLength(GRAPH_MAX_QUERY_EDGES);
    expect(neighborhood.edgesTruncated).toBe(true);
  });

  it('preserves Angular semantic roles when mapping source symbols to graph node types', async () => {
    const analysis = makeAnalysis();
    const graph = await buildProjectGraph({
      ...analysis,
      symbols: analysis.symbols.map((symbol) =>
        symbol.id === 'src/b.ts#class:BService'
          ? { ...symbol, semanticRole: 'service' as const }
          : symbol,
      ),
    });
    expect(graph.toExport().nodes).toContainEqual(
      expect.objectContaining({
        name: 'BService',
        type: 'service',
        symbolKind: 'class',
      }),
    );
  });

  it('returns canonical nonduplicate simple cycles and keeps SCCs distinct from cycle paths', async () => {
    const graph = await buildProjectGraph(makeAnalysis());
    const report = graph.findCycles();

    expect(graphCycleReportSchema.parse(report)).toEqual(report);
    expect(report.stronglyConnectedComponentCount).toBe(2);
    expect(report.cyclicComponents).toEqual([['src/a.ts', 'src/b.ts', 'src/c.ts']]);
    expect(report.cycles).toEqual([
      ['src/a.ts', 'src/b.ts'],
      ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    ]);
    expect(report.truncated).toBe(false);

    const bounded = graph.findCycles({ maxCycles: 1 });
    expect(bounded.cycles).toHaveLength(1);
    expect(bounded.truncated).toBe(true);
  });

  it('exports deterministic, schema-validated JSON without Graphology objects', async () => {
    const first = await buildProjectGraph(makeAnalysis());
    const second = await buildProjectGraph(makeAnalysis());
    const json = first.exportJson();

    expect(json).toBe(second.exportJson());
    expect(graphExportJsonSchema.parse(json)).toBe(json);
    expect(graphExportSchema.parse(JSON.parse(json) as unknown)).toEqual(first.toExport());
    expect(json).toContain('"schemaVersion": "1.0.0"');
    expect(json).not.toContain('"graph":');
  });

  it('deduplicates identical records deterministically and rejects conflicting duplicate identities', async () => {
    const analysis = makeAnalysis();
    const moduleSymbol = analysis.symbols[0];
    expect(moduleSymbol).toBeDefined();
    const graph = await buildProjectGraph({
      ...analysis,
      symbols: [...analysis.symbols, moduleSymbol!],
    });
    expect(graph.getSummary().metrics.symbolCount).toBe(3);

    const conflicting = analysisResultSchema.parse({
      ...analysis,
      symbols: [...analysis.symbols, { ...moduleSymbol!, name: 'conflicting-module-name' }],
    });
    await expect(buildProjectGraph(conflicting)).rejects.toThrowError(
      expect.objectContaining({ code: 'CONFLICTING_DUPLICATE_ID' }),
    );
  });

  it('reports deterministic build progress and yields between bounded batches', async () => {
    const progress: GraphBuildProgress[] = [];
    const yieldToEventLoop = vi.fn(async () => undefined);

    await buildProjectGraph(makeAnalysis(), {
      batchSize: 2,
      onProgress: (event) => progress.push(event),
      yieldToEventLoop,
    });

    expect(new Set(progress.map((event) => event.phase))).toEqual(
      new Set(['preparing', 'nodes', 'edges', 'metrics']),
    );
    for (const phase of ['preparing', 'nodes', 'edges', 'metrics'] as const) {
      const phaseEvents = progress.filter((event) => event.phase === phase);
      const finalEvent = phaseEvents[phaseEvents.length - 1];
      expect(finalEvent).toBeDefined();
      expect(finalEvent?.processed).toBe(finalEvent?.total);
      expect(finalEvent?.percentage).toBe(100);
    }
    expect(yieldToEventLoop).toHaveBeenCalled();
  });

  it('cancels construction at a progress checkpoint without returning a partial graph', async () => {
    const signal = { aborted: false };

    await expect(
      buildProjectGraph(makeAnalysis(), {
        batchSize: 1,
        signal,
        onProgress: (progress) => {
          if (progress.phase === 'nodes' && progress.processed === 0) {
            signal.aborted = true;
          }
        },
      }),
    ).rejects.toBeInstanceOf(GraphBuildCancelledError);
  });

  it('observes cancellation while normalizing records before Graphology insertion', async () => {
    const signal = { aborted: false };

    await expect(
      buildProjectGraph(makeAnalysis(), {
        batchSize: 1,
        signal,
        yieldToEventLoop: async () => {
          signal.aborted = true;
        },
      }),
    ).rejects.toBeInstanceOf(GraphBuildCancelledError);
  });

  it('rejects missing references, conflicting dependency resolutions, and impossible path trees', async () => {
    const base = makeAnalysis();
    await expect(
      buildProjectGraph({
        ...base,
        dependencies: [
          { ...base.dependencies[0]!, importId: 'missing-import-id' },
          ...base.dependencies.slice(1),
        ],
      }),
    ).rejects.toThrowError(GraphEngineError);

    await expect(
      buildProjectGraph({
        ...base,
        dependencies: [
          ...base.dependencies,
          {
            ...base.dependencies[0]!,
            id: 'dep:a-b-conflict',
            resolvedPath: 'src/c.ts',
          },
        ],
      }),
    ).rejects.toThrowError(/multiple conflicting dependency resolutions/i);

    const conflictingPaths = analysisResultSchema.parse({
      ...base,
      filesAnalyzed: 2,
      analyzedFiles: ['src/a', 'src/a/child.ts'],
      imports: [],
      dependencies: [],
      exports: [],
      symbols: [
        {
          id: 'src/a#module',
          name: 'a',
          kind: 'module',
          location: location('src/a', 1),
          exported: false,
        },
        {
          id: 'src/a/child.ts#module',
          name: 'child.ts',
          kind: 'module',
          location: location('src/a/child.ts', 1),
          exported: false,
        },
      ],
    });
    await expect(buildProjectGraph(conflictingPaths)).rejects.toThrowError(
      /both a file and a folder/i,
    );
  });
});
