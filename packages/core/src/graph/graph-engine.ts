import {
  analysisResultSchema,
  graphBuildProgressSchema,
  graphCycleQuerySchema,
  graphCycleReportSchema,
  graphDependencyQuerySchema,
  graphExportJsonSchema,
  graphExportSchema,
  graphMetricsSchema,
  graphNodeQueryResultSchema,
  graphNodeQuerySchema,
  graphNodeSchema,
  graphPathQuerySchema,
  graphPathResultSchema,
  graphSummarySchema,
  graphTraversalResultSchema,
  GRAPH_MAX_DEPENDENCIES,
  GRAPH_MAX_EDGES,
  GRAPH_MAX_JSON_CHARS,
  GRAPH_MAX_NODES,
  graphEdgeSchema,
  graphDependencyReferenceSchema,
  graphEdgeTypeSchema,
  graphNodeTypeSchema,
  type AnalysisResult,
  type AnalysisSymbol,
  type GraphBuildProgress,
  type GraphCycleQuery,
  type GraphCycleReport,
  type GraphDependencyQuery,
  type GraphDependencyReference,
  type GraphEdge,
  type GraphExport,
  type GraphMetrics,
  type GraphNode,
  type GraphNodeQuery,
  type GraphNodeQueryResult,
  type GraphPathQuery,
  type GraphPathResult,
  type GraphSummary,
  type GraphTraversalResult,
} from '@repolens/shared';
import { MultiDirectedGraph, DirectedGraph } from 'graphology';
import { bidirectional } from 'graphology-shortest-path/unweighted.js';

export const GRAPH_ENGINE_LIMITS = Object.freeze({
  maxNodes: GRAPH_MAX_NODES,
  maxEdges: GRAPH_MAX_EDGES,
  maxDependencies: GRAPH_MAX_DEPENDENCIES,
  maxPathSegments: 256,
  maxCycleCount: 1000,
  maxCycleTransitions: 250_000,
});

export interface GraphBuildOptions {
  readonly projectName?: string;
  readonly signal?: { readonly aborted: boolean };
  readonly onProgress?: (progress: GraphBuildProgress) => void;
  readonly yieldToEventLoop?: () => Promise<void>;
  readonly batchSize?: number;
}

export class GraphBuildCancelledError extends Error {
  constructor() {
    super('Graph construction was cancelled.');
    this.name = 'GraphBuildCancelledError';
  }
}

export type GraphEngineErrorCode =
  | 'INVALID_ANALYSIS'
  | 'CONFLICTING_DUPLICATE_ID'
  | 'INVALID_RELATIONSHIP'
  | 'GRAPH_LIMIT_REACHED'
  | 'EXPORT_TOO_LARGE';

export class GraphEngineError extends Error {
  constructor(
    readonly code: GraphEngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GraphEngineError';
  }
}

interface GraphNodeAttributes extends Record<string, unknown> {
  readonly id: string;
  readonly projectId: string;
  readonly type: GraphNode['type'];
  readonly name: string;
  readonly relativePath?: string;
  readonly filePath?: string;
  readonly symbolId?: string;
  readonly symbolKind?: AnalysisSymbol['kind'];
  readonly exported?: boolean;
  readonly location?: GraphNode['location'];
}

interface GraphEdgeAttributes extends Record<string, unknown> {
  readonly id: string;
  readonly projectId: string;
  readonly type: GraphEdge['type'];
  readonly sourceId: string;
  readonly targetId: string;
  readonly evidenceId?: string;
  readonly sourceLocation?: GraphEdge['sourceLocation'];
  readonly dependencyKind?: 'local' | 'alias';
  readonly specifier?: string;
  readonly name?: string;
  readonly isTypeOnly?: boolean;
}

interface NormalizedRecords {
  readonly symbols: readonly AnalysisSymbol[];
  readonly imports: readonly AnalysisResult['imports'][number][];
  readonly exports: readonly AnalysisResult['exports'][number][];
  readonly dependencies: readonly AnalysisResult['dependencies'][number][];
}

/**
 * An immutable, framework-independent graph facade. Graphology instances stay private; callers
 * receive only schema-validated DTOs and never have to depend on Graphology APIs.
 */
export class ProjectGraph {
  private readonly graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>;
  private readonly dependencyGraph: DirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>;
  private readonly dependencyReferences: readonly GraphDependencyReference[];
  private readonly metadata: Pick<
    GraphExport,
    'projectId' | 'analysisId' | 'scanId' | 'analysisStatus'
  >;
  private readonly graphMetrics: GraphMetrics;

  private constructor(
    metadata: Pick<GraphExport, 'projectId' | 'analysisId' | 'scanId' | 'analysisStatus'>,
    graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
    dependencyGraph: DirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
    dependencies: readonly GraphDependencyReference[],
    metrics: GraphMetrics,
  ) {
    this.metadata = Object.freeze({ ...metadata });
    this.graph = graph;
    this.dependencyGraph = dependencyGraph;
    this.dependencyReferences = Object.freeze(
      [...dependencies]
        .sort((left, right) => compareStrings(left.id, right.id))
        .map((dependency) => Object.freeze({ ...dependency })),
    );
    this.graphMetrics = metrics;
  }

