import { describe, expect, it } from 'vitest';
import {
  graphBuildProgressSchema,
  graphExportSchema,
  graphNodeSchema,
  type GraphExport,
} from './graph.schema.js';

const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const analysisId = '7d707ca0-312b-4a6f-8950-8df3441d973a';
const scanId = '92370c1b-8755-4057-ae23-0d885ad4d94b';
const sourceLocation = {
  filePath: 'src/index.ts',
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 8,
};

function makeExport(): GraphExport {
  return {
    schemaVersion: '1.0.0',
    projectId,
    analysisId,
    scanId,
    analysisStatus: 'completed',
    metrics: {
      nodeCount: 2,
      edgeCount: 0,
      nodesByType: [
        { type: 'project', count: 1 },
        { type: 'folder', count: 0 },
        { type: 'file', count: 1 },
        { type: 'component', count: 0 },
        { type: 'service', count: 0 },
        { type: 'class', count: 0 },
        { type: 'function', count: 0 },
        { type: 'interface', count: 0 },
        { type: 'api-route', count: 0 },
        { type: 'database-model', count: 0 },
      ],
      edgesByType: [
        { type: 'contains', count: 0 },
        { type: 'imports', count: 0 },
        { type: 'exports', count: 0 },
        { type: 'calls', count: 0 },
        { type: 'implements', count: 0 },
        { type: 'extends', count: 0 },
        { type: 'api-call', count: 0 },
        { type: 'uses-model', count: 0 },
      ],
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
    nodes: [
      { id: `project:${projectId}`, projectId, type: 'project', name: 'fixture' },
      {
        id: 'file:src/index.ts',
        projectId,
        type: 'file',
        name: 'index.ts',
        relativePath: 'src/index.ts',
      },
    ],
    edges: [],
    dependencies: [],
  };
}

function makeSelfDependencyExport(): GraphExport {
  const graph = makeExport();
  return {
    ...graph,
    metrics: {
      ...graph.metrics,
      edgeCount: 1,
      edgesByType: graph.metrics.edgesByType.map((entry) =>
        entry.type === 'imports' ? { ...entry, count: 1 } : entry,
      ),
      dependencyEdgeCount: 1,
      uniqueDependencyPairCount: 1,
      isolatedFileCount: 0,
      averageDependenciesPerFile: 1,
      maxDependenciesPerFile: 1,
      cyclicComponentCount: 1,
      selfLoopCount: 1,
    },
    edges: [
      {
        id: 'edge:import:dep-self',
        projectId,
        type: 'imports',
        sourceId: 'file:src/index.ts',
        targetId: 'file:src/index.ts',
        evidenceId: 'dep-self',
        sourceLocation,
        dependencyKind: 'local',
        specifier: './index',
        isTypeOnly: false,
      },
    ],
    dependencies: [
      {
        id: 'dependency:dep-self',
        fromNodeId: 'file:src/index.ts',
        toNodeId: 'file:src/index.ts',
        importId: 'src/index.ts#import:static:1:1',
        specifier: './index',
        kind: 'local',
        sourceLocation,
      },
    ],
  };
}

describe('graph shared schemas', () => {
  it('validates progress counters and terminal cancellation events', () => {
    const progress = {
      analysisId,
      scanId,
      projectId,
      phase: 'nodes' as const,
      processed: 4,
      total: 8,
      percentage: 50,
    };

    expect(graphBuildProgressSchema.parse(progress)).toEqual(progress);
    expect(graphBuildProgressSchema.safeParse({ ...progress, processed: 9 }).success).toBe(false);
    expect(
      graphBuildProgressSchema.safeParse({
        ...progress,
        phase: 'cancelled',
        processed: 0,
        total: 0,
        percentage: 0,
      }).success,
    ).toBe(true);
    expect(graphBuildProgressSchema.safeParse({ ...progress, percentage: 99 }).success).toBe(false);
  });

  it('rejects path-derived and symbol-derived node identity mismatches', () => {
    const fileNode = makeExport().nodes[1]!;
    expect(fileNode).toBeDefined();
    expect(graphNodeSchema.safeParse({ ...fileNode, id: 'file:src/other.ts' }).success).toBe(false);
    expect(
      graphNodeSchema.safeParse({
        ...fileNode,
        id: 'file:C:/src/index.ts',
        relativePath: 'C:/src/index.ts',
      }).success,
    ).toBe(false);

    const symbolNode = {
      id: 'symbol:src/index.ts#function:main',
      projectId,
      type: 'function',
      name: 'main',
      filePath: 'src/index.ts',
      symbolId: 'src/index.ts#function:main',
      symbolKind: 'function',
      location: sourceLocation,
    };
    expect(graphNodeSchema.safeParse(symbolNode).success).toBe(true);
    expect(graphNodeSchema.safeParse({ ...symbolNode, id: 'symbol:other' }).success).toBe(false);
  });

  it('validates exported references and cross-checks relationship metrics', () => {
    const graph = makeExport();
    expect(graphExportSchema.parse(graph)).toEqual(graph);

    const resolvedGraph = makeSelfDependencyExport();
    expect(graphExportSchema.parse(resolvedGraph)).toEqual(resolvedGraph);

    const invalidDependencyGraph: GraphExport = {
      ...resolvedGraph,
      dependencies: resolvedGraph.dependencies.map((dependency) => ({
        ...dependency,
        toNodeId: 'file:src/missing.ts',
      })),
    };
    expect(graphExportSchema.safeParse(invalidDependencyGraph).success).toBe(false);

    const mismatchedEvidenceGraph: GraphExport = {
      ...resolvedGraph,
      edges: resolvedGraph.edges.map((edge) => ({ ...edge, evidenceId: 'another-dependency' })),
    };
    expect(graphExportSchema.safeParse(mismatchedEvidenceGraph).success).toBe(false);

    const inconsistentMetricsGraph: GraphExport = {
      ...resolvedGraph,
      metrics: { ...resolvedGraph.metrics, fileCount: 0 },
    };
    expect(graphExportSchema.safeParse(inconsistentMetricsGraph).success).toBe(false);
  });
});
