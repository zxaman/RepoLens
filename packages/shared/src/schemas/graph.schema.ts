import { z } from 'zod';
import { analysisStatusSchema, analysisSymbolKindSchema } from './analysis.schema.js';

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

export const GRAPH_MAX_NODES = 150_000;
export const GRAPH_MAX_EDGES = 400_000;
export const GRAPH_MAX_DEPENDENCIES = 50_000;
export const GRAPH_MAX_JSON_CHARS = 25_000_000;

const safeGraphPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      !path.startsWith('/') &&
      !/^[A-Za-z]:/.test(path) &&
      !hasControlCharacters(path) &&
      !path.includes('\\') &&
      !path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..'),
    'Expected a normalized project-relative path.',
  );

const graphIdSchema = z.string().min(1).max(32_768);
const evidenceIdSchema = z.string().min(1).max(8192);

export const graphNodeTypeSchema = z.enum([
  'project',
  'folder',
  'file',
  'component',
  'service',
  'class',
  'function',
  'interface',
  'api-route',
  'database-model',
]);

export const graphEdgeTypeSchema = z.enum([
  'contains',
  'imports',
  'exports',
  'calls',
  'implements',
  'extends',
  'api-call',
  'uses-model',
]);

export const graphDependencyKindSchema = z.enum([
  'local',
  'alias',
  'external-package',
  'unresolved',
]);

export const graphBuildProgressSchema = z
  .object({
    analysisId: z.uuid(),
    scanId: z.uuid(),
    projectId: z.uuid(),
    phase: z.enum(['preparing', 'nodes', 'edges', 'metrics', 'cancelled']),
    processed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    percentage: z.number().min(0).max(100),
  })
  .strict()
  .superRefine((progress, context) => {
    if (progress.processed > progress.total) {
      context.addIssue({
        code: 'custom',
        path: ['processed'],
        message: 'Graph build progress cannot exceed its phase total.',
      });
    }
    const expectedPercentage =
      progress.phase === 'cancelled'
        ? 0
        : progress.total === 0
          ? 100
          : Math.floor((progress.processed / progress.total) * 100);
    if (
      progress.percentage !== expectedPercentage ||
      (progress.phase === 'cancelled' && (progress.processed !== 0 || progress.total !== 0))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['percentage'],
        message: 'Graph build percentage must match its counters and terminal phase.',
      });
    }
  });

export const graphSourceLocationSchema = z
  .object({
    filePath: safeGraphPathSchema,
    startLine: z.number().int().positive(),
    startColumn: z.number().int().positive(),
    endLine: z.number().int().positive(),
    endColumn: z.number().int().positive(),
  })
  .strict()
  .superRefine((location, context) => {
    if (
      location.endLine < location.startLine ||
      (location.endLine === location.startLine && location.endColumn < location.startColumn)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endLine'],
        message: 'The graph source location end must not precede its start.',
      });
    }
  });

export const graphNodeSchema = z
  .object({
    id: graphIdSchema,
    projectId: z.uuid(),
    type: graphNodeTypeSchema,
    name: z.string().min(1).max(512),
    relativePath: safeGraphPathSchema.optional(),
    filePath: safeGraphPathSchema.optional(),
    symbolId: evidenceIdSchema.optional(),
    symbolKind: analysisSymbolKindSchema.optional(),
    exported: z.boolean().optional(),
    location: graphSourceLocationSchema.optional(),
  })
  .strict()
  .superRefine((node, context) => {
    if (node.type === 'project') {
      if (
        node.id !== `project:${node.projectId}` ||
        node.relativePath !== undefined ||
        node.filePath !== undefined ||
        node.symbolId !== undefined ||
        node.symbolKind !== undefined ||
        node.location !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['type'],
          message: 'Project nodes use a project-derived ID and do not carry source locations.',
        });
      }
      return;
    }

    if (node.type === 'folder' || node.type === 'file') {
      if (
        node.relativePath === undefined ||
        node.id !== `${node.type}:${node.relativePath}` ||
        node.filePath !== undefined ||
        node.symbolId !== undefined ||
        node.symbolKind !== undefined ||
        node.location !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['relativePath'],
          message:
            'Folder and file nodes require a path-derived ID and one normalized relativePath.',
        });
      }
      return;
    }

    if (
      node.filePath === undefined ||
      node.symbolId === undefined ||
      node.id !== `symbol:${node.symbolId}` ||
      node.symbolKind === undefined ||
      node.location === undefined ||
      node.relativePath !== undefined ||
      node.location.filePath !== node.filePath
    ) {
      context.addIssue({
        code: 'custom',
        path: ['filePath'],
        message:
          'Symbol nodes require a source file, symbol identity, kind, and matching location.',
      });
    }
  });