  static async create(
    metadata: Pick<GraphExport, 'projectId' | 'analysisId' | 'scanId' | 'analysisStatus'>,
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
    dependencies: readonly GraphDependencyReference[],
    analysisFilesAnalyzed: number,
    options: GraphBuildOptions = {},
  ): Promise<ProjectGraph> {
    const context = createBuildContext(metadata, options);
    const graph = new MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>({
      allowSelfLoops: true,
    });
    const dependencyGraph = new DirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>({
      allowSelfLoops: true,
    });
    const sortedNodes = [...nodes].sort((left, right) => compareStrings(left.id, right.id));
    const nodeById = new Map(sortedNodes.map((node) => [node.id, node]));

    context.report('nodes', 0, sortedNodes.length);
    for (let index = 0; index < sortedNodes.length; index += 1) {
      context.throwIfCancelled();
      const node = sortedNodes[index];
      if (node === undefined) {
        continue;
      }
      const attributes = freezeNodeAttributes(node);
      graph.addNode(node.id, attributes);
      if (node.type === 'file') {
        dependencyGraph.addNode(node.id, attributes);
      }
      await context.checkpoint('nodes', index + 1, sortedNodes.length);
    }

    const sortedEdges = [...edges].sort((left, right) => compareStrings(left.id, right.id));
    const dependencyPairs = new Map<string, GraphEdge>();
    for (const edge of sortedEdges) {
      if (edge.type === 'imports' && edge.dependencyKind !== undefined) {
        const pairKey = JSON.stringify([edge.sourceId, edge.targetId]);
        if (!dependencyPairs.has(pairKey)) {
          dependencyPairs.set(pairKey, edge);
        }
      }
    }
    const pairEdges = [...dependencyPairs.values()];
    const totalEdges = sortedEdges.length + pairEdges.length;
    context.report('edges', 0, totalEdges);
    let completedEdges = 0;
    for (const edge of sortedEdges) {
      context.throwIfCancelled();
      graph.addDirectedEdgeWithKey(
        edge.id,
        edge.sourceId,
        edge.targetId,
        freezeEdgeAttributes(edge),
      );
      completedEdges += 1;
      await context.checkpoint('edges', completedEdges, totalEdges);
    }
    for (const edge of pairEdges) {
      context.throwIfCancelled();
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (source?.type !== 'file' || target?.type !== 'file') {
        throw new GraphEngineError(
          'INVALID_RELATIONSHIP',
          'A resolved dependency must connect two file nodes.',
        );
      }
      const pairEdgeId = `dependency-pair:${JSON.stringify([edge.sourceId, edge.targetId])}`;
      dependencyGraph.addDirectedEdgeWithKey(
        pairEdgeId,
        edge.sourceId,
        edge.targetId,
        freezeEdgeAttributes(edge),
      );
      completedEdges += 1;
      await context.checkpoint('edges', completedEdges, totalEdges);
    }

    const dependenciesById = [...dependencies].sort((left, right) =>
      compareStrings(left.id, right.id),
    );
    const metrics = await calculateMetrics(
      graph,
      dependencyGraph,
      dependenciesById,
      analysisFilesAnalyzed,
      context,
    );
    context.throwIfCancelled();
    return new ProjectGraph(metadata, graph, dependencyGraph, dependenciesById, metrics);
  }

  get projectId(): string {
    return this.metadata.projectId;
  }

  get analysisId(): string {
    return this.metadata.analysisId;
  }

  getSummary(): GraphSummary {
    return graphSummarySchema.parse({ ...this.metadata, metrics: this.graphMetrics });
  }

  queryNodes(query: GraphNodeQuery = {}): GraphNodeQueryResult {
    const options = graphNodeQuerySchema.parse(query);
    const typeFilter = options.types === undefined ? null : new Set(options.types);
    const nameFilter = options.name?.toLowerCase();
    const matching = this.graph
      .nodes()
      .sort((left, right) => compareStrings(left, right))
      .map((nodeId) => getNodeDto(this.graph, nodeId))
      .filter((node) => {
        if (typeFilter !== null && !typeFilter.has(node.type)) {
          return false;
        }
        if (nameFilter !== undefined && !node.name.toLowerCase().includes(nameFilter)) {
          return false;
        }
        if (options.exported !== undefined && node.exported !== options.exported) {
          return false;
        }
        if (options.pathPrefix !== undefined) {
          const path = node.relativePath ?? node.filePath;
          if (
            path === undefined ||
            (path !== options.pathPrefix && !path.startsWith(`${options.pathPrefix}/`))
          ) {
            return false;
          }
        }
        return true;
      });

    return graphNodeQueryResultSchema.parse({
      nodes: matching.slice(options.offset, options.offset + options.limit),
      total: matching.length,
      offset: options.offset,
      limit: options.limit,
    });
  }

  getNode(nodeId: string): GraphNode | null {
    if (!this.graph.hasNode(nodeId)) {
      return null;
    }
    return getNodeDto(this.graph, nodeId);
  }

  traverseDependencies(query: GraphDependencyQuery): GraphTraversalResult | null {
    const options = graphDependencyQuerySchema.parse(query);
    const startId = fileNodeId(options.relativePath);
    if (!this.dependencyGraph.hasNode(startId)) {
      return null;
    }

    const distances = new Map<string, number>([[startId, 0]]);
    const queue = [startId];
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const nodeId = queue[queueIndex];
      queueIndex += 1;
      if (nodeId === undefined) {
        continue;
      }
      const distance = distances.get(nodeId);
      if (distance === undefined || distance >= options.depth) {
        continue;
      }
      const neighbors =
        options.direction === 'dependencies'
          ? this.dependencyGraph.outboundNeighbors(nodeId)
          : this.dependencyGraph.inboundNeighbors(nodeId);
      neighbors.sort((left, right) => compareStrings(left, right));
      for (const neighbor of neighbors) {
        if (distances.has(neighbor)) {
          continue;
        }
        distances.set(neighbor, distance + 1);
        queue.push(neighbor);
      }
    }

    const files = [...distances.entries()]
      .filter(([nodeId]) => nodeId !== startId)
      .map(([nodeId, distance]) => {
        const node = getNodeDto(this.dependencyGraph, nodeId);
        if (node.relativePath === undefined) {
          throw new GraphEngineError(
            'INVALID_RELATIONSHIP',
            'A dependency traversal reached a non-file node.',
          );
        }
        return { relativePath: node.relativePath, distance };
      })
      .sort(
        (left, right) =>
          left.distance - right.distance || compareStrings(left.relativePath, right.relativePath),
      );

    return graphTraversalResultSchema.parse({
      startPath: options.relativePath,
      direction: options.direction,
      depth: options.depth,
      files,
    });
  }

  findDependencyPath(query: GraphPathQuery): GraphPathResult | null {
    const options = graphPathQuerySchema.parse(query);
    const sourceId = fileNodeId(options.fromPath);
    const targetId = fileNodeId(options.toPath);
    if (!this.dependencyGraph.hasNode(sourceId) || !this.dependencyGraph.hasNode(targetId)) {
      return null;
    }
    const nodePath = bidirectional(this.dependencyGraph, sourceId, targetId);
    if (nodePath === null) {
      return null;
    }
    const filePaths = nodePath.map((nodeId) => {
      const node = getNodeDto(this.dependencyGraph, nodeId);
      if (node.relativePath === undefined) {
        throw new GraphEngineError(
          'INVALID_RELATIONSHIP',
          'A shortest path must contain file nodes.',
        );
      }
      return node.relativePath;
    });
    return graphPathResultSchema.parse({
      fromPath: options.fromPath,
      toPath: options.toPath,
      hops: filePaths.length - 1,
      filePaths,
    });
  }

  findCycles(query: GraphCycleQuery = {}): GraphCycleReport {
    const options = graphCycleQuerySchema.parse(query);
    const components = stronglyConnectedComponents(this.dependencyGraph);

    const cyclicComponents = components.filter((component) => {
      if (component.length > 1) {
        return true;
      }
      const onlyNode = component[0];
      return onlyNode !== undefined && this.dependencyGraph.hasDirectedEdge(onlyNode, onlyNode);
    });
    const cycleResult = enumerateSimpleCycles(
      this.dependencyGraph,
      cyclicComponents,
      options.maxCycles,
      GRAPH_ENGINE_LIMITS.maxCycleTransitions,
    );

    const report = {
      projectId: this.metadata.projectId,
      analysisId: this.metadata.analysisId,
      stronglyConnectedComponentCount: components.length,
      cyclicComponents: cyclicComponents.map((component) =>
        component.map((nodeId) => filePathFromNodeId(nodeId)),
      ),
      cycles: cycleResult.cycles.map((cycle) => cycle.map((nodeId) => filePathFromNodeId(nodeId))),
      maxCycles: options.maxCycles,
      truncated: cycleResult.truncated,
      exploredTransitions: cycleResult.exploredTransitions,
    };
    return graphCycleReportSchema.parse(report);
  }

  toExport(): GraphExport {
    const nodes = this.graph
      .nodes()
      .sort((left, right) => compareStrings(left, right))
      .map((nodeId) => getNodeDto(this.graph, nodeId));
    const edges = this.graph
      .edges()
      .sort((left, right) => compareStrings(left, right))
      .map((edgeId) => getEdgeDto(this.graph, edgeId));
    return graphExportSchema.parse({
      schemaVersion: '1.0.0',
      ...this.metadata,
      metrics: this.graphMetrics,
      nodes,
      edges,
      dependencies: this.dependencyReferences,
    });
  }

  exportJson(): string {
    const graph = this.toExport();
    const serialized = `${JSON.stringify(graph, null, 2)}\n`;
    if (utf8ByteLength(serialized) > GRAPH_MAX_JSON_CHARS) {
      throw new GraphEngineError(
        'EXPORT_TOO_LARGE',
        'The JSON graph export exceeds the configured output-size limit.',
      );
    }
    return graphExportJsonSchema.parse(serialized);
  }
}

interface GraphBuildContext {
  readonly throwIfCancelled: () => void;
  readonly cooperate: (processed: number, forceYield?: boolean) => Promise<void>;
  readonly report: (phase: GraphBuildProgress['phase'], processed: number, total: number) => void;
  readonly checkpoint: (
    phase: GraphBuildProgress['phase'],
    processed: number,
    total: number,
  ) => Promise<void>;
}

function createBuildContext(
  metadata: Pick<GraphExport, 'projectId' | 'analysisId' | 'scanId'>,
  options: GraphBuildOptions,
): GraphBuildContext {
  const progressMetadata = {
    projectId: metadata.projectId,
    analysisId: metadata.analysisId,
    scanId: metadata.scanId,
  };
  const requestedBatchSize = options.batchSize ?? 500;
  const configuredBatchSize = Number.isFinite(requestedBatchSize)
    ? Math.floor(requestedBatchSize)
    : 500;
  const batchSize = Math.max(1, Math.min(10_000, configuredBatchSize));
  const throwIfCancelled = (): void => {
    if (options.signal?.aborted === true) {
      throw new GraphBuildCancelledError();
    }
  };
  const cooperate = async (processed: number, forceYield = false): Promise<void> => {
    throwIfCancelled();
    if (options.yieldToEventLoop !== undefined && (forceYield || processed % batchSize === 0)) {
      await options.yieldToEventLoop();
      throwIfCancelled();
    }
  };
  const report = (phase: GraphBuildProgress['phase'], processed: number, total: number): void => {
    if (options.onProgress === undefined) {
      return;
    }
    const parsed = graphBuildProgressSchema.safeParse({
      ...progressMetadata,
      phase,
      processed,
      total,
      percentage: total === 0 ? 100 : Math.floor((processed / total) * 100),
    });
    if (!parsed.success) {
      return;
    }
    try {
      options.onProgress(parsed.data);
    } catch {
      // Progress observers cannot interrupt graph construction.
    }
  };
  const checkpoint = async (
    phase: GraphBuildProgress['phase'],
    processed: number,
    total: number,
  ): Promise<void> => {
    throwIfCancelled();
    const isCheckpoint = processed % batchSize === 0 || processed === total;
    if (isCheckpoint) {
      report(phase, processed, total);
      await cooperate(processed, processed === total);
    }
  };
  return { throwIfCancelled, cooperate, report, checkpoint };
}