export const graphEdgeSchema = z
  .object({
    id: graphIdSchema,
    projectId: z.uuid(),
    type: graphEdgeTypeSchema,
    sourceId: graphIdSchema,
    targetId: graphIdSchema,
    evidenceId: evidenceIdSchema.optional(),
    sourceLocation: graphSourceLocationSchema.optional(),
    dependencyKind: z.enum(['local', 'alias']).optional(),
    specifier: z.string().min(1).max(4096).optional(),
    name: z.string().min(1).max(512).optional(),
    isTypeOnly: z.boolean().optional(),
  })
  .strict()
  .superRefine((edge, context) => {
    if (edge.type === 'imports') {
      if (
        edge.evidenceId === undefined ||
        edge.sourceLocation === undefined ||
        edge.dependencyKind === undefined ||
        edge.specifier === undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['evidenceId'],
          message:
            'Import edges require analysis evidence, a source location, and a resolved local kind.',
        });
      }
    }
    if (edge.type === 'exports') {
      if (
        edge.evidenceId === undefined ||
        edge.sourceLocation === undefined ||
        edge.name === undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['evidenceId'],
          message: 'Export edges require analysis evidence, a source location, and an export name.',
        });
      }
    }
    if (edge.sourceLocation !== undefined && edge.type !== 'contains') {
      const expectedSource = edge.sourceId.startsWith('file:') ? edge.sourceId.slice(5) : null;
      if (expectedSource !== null && edge.sourceLocation.filePath !== expectedSource) {
        context.addIssue({
          code: 'custom',
          path: ['sourceLocation', 'filePath'],
          message: 'The relationship location must belong to its source file.',
        });
      }
    }
  });

export const graphDependencyReferenceSchema = z
  .object({
    id: graphIdSchema,
    fromNodeId: graphIdSchema,
    toNodeId: graphIdSchema.optional(),
    importId: evidenceIdSchema,
    specifier: z.string().min(1).max(4096),
    kind: graphDependencyKindSchema,
    packageName: z.string().min(1).max(512).optional(),
    reason: z.string().min(1).max(512).optional(),
    sourceLocation: graphSourceLocationSchema,
  })
  .strict()
  .superRefine((dependency, context) => {
    if (!dependency.id.startsWith('dependency:')) {
      context.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'Dependency reference IDs use the stable dependency prefix.',
      });
    }
    const isResolved = dependency.kind === 'local' || dependency.kind === 'alias';
    if (isResolved !== (dependency.toNodeId !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['toNodeId'],
        message: 'Only a resolved local or alias dependency has a target file node.',
      });
    }
    if (dependency.kind === 'external-package' && dependency.packageName === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['packageName'],
        message: 'External dependencies include their package name.',
      });
    }
  });

const graphNodeCountSchema = z
  .object({ type: graphNodeTypeSchema, count: z.number().int().nonnegative() })
  .strict();
const graphEdgeCountSchema = z
  .object({ type: graphEdgeTypeSchema, count: z.number().int().nonnegative() })
  .strict();