/** Builds a graph only from a validated Phase 4 AnalysisResult; it never scans or parses source. */
export async function buildProjectGraph(
  analysisInput: AnalysisResult,
  options: GraphBuildOptions = {},
): Promise<ProjectGraph> {
  let analysis: AnalysisResult;
  try {
    analysis = analysisResultSchema.parse(analysisInput);
  } catch {
    throw new GraphEngineError(
      'INVALID_ANALYSIS',
      'The supplied Phase 4 analysis result does not match its shared schema.',
    );
  }
  if (analysis.status !== 'completed' && analysis.status !== 'partial') {
    throw new GraphEngineError(
      'INVALID_ANALYSIS',
      'Graph construction requires completed or partial static analysis, not a failed or cancelled result.',
    );
  }
  if (analysis.filesAnalyzed === 0 || analysis.analyzedFiles.length === 0) {
    throw new GraphEngineError(
      'INVALID_ANALYSIS',
      'Static analysis did not produce any analyzed source files for a project graph.',
    );
  }

  const context = createBuildContext(
    {
      projectId: analysis.projectId,
      analysisId: analysis.analysisId,
      scanId: analysis.scanId,
    },
    options,
  );
  context.throwIfCancelled();
  let constructionWork = 0;
  const records = await normalizeRecords(analysis, context);
  await validateRelationships(records, context);

  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const filePaths = new Set<string>(analysis.analyzedFiles);
  const exportedSymbolIds = new Set(records.exports.flatMap((item) => item.symbolIds));

  const addNode = (candidate: GraphNode): void => {
    const node = graphNodeSchema.parse(candidate);
    addUniqueRecord(nodes, node, 'node');
  };
  const addEdge = (candidate: GraphEdge): void => {
    const edge = graphEdgeSchema.parse(candidate);
    addUniqueRecord(edges, edge, 'edge');
  };
  const addFilePath = (path: string): void => {
    filePaths.add(path);
  };

  for (const symbol of records.symbols) {
    await context.cooperate(++constructionWork);
    addFilePath(symbol.location.filePath);
  }
  for (const item of records.imports) {
    await context.cooperate(++constructionWork);
    if (item.filePath !== item.location.filePath) {
      throw new GraphEngineError(
        'INVALID_RELATIONSHIP',
        `Import evidence ${item.id} has a source location in another file.`,
      );
    }
    addFilePath(item.filePath);
  }
  for (const item of records.exports) {
    await context.cooperate(++constructionWork);
    if (item.filePath !== item.location.filePath) {
      throw new GraphEngineError(
        'INVALID_RELATIONSHIP',
        `Export evidence ${item.id} has a source location in another file.`,
      );
    }
    addFilePath(item.filePath);
  }
  for (const dependency of records.dependencies) {
    await context.cooperate(++constructionWork);
    addFilePath(dependency.fromPath);
    if (dependency.resolvedPath !== undefined) {
      addFilePath(dependency.resolvedPath);
    }
  }
  if (records.dependencies.length > GRAPH_ENGINE_LIMITS.maxDependencies) {
    throw new GraphEngineError(
      'GRAPH_LIMIT_REACHED',
      'The graph dependency-reference limit was exceeded.',
    );
  }

  const folderPaths = new Set<string>();
  for (const filePath of filePaths) {
    await context.cooperate(++constructionWork);
    const segments = filePath.split('/');
    if (segments.length > GRAPH_ENGINE_LIMITS.maxPathSegments) {
      throw new GraphEngineError(
        'GRAPH_LIMIT_REACHED',
        'A project-relative file path exceeds the graph folder-depth limit.',
      );
    }
    let current = '';
    for (const segment of segments.slice(0, -1)) {
      await context.cooperate(++constructionWork);
      current = current.length === 0 ? segment : `${current}/${segment}`;
      folderPaths.add(current);
      if (folderPaths.size + filePaths.size + 1 > GRAPH_ENGINE_LIMITS.maxNodes) {
        throw new GraphEngineError('GRAPH_LIMIT_REACHED', 'The graph node limit was exceeded.');
      }
    }
  }
  for (const filePath of filePaths) {
    await context.cooperate(++constructionWork);
    if (folderPaths.has(filePath)) {
      throw new GraphEngineError(
        'INVALID_RELATIONSHIP',
        'A path cannot be both a file and a folder in one analysis result.',
      );
    }
  }

  const projectNodeId = projectNodeIdFor(analysis.projectId);
  addNode({
    id: projectNodeId,
    projectId: analysis.projectId,
    type: 'project',
    name: options.projectName?.trim() || analysis.projectId,
  });

  for (const folderPath of [...folderPaths].sort((left, right) => compareStrings(left, right))) {
    await context.cooperate(++constructionWork);
    addNode({
      id: folderNodeId(folderPath),
      projectId: analysis.projectId,
      type: 'folder',
      name: basename(folderPath),
      relativePath: folderPath,
    });
  }
  for (const filePath of [...filePaths].sort((left, right) => compareStrings(left, right))) {
    await context.cooperate(++constructionWork);
    addNode({
      id: fileNodeId(filePath),
      projectId: analysis.projectId,
      type: 'file',
      name: basename(filePath),
      relativePath: filePath,
    });
  }

  const symbolsById = new Map(records.symbols.map((symbol) => [symbol.id, symbol]));
  const graphSymbolIdBySourceId = new Map<string, string>();
  for (const symbol of records.symbols) {
    await context.cooperate(++constructionWork);
    const type = graphSymbolType(symbol.kind);
    if (type === null) {
      continue;
    }
    const id = graphSymbolNodeId(symbol.id);
    graphSymbolIdBySourceId.set(symbol.id, id);
    addNode({
      id,
      projectId: analysis.projectId,
      type,
      name: symbol.name,
      filePath: symbol.location.filePath,
      symbolId: symbol.id,
      symbolKind: symbol.kind,
      location: symbol.location,
      exported: symbol.exported || exportedSymbolIds.has(symbol.id),
    });
  }

  for (const folderPath of [...folderPaths].sort((left, right) => compareStrings(left, right))) {
    await context.cooperate(++constructionWork);
    const parentPath = dirname(folderPath);
    addEdge({
      id: `contains:folder:${folderPath}`,
      projectId: analysis.projectId,
      type: 'contains',
      sourceId: parentPath.length === 0 ? projectNodeId : folderNodeId(parentPath),
      targetId: folderNodeId(folderPath),
    });
  }
  for (const filePath of [...filePaths].sort((left, right) => compareStrings(left, right))) {
    await context.cooperate(++constructionWork);
    const parentPath = dirname(filePath);
    addEdge({
      id: `contains:file:${filePath}`,
      projectId: analysis.projectId,
      type: 'contains',
      sourceId: parentPath.length === 0 ? projectNodeId : folderNodeId(parentPath),
      targetId: fileNodeId(filePath),
    });
  }

  for (const symbol of records.symbols) {
    await context.cooperate(++constructionWork);
    const targetId = graphSymbolIdBySourceId.get(symbol.id);
    if (targetId === undefined) {
      continue;
    }
    const sourceId = findIncludedSymbolParent(
      symbol,
      symbolsById,
      graphSymbolIdBySourceId,
      fileNodeId(symbol.location.filePath),
    );
    addEdge({
      id: `contains:symbol:${symbol.id}`,
      projectId: analysis.projectId,
      type: 'contains',
      sourceId,
      targetId,
      evidenceId: symbol.id,
      sourceLocation: symbol.location,
    });
  }

  const importById = new Map(records.imports.map((item) => [item.id, item]));
  const dependencyById = new Map(records.dependencies.map((item) => [item.id, item]));
  const dependencyReferenceRecords: GraphDependencyReference[] = [];
  for (const dependency of records.dependencies) {
    await context.cooperate(++constructionWork);
    const importRecord = importById.get(dependency.importId);
    if (importRecord === undefined) {
      throw new GraphEngineError(
        'INVALID_RELATIONSHIP',
        `Dependency evidence ${dependency.id} refers to an import not present in the analysis result.`,
      );
    }
    if (
      importRecord.filePath !== dependency.fromPath ||
      importRecord.specifier !== dependency.specifier
    ) {
      throw new GraphEngineError(
        'INVALID_RELATIONSHIP',
        `Dependency evidence ${dependency.id} does not match its import record.`,
      );
    }
    const fromNodeId = fileNodeId(dependency.fromPath);
    const toNodeId =
      dependency.resolvedPath === undefined ? undefined : fileNodeId(dependency.resolvedPath);
    const reference = graphDependencyReferenceSchema.parse({
      id: `dependency:${dependency.id}`,
      fromNodeId,
      ...(toNodeId === undefined ? {} : { toNodeId }),
      importId: dependency.importId,
      specifier: dependency.specifier,
      kind: dependency.kind,
      ...(dependency.packageName === undefined ? {} : { packageName: dependency.packageName }),
      ...(dependency.reason === undefined ? {} : { reason: dependency.reason }),
      sourceLocation: importRecord.location,
    });
    dependencyReferenceRecords.push(reference);

    if (dependency.kind === 'local' || dependency.kind === 'alias') {
      if (toNodeId === undefined) {
        throw new GraphEngineError(
          'INVALID_RELATIONSHIP',
          `Resolved dependency evidence ${dependency.id} has no target path.`,
        );
      }
      addEdge({
        id: `edge:import:${dependency.id}`,
        projectId: analysis.projectId,
        type: 'imports',
        sourceId: fromNodeId,
        targetId: toNodeId,
        evidenceId: dependency.id,
        sourceLocation: importRecord.location,
        dependencyKind: dependency.kind,
        specifier: dependency.specifier,
        isTypeOnly: importRecord.isTypeOnly,
      });
    }
  }

  for (const exported of records.exports) {
    await context.cooperate(++constructionWork);
    const sourceId = fileNodeId(exported.filePath);
    for (const symbolId of new Set(exported.symbolIds)) {
      await context.cooperate(++constructionWork);
      const targetId = graphSymbolIdBySourceId.get(symbolId);
      if (targetId === undefined) {
        continue;
      }
      const symbol = symbolsById.get(symbolId);
      if (symbol === undefined || symbol.location.filePath !== exported.filePath) {
        throw new GraphEngineError(
          'INVALID_RELATIONSHIP',
          `Export evidence ${exported.id} refers to a symbol outside its source file.`,
        );
      }
      addEdge({
        id: `edge:export:${exported.id}:${symbolId}`,
        projectId: analysis.projectId,
        type: 'exports',
        sourceId,
        targetId,
        evidenceId: exported.id,
        sourceLocation: exported.location,
        name: exported.name,
        isTypeOnly: exported.isTypeOnly,
      });
    }

    if (exported.dependencyId !== undefined) {
      const dependency = dependencyById.get(exported.dependencyId);
      if (dependency === undefined) {
        throw new GraphEngineError(
          'INVALID_RELATIONSHIP',
          `Export evidence ${exported.id} refers to a dependency not present in the analysis result.`,
        );
      }
      if (dependency.fromPath !== exported.filePath) {
        throw new GraphEngineError(
          'INVALID_RELATIONSHIP',
          `Export evidence ${exported.id} links to a dependency from another file.`,
        );
      }
      if (exported.source !== undefined && dependency.specifier !== exported.source) {
        throw new GraphEngineError(
          'INVALID_RELATIONSHIP',
          `Export evidence ${exported.id} does not match its linked dependency specifier.`,
        );
      }
      if (dependency.kind === 'local' || dependency.kind === 'alias') {
        if (dependency.resolvedPath === undefined) {
          throw new GraphEngineError(
            'INVALID_RELATIONSHIP',
            `Resolved re-export evidence ${exported.id} has no target path.`,
          );
        }
        addEdge({
          id: `edge:re-export:${exported.id}:${dependency.id}`,
          projectId: analysis.projectId,
          type: 'exports',
          sourceId,
          targetId: fileNodeId(dependency.resolvedPath),
          evidenceId: exported.id,
          sourceLocation: exported.location,
          dependencyKind: dependency.kind,
          ...(exported.source === undefined ? {} : { specifier: exported.source }),
          name: exported.name,
          isTypeOnly: exported.isTypeOnly,
        });
      }
    }
  }

  if (nodes.size > GRAPH_ENGINE_LIMITS.maxNodes) {
    throw new GraphEngineError('GRAPH_LIMIT_REACHED', 'The graph node limit was exceeded.');
  }
  if (edges.size > GRAPH_ENGINE_LIMITS.maxEdges) {
    throw new GraphEngineError('GRAPH_LIMIT_REACHED', 'The graph edge limit was exceeded.');
  }
  if (dependencyReferenceRecords.length > GRAPH_ENGINE_LIMITS.maxDependencies) {
    throw new GraphEngineError(
      'GRAPH_LIMIT_REACHED',
      'The graph dependency-reference limit was exceeded.',
    );
  }

  return ProjectGraph.create(
    {
      projectId: analysis.projectId,
      analysisId: analysis.analysisId,
      scanId: analysis.scanId,
      analysisStatus: analysis.status,
    },
    [...nodes.values()],
    [...edges.values()],
    dependencyReferenceRecords,
    analysis.filesAnalyzed,
    options,
  );
}
async function normalizeRecords(
  analysis: AnalysisResult,
  context: GraphBuildContext,
): Promise<NormalizedRecords> {
  const total =
    analysis.symbols.length +
    analysis.imports.length +
    analysis.exports.length +
    analysis.dependencies.length;
  let processed = 0;
  const advance = (): number => ++processed;
  context.report('preparing', 0, total);
  const records = {
    symbols: await deduplicateRecords(analysis.symbols, 'symbol', context, advance, total),
    imports: await deduplicateRecords(analysis.imports, 'import', context, advance, total),
    exports: await deduplicateRecords(analysis.exports, 'export', context, advance, total),
    dependencies: await deduplicateRecords(
      analysis.dependencies,
      'dependency',
      context,
      advance,
      total,
    ),
  };
  if (total === 0) {
    context.report('preparing', 0, 0);
  }
  return records;
}

async function deduplicateRecords<T extends { readonly id: string }>(
  records: readonly T[],
  category: string,
  context: GraphBuildContext,
  advance: () => number,
  total: number,
): Promise<T[]> {
  const byId = new Map<string, T>();
  for (const record of records) {
    const existing = byId.get(record.id);
    if (existing === undefined) {
      byId.set(record.id, record);
    } else if (stableSerialize(existing) !== stableSerialize(record)) {
      throw new GraphEngineError(
        'CONFLICTING_DUPLICATE_ID',
        `The analysis result contains conflicting duplicate ${category} IDs.`,
      );
    }
    await context.checkpoint('preparing', advance(), total);
  }
  return [...byId.values()].sort((left, right) => compareStrings(left.id, right.id));
}

async function validateRelationships(
  records: NormalizedRecords,
  context: GraphBuildContext,
): Promise<void> {
  const symbolsById = new Map<string, AnalysisSymbol>();
  const importsById = new Map<string, (typeof records.imports)[number]>();
  const dependenciesById = new Map<string, (typeof records.dependencies)[number]>();
  const dependencyForImport = new Map<string, string>();
  let processed = 0;
  const cooperate = async (): Promise<void> => {
    await context.cooperate(++processed);
  };

  for (const symbol of records.symbols) {
    symbolsById.set(symbol.id, symbol);
    await cooperate();
  }
  for (const importRecord of records.imports) {
    importsById.set(importRecord.id, importRecord);
    await cooperate();
  }
  for (const dependency of records.dependencies) {
    dependenciesById.set(dependency.id, dependency);
    await cooperate();
  }

  for (const symbol of records.symbols) {
    if (symbol.parentId !== undefined) {
      const parent = symbolsById.get(symbol.parentId);
      if (parent === undefined || parent.location.filePath !== symbol.location.filePath) {
        throw new GraphEngineError(
          'INVALID_RELATIONSHIP',
          `Symbol ${symbol.id} has a missing or cross-file parent reference.`,
        );
      }
    }
    await cooperate();
  }
  for (const dependency of records.dependencies) {
    const importRecord = importsById.get(dependency.importId);
    if (importRecord === undefined) {
      throw new GraphEngineError(
        'INVALID_RELATIONSHIP',
        `Dependency evidence ${dependency.id} refers to an import not present in the analysis result.`,
      );
    }
    if (
      importRecord.filePath !== dependency.fromPath ||
      importRecord.specifier !== dependency.specifier
    ) {
      throw new GraphEngineError(
        'INVALID_RELATIONSHIP',
        `Dependency evidence ${dependency.id} does not match its import record.`,
      );
    }
    const existingDependencyId = dependencyForImport.get(dependency.importId);
    if (existingDependencyId !== undefined && existingDependencyId !== dependency.id) {
      throw new GraphEngineError(
        'INVALID_RELATIONSHIP',
        'One import record cannot have multiple conflicting dependency resolutions.',
      );
    }
    dependencyForImport.set(dependency.importId, dependency.id);
    await cooperate();
  }
  for (const exported of records.exports) {
    for (const symbolId of new Set(exported.symbolIds)) {
      const symbol = symbolsById.get(symbolId);
      if (symbol === undefined || symbol.location.filePath !== exported.filePath) {
        throw new GraphEngineError(
          'INVALID_RELATIONSHIP',
          `Export evidence ${exported.id} refers to a missing or cross-file symbol.`,
        );
      }
      await cooperate();
    }
    if (exported.dependencyId !== undefined) {
      const dependency = dependenciesById.get(exported.dependencyId);
      if (
        dependency === undefined ||
        dependency.fromPath !== exported.filePath ||
        (exported.source !== undefined && dependency.specifier !== exported.source)
      ) {
        throw new GraphEngineError(
          'INVALID_RELATIONSHIP',
          `Export evidence ${exported.id} has an invalid dependency reference.`,
        );
      }
    }
    await cooperate();
  }
}