export const graphMetricsSchema = z
  .object({
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    nodesByType: z.array(graphNodeCountSchema).max(10).readonly(),
    edgesByType: z.array(graphEdgeCountSchema).max(8).readonly(),
    fileCount: z.number().int().nonnegative(),
    folderCount: z.number().int().nonnegative(),
    symbolCount: z.number().int().nonnegative(),
    analysisFilesAnalyzed: z.number().int().nonnegative(),
    dependencyEdgeCount: z.number().int().nonnegative(),
    uniqueDependencyPairCount: z.number().int().nonnegative(),
    externalDependencyCount: z.number().int().nonnegative(),
    unresolvedDependencyCount: z.number().int().nonnegative(),
    isolatedFileCount: z.number().int().nonnegative(),
    averageDependenciesPerFile: z.number().nonnegative(),
    maxDependenciesPerFile: z.number().int().nonnegative(),
    stronglyConnectedComponentCount: z.number().int().nonnegative(),
    cyclicComponentCount: z.number().int().nonnegative(),
    selfLoopCount: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((metrics, context) => {
    if (
      metrics.nodesByType.reduce((total, entry) => total + entry.count, 0) !== metrics.nodeCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['nodesByType'],
        message: 'Node-type counts must sum to nodeCount.',
      });
    }
    if (
      metrics.edgesByType.reduce((total, entry) => total + entry.count, 0) !== metrics.edgeCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['edgesByType'],
        message: 'Edge-type counts must sum to edgeCount.',
      });
    }
    if (
      new Set(metrics.nodesByType.map((entry) => entry.type)).size !== metrics.nodesByType.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['nodesByType'],
        message: 'Node types in graph metrics must be unique.',
      });
    }
    if (
      new Set(metrics.edgesByType.map((entry) => entry.type)).size !== metrics.edgesByType.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['edgesByType'],
        message: 'Edge types in graph metrics must be unique.',
      });
    }
  });

export const graphSummarySchema = z
  .object({
    projectId: z.uuid(),
    analysisId: z.uuid(),
    scanId: z.uuid(),
    analysisStatus: analysisStatusSchema,
    metrics: graphMetricsSchema,
  })
  .strict();