function addUniqueRecord<T extends { readonly id: string }>(
  records: Map<string, T>,
  candidate: T,
  category: string,
): void {
  const existing = records.get(candidate.id);
  if (existing === undefined) {
    if (
      records.size >=
      (category === 'node' ? GRAPH_ENGINE_LIMITS.maxNodes : GRAPH_ENGINE_LIMITS.maxEdges)
    ) {
      throw new GraphEngineError(
        'GRAPH_LIMIT_REACHED',
        `The graph ${category} limit was exceeded.`,
      );
    }
    records.set(candidate.id, candidate);
    return;
  }
  if (stableSerialize(existing) !== stableSerialize(candidate)) {
    throw new GraphEngineError(
      'CONFLICTING_DUPLICATE_ID',
      `The graph contains conflicting duplicate ${category} IDs.`,
    );
  }
}

function findIncludedSymbolParent(
  symbol: AnalysisSymbol,
  symbolsById: ReadonlyMap<string, AnalysisSymbol>,
  graphSymbolIdBySourceId: ReadonlyMap<string, string>,
  fileId: string,
): string {
  let parentId = symbol.parentId;
  const seen = new Set<string>([symbol.id]);
  while (parentId !== undefined) {
    if (seen.has(parentId)) {
      throw new GraphEngineError(
        'INVALID_RELATIONSHIP',
        'The analysis symbol parent chain contains a cycle.',
      );
    }
    seen.add(parentId);
    const parent = symbolsById.get(parentId);
    if (parent === undefined) {
      throw new GraphEngineError(
        'INVALID_RELATIONSHIP',
        'A symbol parent is missing from the analysis result.',
      );
    }
    const graphParentId = graphSymbolIdBySourceId.get(parent.id);
    if (graphParentId !== undefined) {
      return graphParentId;
    }
    parentId = parent.parentId;
  }
  return fileId;
}