export const graphExportSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    projectId: z.uuid(),
    analysisId: z.uuid(),
    scanId: z.uuid(),
    analysisStatus: analysisStatusSchema,
    metrics: graphMetricsSchema,
    nodes: z.array(graphNodeSchema).max(GRAPH_MAX_NODES).readonly(),
    edges: z.array(graphEdgeSchema).max(GRAPH_MAX_EDGES).readonly(),
    dependencies: z.array(graphDependencyReferenceSchema).max(GRAPH_MAX_DEPENDENCIES).readonly(),
  })
  .strict()
  .superRefine((graph, context) => {
    if (graph.metrics.nodeCount !== graph.nodes.length) {
      context.addIssue({
        code: 'custom',
        path: ['metrics', 'nodeCount'],
        message: 'Exported nodeCount must match the exported node list.',
      });
    }
    if (graph.metrics.edgeCount !== graph.edges.length) {
      context.addIssue({
        code: 'custom',
        path: ['metrics', 'edgeCount'],
        message: 'Exported edgeCount must match the exported edge list.',
      });
    }

    const nodes = new Map<string, z.infer<typeof graphNodeSchema>>();
    const nodeTypeCounts = new Map<string, number>();
    for (const [index, node] of graph.nodes.entries()) {
      nodeTypeCounts.set(node.type, (nodeTypeCounts.get(node.type) ?? 0) + 1);
      if (node.projectId !== graph.projectId) {
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'projectId'],
          message: 'Every exported graph node must belong to the graph project.',
        });
      }
      if (nodes.has(node.id)) {
        context.addIssue({
          code: 'custom',
          path: ['nodes', index, 'id'],
          message: 'Exported graph node IDs must be unique.',
        });
      } else {
        nodes.set(node.id, node);
      }
    }

    const edgeIds = new Set<string>();
    const edgeTypeCounts = new Map<string, number>();
    const dependencyPairs = new Set<string>();
    const resolvedImportEvidence = new Set<string>();
    const dependencyOutDegree = new Map<string, number>();
    const dependencyInDegree = new Map<string, number>();
    for (const node of nodes.values()) {
      if (node.type === 'file') {
        dependencyOutDegree.set(node.id, 0);
        dependencyInDegree.set(node.id, 0);
      }
    }
    let importEdgeCount = 0;
    let selfLoopCount = 0;
    for (const [index, edge] of graph.edges.entries()) {
      edgeTypeCounts.set(edge.type, (edgeTypeCounts.get(edge.type) ?? 0) + 1);
      if (edge.projectId !== graph.projectId) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index, 'projectId'],
          message: 'Every exported graph edge must belong to the graph project.',
        });
      }
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index, 'id'],
          message: 'Exported graph edge IDs must be unique.',
        });
      } else {
        edgeIds.add(edge.id);
      }
      if (!nodes.has(edge.sourceId) || !nodes.has(edge.targetId)) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index],
          message: 'Every exported graph edge must reference existing nodes.',
        });
      }
      const source = nodes.get(edge.sourceId);
      const target = nodes.get(edge.targetId);
      if (edge.type === 'imports') {
        importEdgeCount += 1;
        if (source?.type !== 'file' || target?.type !== 'file') {
          context.addIssue({
            code: 'custom',
            path: ['edges', index],
            message: 'Resolved import edges must connect file nodes.',
          });
        } else {
          resolvedImportEvidence.add(
            JSON.stringify([edge.evidenceId, edge.sourceId, edge.targetId]),
          );
          const pair = JSON.stringify([edge.sourceId, edge.targetId]);
          if (!dependencyPairs.has(pair)) {
            dependencyPairs.add(pair);
            dependencyOutDegree.set(
              edge.sourceId,
              (dependencyOutDegree.get(edge.sourceId) ?? 0) + 1,
            );
            dependencyInDegree.set(edge.targetId, (dependencyInDegree.get(edge.targetId) ?? 0) + 1);
            if (edge.sourceId === edge.targetId) {
              selfLoopCount += 1;
            }
          }
        }
      }
      if (
        edge.type === 'exports' &&
        (source?.type !== 'file' ||
          (target?.type !== 'file' &&
            ![
              'component',
              'service',
              'class',
              'function',
              'interface',
              'api-route',
              'database-model',
            ].includes(target?.type ?? '')))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['edges', index],
          message: 'Export edges must originate at a file and target a file or symbol node.',
        });
      }
    }

    const dependencyIds = new Set<string>();
    for (const [index, dependency] of graph.dependencies.entries()) {
      if (dependencyIds.has(dependency.id)) {
        context.addIssue({
          code: 'custom',
          path: ['dependencies', index, 'id'],
          message: 'Exported dependency reference IDs must be unique.',
        });
      } else {
        dependencyIds.add(dependency.id);
      }
      const source = nodes.get(dependency.fromNodeId);
      const target = dependency.toNodeId === undefined ? undefined : nodes.get(dependency.toNodeId);
      if (
        source?.type !== 'file' ||
        (dependency.toNodeId !== undefined && target?.type !== 'file')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['dependencies', index],
          message: 'Dependency references must point from and to file nodes.',
        });
      }
      if (source?.type === 'file' && dependency.fromNodeId !== `file:${source.relativePath}`) {
        context.addIssue({
          code: 'custom',
          path: ['dependencies', index, 'fromNodeId'],
          message: 'A dependency source ID must be derived from its file path.',
        });
      }
      if (target?.type === 'file' && dependency.toNodeId !== `file:${target.relativePath}`) {
        context.addIssue({
          code: 'custom',
          path: ['dependencies', index, 'toNodeId'],
          message: 'A dependency target ID must be derived from its resolved file path.',
        });
      }
      if (
        dependency.toNodeId !== undefined &&
        !resolvedImportEvidence.has(
          JSON.stringify([
            dependency.id.slice('dependency:'.length),
            dependency.fromNodeId,
            dependency.toNodeId,
          ]),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['dependencies', index],
          message: 'Every resolved dependency reference must match an evidence-backed import edge.',
        });
      }
      if (dependency.sourceLocation.filePath !== source?.relativePath) {
        context.addIssue({
          code: 'custom',
          path: ['dependencies', index, 'sourceLocation', 'filePath'],
          message: 'Dependency evidence must belong to its source file node.',
        });
      }
    }

    const declaredNodeCounts = new Map(
      graph.metrics.nodesByType.map(({ type, count }) => [type, count]),
    );
    for (const type of graphNodeTypeSchema.options) {
      if (declaredNodeCounts.get(type) !== (nodeTypeCounts.get(type) ?? 0)) {
        context.addIssue({
          code: 'custom',
          path: ['metrics', 'nodesByType'],
          message: 'Exported node-type metrics must match the exported node list.',
        });
        break;
      }
    }
    const declaredEdgeCounts = new Map(
      graph.metrics.edgesByType.map(({ type, count }) => [type, count]),
    );
    for (const type of graphEdgeTypeSchema.options) {
      if (declaredEdgeCounts.get(type) !== (edgeTypeCounts.get(type) ?? 0)) {
        context.addIssue({
          code: 'custom',
          path: ['metrics', 'edgesByType'],
          message: 'Exported edge-type metrics must match the exported edge list.',
        });
        break;
      }
    }

    const fileCount = dependencyOutDegree.size;
    const folderCount = [...nodes.values()].filter((node) => node.type === 'folder').length;
    const symbolCount = [...nodes.values()].filter((node) =>
      [
        'component',
        'service',
        'class',
        'function',
        'interface',
        'api-route',
        'database-model',
      ].includes(node.type),
    ).length;
    const isolatedFileCount = [...dependencyOutDegree.keys()].filter(
      (nodeId) => dependencyOutDegree.get(nodeId) === 0 && dependencyInDegree.get(nodeId) === 0,
    ).length;
    let maxDependenciesPerFile = 0;
    for (const outDegree of dependencyOutDegree.values()) {
      maxDependenciesPerFile = Math.max(maxDependenciesPerFile, outDegree);
    }
    const averageDependenciesPerFile = fileCount === 0 ? 0 : dependencyPairs.size / fileCount;
    const externalDependencyCount = graph.dependencies.filter(
      (dependency) => dependency.kind === 'external-package',
    ).length;
    const unresolvedDependencyCount = graph.dependencies.filter(
      (dependency) => dependency.kind === 'unresolved',
    ).length;
    if (
      graph.metrics.fileCount !== fileCount ||
      graph.metrics.folderCount !== folderCount ||
      graph.metrics.symbolCount !== symbolCount ||
      graph.metrics.dependencyEdgeCount !== importEdgeCount ||
      graph.metrics.uniqueDependencyPairCount !== dependencyPairs.size ||
      graph.metrics.externalDependencyCount !== externalDependencyCount ||
      graph.metrics.unresolvedDependencyCount !== unresolvedDependencyCount ||
      graph.metrics.isolatedFileCount !== isolatedFileCount ||
      graph.metrics.maxDependenciesPerFile !== maxDependenciesPerFile ||
      graph.metrics.averageDependenciesPerFile !== averageDependenciesPerFile ||
      graph.metrics.selfLoopCount !== selfLoopCount
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metrics'],
        message: 'Exported graph metrics must match the exported graph relationships.',
      });
    }
    if (
      (fileCount === 0 && graph.metrics.stronglyConnectedComponentCount !== 0) ||
      (fileCount > 0 &&
        (graph.metrics.stronglyConnectedComponentCount < 1 ||
          graph.metrics.stronglyConnectedComponentCount > fileCount)) ||
      graph.metrics.cyclicComponentCount > graph.metrics.stronglyConnectedComponentCount ||
      graph.metrics.selfLoopCount > dependencyPairs.size
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metrics', 'stronglyConnectedComponentCount'],
        message: 'SCC and cycle metrics must be possible for the exported file graph.',
      });
    }
  });