function graphSymbolType(kind: AnalysisSymbol['kind']): GraphNode['type'] | null {
  switch (kind) {
    case 'class':
      return 'class';
    case 'function':
    case 'method':
    case 'constructor':
    case 'accessor':
      return 'function';
    case 'interface':
      return 'interface';
    default:
      return null;
  }
}

async function calculateMetrics(
  graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
  dependencyGraph: DirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
  dependencies: readonly GraphDependencyReference[],
  analysisFilesAnalyzed: number,
  context: GraphBuildContext,
): Promise<GraphMetrics> {
  const graphNodes = graph.nodes();
  const graphEdges = graph.edges();
  const dependencyNodes = dependencyGraph.order;
  const dependencyEdges = dependencyGraph.size;
  const metricsTotal =
    graphNodes.length + graphEdges.length + 2 * dependencyNodes + 2 * dependencyEdges;
  const nodeCounts = new Map(graphNodeTypeSchema.options.map((type) => [type, 0]));
  const edgeCounts = new Map(graphEdgeTypeSchema.options.map((type) => [type, 0]));
  const files = dependencyGraph.nodes();
  let dependencyOutDegreeTotal = 0;
  let maxDependenciesPerFile = 0;
  let isolatedFileCount = 0;
  let selfLoopCount = 0;
  let processed = 0;

  context.report('metrics', 0, metricsTotal);
  for (const nodeId of graphNodes) {
    context.throwIfCancelled();
    const type = graph.getNodeAttribute(nodeId, 'type');
    nodeCounts.set(type, (nodeCounts.get(type) ?? 0) + 1);
    if (type === 'file') {
      const outDegree = dependencyGraph.outboundNeighbors(nodeId).length;
      const inDegree = dependencyGraph.inboundNeighbors(nodeId).length;
      dependencyOutDegreeTotal += outDegree;
      maxDependenciesPerFile = Math.max(maxDependenciesPerFile, outDegree);
      if (outDegree === 0 && inDegree === 0) {
        isolatedFileCount += 1;
      }
      if (dependencyGraph.hasDirectedEdge(nodeId, nodeId)) {
        selfLoopCount += 1;
      }
    }
    processed += 1;
    await context.checkpoint('metrics', processed, metricsTotal);
  }
  for (const edgeId of graphEdges) {
    context.throwIfCancelled();
    const type = graph.getEdgeAttribute(edgeId, 'type');
    edgeCounts.set(type, (edgeCounts.get(type) ?? 0) + 1);
    processed += 1;
    await context.checkpoint('metrics', processed, metricsTotal);
  }

  const components = await stronglyConnectedComponentsWithProgress(
    dependencyGraph,
    context,
    processed,
    metricsTotal,
  );
  processed = metricsTotal;
  const cyclicComponentCount = components.filter(
    (component) =>
      component.length > 1 ||
      (component[0] !== undefined && dependencyGraph.hasDirectedEdge(component[0], component[0])),
  ).length;
  const nodesByType = graphNodeTypeSchema.options.map((type) => ({
    type,
    count: nodeCounts.get(type) ?? 0,
  }));
  const edgesByType = graphEdgeTypeSchema.options.map((type) => ({
    type,
    count: edgeCounts.get(type) ?? 0,
  }));
  const metrics = graphMetricsSchema.parse({
    nodeCount: graph.order,
    edgeCount: graph.size,
    nodesByType,
    edgesByType,
    fileCount: nodeCounts.get('file') ?? 0,
    folderCount: nodeCounts.get('folder') ?? 0,
    symbolCount: nodesByType
      .filter((entry) =>
        [
          'component',
          'service',
          'class',
          'function',
          'interface',
          'api-route',
          'database-model',
        ].includes(entry.type),
      )
      .reduce((total, entry) => total + entry.count, 0),
    analysisFilesAnalyzed,
    dependencyEdgeCount: edgeCounts.get('imports') ?? 0,
    uniqueDependencyPairCount: dependencyGraph.size,
    externalDependencyCount: dependencies.filter(
      (dependency) => dependency.kind === 'external-package',
    ).length,
    unresolvedDependencyCount: dependencies.filter((dependency) => dependency.kind === 'unresolved')
      .length,
    isolatedFileCount,
    averageDependenciesPerFile: files.length === 0 ? 0 : dependencyOutDegreeTotal / files.length,
    maxDependenciesPerFile,
    stronglyConnectedComponentCount: components.length,
    cyclicComponentCount,
    selfLoopCount,
  });
  context.report('metrics', processed, metricsTotal);
  context.throwIfCancelled();
  return metrics;
}

function stronglyConnectedComponents(
  graph: DirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
): string[][] {
  const steps = stronglyConnectedComponentSteps(graph);
  let result = steps.next();
  while (!result.done) {
    result = steps.next();
  }
  return result.value;
}

async function stronglyConnectedComponentsWithProgress(
  graph: DirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
  context: GraphBuildContext,
  startProgress: number,
  progressTotal: number,
): Promise<string[][]> {
  const steps = stronglyConnectedComponentSteps(graph);
  let processed = startProgress;
  let result = steps.next();
  while (!result.done) {
    processed += 1;
    await context.checkpoint('metrics', processed, progressTotal);
    result = steps.next();
  }
  return result.value;
}