export const graphNodeQuerySchema = z
  .object({
    types: z.array(graphNodeTypeSchema).max(10).optional(),
    name: z.string().trim().min(1).max(256).optional(),
    pathPrefix: safeGraphPathSchema.optional(),
    exported: z.boolean().optional(),
    limit: z.number().int().min(1).max(1000).default(100),
    offset: z.number().int().min(0).max(GRAPH_MAX_NODES).default(0),
  })
  .strict();

export const graphNodeQueryResultSchema = z
  .object({
    nodes: z.array(graphNodeSchema).max(1000).readonly(),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  })
  .strict();

export const graphDependencyQuerySchema = z
  .object({
    relativePath: safeGraphPathSchema,
    direction: z.enum(['dependencies', 'dependents']).default('dependencies'),
    depth: z.number().int().min(1).max(100).default(1),
  })
  .strict();

export const graphTraversalResultSchema = z
  .object({
    startPath: safeGraphPathSchema,
    direction: z.enum(['dependencies', 'dependents']),
    depth: z.number().int().min(1).max(100),
    files: z
      .array(
        z
          .object({
            relativePath: safeGraphPathSchema,
            distance: z.number().int().positive().max(100),
          })
          .strict(),
      )
      .max(GRAPH_MAX_NODES)
      .readonly(),
  })
  .strict();