function* stronglyConnectedComponentSteps(
  graph: DirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
): Generator<void, string[][], void> {
  const nodes = graph.nodes().sort((left, right) => compareStrings(left, right));
  const visited = new Set<string>();
  const finishOrder: string[] = [];

  for (const start of nodes) {
    if (!visited.has(start)) {
      visited.add(start);
      const frames: Array<{
        readonly nodeId: string;
        readonly neighbors: readonly string[];
        nextIndex: number;
      }> = [
        {
          nodeId: start,
          neighbors: graph
            .outboundNeighbors(start)
            .sort((left, right) => compareStrings(left, right)),
          nextIndex: 0,
        },
      ];
      while (frames.length > 0) {
        const frame = frames[frames.length - 1];
        if (frame === undefined) {
          break;
        }
        const neighbor = frame.neighbors[frame.nextIndex];
        if (neighbor !== undefined) {
          frame.nextIndex += 1;
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            frames.push({
              nodeId: neighbor,
              neighbors: graph
                .outboundNeighbors(neighbor)
                .sort((left, right) => compareStrings(left, right)),
              nextIndex: 0,
            });
          }
          yield;
          continue;
        }
        frames.pop();
        finishOrder.push(frame.nodeId);
      }
    }
    yield;
  }

  const assigned = new Set<string>();
  const components: string[][] = [];
  for (let index = finishOrder.length - 1; index >= 0; index -= 1) {
    const start = finishOrder[index];
    if (start !== undefined && !assigned.has(start)) {
      const component: string[] = [];
      const pending = [start];
      assigned.add(start);
      while (pending.length > 0) {
        const nodeId = pending.pop();
        if (nodeId === undefined) {
          continue;
        }
        component.push(nodeId);
        const neighbors = graph
          .inboundNeighbors(nodeId)
          .sort((left, right) => compareStrings(right, left));
        for (const neighbor of neighbors) {
          if (!assigned.has(neighbor)) {
            assigned.add(neighbor);
            pending.push(neighbor);
          }
          yield;
        }
      }
      component.sort((left, right) => compareStrings(left, right));
      components.push(component);
    }
    yield;
  }
  components.sort(compareStringArrays);
  return components;
}

function enumerateSimpleCycles(
  graph: DirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
  components: readonly (readonly string[])[],
  maxCycles: number,
  maxTransitions: number,
): {
  readonly cycles: readonly (readonly string[])[];
  readonly truncated: boolean;
  readonly exploredTransitions: number;
} {
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();
  let exploredTransitions = 0;
  let truncated = false;
  let stop = false;

  for (const component of components) {
    if (stop) {
      break;
    }
    const componentSet = new Set(component);
    for (const start of component) {
      if (stop) {
        break;
      }
      const path = [start];
      const pathSet = new Set(path);
      const firstNeighbors = graph
        .outboundNeighbors(start)
        .filter((neighbor) => componentSet.has(neighbor) && compareStrings(neighbor, start) >= 0)
        .sort((left, right) => compareStrings(left, right));
      const frames: Array<{
        readonly nodeId: string;
        readonly neighbors: readonly string[];
        nextIndex: number;
      }> = [{ nodeId: start, neighbors: firstNeighbors, nextIndex: 0 }];

      while (frames.length > 0 && !stop) {
        const frame = frames[frames.length - 1];
        if (frame === undefined) {
          break;
        }
        if (frame.nextIndex >= frame.neighbors.length) {
          frames.pop();
          if (frame.nodeId !== start) {
            path.pop();
            pathSet.delete(frame.nodeId);
          }
          continue;
        }
        if (exploredTransitions >= maxTransitions) {
          truncated = true;
          stop = true;
          break;
        }
        const neighbor = frame.neighbors[frame.nextIndex];
        frame.nextIndex += 1;
        exploredTransitions += 1;
        if (neighbor === undefined) {
          continue;
        }
        if (neighbor === start) {
          const canonical = canonicalizeCycle(path);
          const key = JSON.stringify(canonical);
          if (!cycleKeys.has(key)) {
            if (cycles.length >= maxCycles) {
              truncated = true;
              stop = true;
            } else {
              cycleKeys.add(key);
              cycles.push(canonical);
            }
          }
          continue;
        }
        if (pathSet.has(neighbor) || compareStrings(neighbor, start) < 0) {
          continue;
        }
        path.push(neighbor);
        pathSet.add(neighbor);
        const nextNeighbors = graph
          .outboundNeighbors(neighbor)
          .filter(
            (candidate) => componentSet.has(candidate) && compareStrings(candidate, start) >= 0,
          )
          .sort((left, right) => compareStrings(left, right));
        frames.push({ nodeId: neighbor, neighbors: nextNeighbors, nextIndex: 0 });
      }
    }
  }

  cycles.sort(compareStringArrays);
  return { cycles, truncated, exploredTransitions };
}

function canonicalizeCycle(cycle: readonly string[]): string[] {
  if (cycle.length <= 1) {
    return [...cycle];
  }
  let smallestIndex = 0;
  for (let index = 1; index < cycle.length; index += 1) {
    if (compareStrings(cycle[index] ?? '', cycle[smallestIndex] ?? '') < 0) {
      smallestIndex = index;
    }
  }
  return [...cycle.slice(smallestIndex), ...cycle.slice(0, smallestIndex)];
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareStringArrays(left: readonly string[], right: readonly string[]): number {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    const comparison = compareStrings(left[index] ?? '', right[index] ?? '');
    if (comparison !== 0) {
      return comparison;
    }
  }
  return left.length - right.length;
}

function getNodeDto(
  graph:
    | MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>
    | DirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
  nodeId: string,
): GraphNode {
  return graphNodeSchema.parse(graph.getNodeAttributes(nodeId));
}

function getEdgeDto(
  graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>,
  edgeId: string,
): GraphEdge {
  return graphEdgeSchema.parse(graph.getEdgeAttributes(edgeId));
}

function freezeNodeAttributes(node: GraphNode): GraphNodeAttributes {
  return Object.freeze({ ...node }) as GraphNodeAttributes;
}

function freezeEdgeAttributes(edge: GraphEdge): GraphEdgeAttributes {
  return Object.freeze({ ...edge }) as GraphEdgeAttributes;
}

function stableSerialize(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      return item.map(sort);
    }
    if (typeof item !== 'object' || item === null) {
      return item;
    }
    const record = item as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => compareStrings(left, right))
        .map((key) => [key, sort(record[key])]),
    );
  };
  return JSON.stringify(sort(value));
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function projectNodeIdFor(projectId: string): string {
  return `project:${projectId}`;
}

function folderNodeId(path: string): string {
  return `folder:${path}`;
}

function fileNodeId(path: string): string {
  return `file:${path}`;
}

function graphSymbolNodeId(symbolId: string): string {
  return `symbol:${symbolId}`;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function dirname(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

function filePathFromNodeId(nodeId: string): string {
  if (!nodeId.startsWith('file:')) {
    throw new GraphEngineError('INVALID_RELATIONSHIP', 'A dependency graph node was not a file.');
  }
  return nodeId.slice('file:'.length);
}