export const graphPathQuerySchema = z
  .object({
    fromPath: safeGraphPathSchema,
    toPath: safeGraphPathSchema,
  })
  .strict();

export const graphPathResultSchema = z
  .object({
    fromPath: safeGraphPathSchema,
    toPath: safeGraphPathSchema,
    hops: z.number().int().nonnegative(),
    filePaths: z.array(safeGraphPathSchema).min(1).max(GRAPH_MAX_NODES).readonly(),
  })
  .strict()
  .superRefine((result, context) => {
    if (
      result.filePaths[0] !== result.fromPath ||
      result.filePaths[result.filePaths.length - 1] !== result.toPath ||
      result.hops !== result.filePaths.length - 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['filePaths'],
        message:
          'A dependency path must be continuous from its start to end and match its hop count.',
      });
    }
  });

export const graphCycleQuerySchema = z
  .object({
    maxCycles: z.number().int().min(1).max(1000).default(100),
  })
  .strict();

export const graphCycleReportSchema = z
  .object({
    projectId: z.uuid(),
    analysisId: z.uuid(),
    stronglyConnectedComponentCount: z.number().int().nonnegative(),
    cyclicComponents: z
      .array(z.array(safeGraphPathSchema).min(1).max(GRAPH_MAX_NODES).readonly())
      .max(GRAPH_MAX_NODES)
      .readonly(),
    cycles: z
      .array(z.array(safeGraphPathSchema).min(1).max(GRAPH_MAX_NODES).readonly())
      .max(1000)
      .readonly(),
    maxCycles: z.number().int().positive().max(1000),
    truncated: z.boolean(),
    exploredTransitions: z.number().int().nonnegative(),
  })
  .strict();

export const graphDisposeResultSchema = z.object({ disposed: z.literal(true) }).strict();

export const graphExportJsonSchema = z
  .string()
  .max(GRAPH_MAX_JSON_CHARS)
  .superRefine((serialized, context) => {
    let value: unknown;
    try {
      value = JSON.parse(serialized) as unknown;
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'The graph export response must be valid JSON.',
      });
      return;
    }
    if (!graphExportSchema.safeParse(value).success) {
      context.addIssue({
        code: 'custom',
        message: 'The graph export response does not match the validated graph schema.',
      });
    }
  });

export type GraphBuildProgress = z.infer<typeof graphBuildProgressSchema>;
export type GraphNodeType = z.infer<typeof graphNodeTypeSchema>;
export type GraphEdgeType = z.infer<typeof graphEdgeTypeSchema>;
export type GraphDependencyKind = z.infer<typeof graphDependencyKindSchema>;
export type GraphSourceLocation = z.infer<typeof graphSourceLocationSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphDependencyReference = z.infer<typeof graphDependencyReferenceSchema>;
export type GraphMetrics = z.infer<typeof graphMetricsSchema>;
export type GraphSummary = z.infer<typeof graphSummarySchema>;
export type GraphExport = z.infer<typeof graphExportSchema>;
export type GraphNodeQuery = z.input<typeof graphNodeQuerySchema>;
export type GraphNodeQueryResult = z.infer<typeof graphNodeQueryResultSchema>;
export type GraphDependencyQuery = z.input<typeof graphDependencyQuerySchema>;
export type GraphTraversalResult = z.infer<typeof graphTraversalResultSchema>;
export type GraphPathQuery = z.input<typeof graphPathQuerySchema>;
export type GraphPathResult = z.infer<typeof graphPathResultSchema>;
export type GraphCycleQuery = z.input<typeof graphCycleQuerySchema>;
export type GraphCycleReport = z.infer<typeof graphCycleReportSchema>;
