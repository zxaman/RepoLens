import {
  Component,
  ElementRef,
  InjectionToken,
  NgZone,
  ViewChild,
  inject,
  input,
  signal,
} from '@angular/core';
import type { AfterViewInit, OnDestroy } from '@angular/core';
import cytoscape from 'cytoscape';
import {
  GRAPH_MAX_NEIGHBORHOOD_DEPTH,
  GRAPH_MAX_NEIGHBORHOOD_NODES,
  graphNodeQuerySchema,
  type GraphEdge,
  type GraphEdgeType,
  type GraphNeighborhoodQuery,
  type GraphNode,
  type GraphNodeQuery,
  type GraphNodeType,
  type GraphSummary,
} from '@repolens/shared';
import { GraphService } from '../services/graph.service';

export const GRAPH_NODE_TYPES: readonly GraphNodeType[] = [
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
];

export const GRAPH_EDGE_TYPES: readonly GraphEdgeType[] = [
  'contains',
  'imports',
  'exports',
  'calls',
  'implements',
  'extends',
  'api-call',
  'uses-model',
];

const SEARCH_PAGE_SIZE = 100;
const MAX_SEARCH_SCENE_NODES = 600;
const INITIAL_NEIGHBORHOOD_LIMIT = 180;
const DEFAULT_NEIGHBORHOOD_DEPTH = 2;

export type CytoscapeFactory = (options: cytoscape.CytoscapeOptions) => cytoscape.Core;

export const CYTOSCAPE_FACTORY = new InjectionToken<CytoscapeFactory>(
  'RepoLens Cytoscape factory',
  {
    factory: () => cytoscape,
  },
);

type ExplorerStatus = 'loading' | 'success' | 'empty' | 'error';
type ExplorerMode = 'overview' | 'neighborhood' | 'search';
type NeighborhoodDirection = NonNullable<GraphNeighborhoodQuery['direction']>;

interface CytoscapeElementBundle {
  readonly elements: cytoscape.ElementDefinition[];
  readonly nodeElementIdByGraphId: ReadonlyMap<string, string>;
  readonly edgeElementIdByGraphId: ReadonlyMap<string, string>;
}

/**
 * Interactive, bounded renderer for validated graph DTOs. The main process remains authoritative:
 * this component requests one neighborhood or one search page at a time and never receives a
 * Graphology instance or silently drops graph data.
 */
@Component({
  selector: 'app-graph-visualization',
  standalone: true,
  templateUrl: './graph-visualization.component.html',
  styleUrl: './graph-visualization.component.scss',
})
export class GraphVisualizationComponent implements AfterViewInit, OnDestroy {
  readonly projectId = input.required<string>();
  readonly summary = input.required<GraphSummary>();

  readonly nodeTypes = GRAPH_NODE_TYPES;
  readonly edgeTypes = GRAPH_EDGE_TYPES;
  readonly neighborhoodNodeLimit = GRAPH_MAX_NEIGHBORHOOD_NODES;
  readonly neighborhoodDepthLimit = GRAPH_MAX_NEIGHBORHOOD_DEPTH;
  readonly status = signal<ExplorerStatus>('loading');
  readonly mode = signal<ExplorerMode>('overview');
  readonly nodes = signal<readonly GraphNode[]>([]);
  readonly edges = signal<readonly GraphEdge[]>([]);
  readonly selectedNode = signal<GraphNode | null>(null);
  readonly selectedEdge = signal<GraphEdge | null>(null);
  readonly queryError = signal('');
  readonly neighborhoodLoading = signal(false);
  readonly searchLoading = signal(false);
  readonly searchName = signal('');
  readonly searchPath = signal('');
  readonly searchTotal = signal(0);
  readonly searchLoaded = signal(0);
  readonly searchHasMore = signal(false);
  readonly nodeTypeFilters = signal<readonly GraphNodeType[]>([...GRAPH_NODE_TYPES]);
  readonly edgeTypeFilters = signal<readonly GraphEdgeType[]>([...GRAPH_EDGE_TYPES]);
  readonly neighborhoodDepth = signal(DEFAULT_NEIGHBORHOOD_DEPTH);
  readonly neighborhoodDirection = signal<NeighborhoodDirection>('both');
  readonly neighborhoodNodesTruncated = signal(false);
  readonly neighborhoodEdgesTruncated = signal(false);

  @ViewChild('graphCanvas', { static: true })
  private graphCanvas!: ElementRef<HTMLDivElement>;

  private readonly graphService = inject(GraphService);
  private readonly cytoscapeFactory = inject(CYTOSCAPE_FACTORY);
  private readonly zone = inject(NgZone);
  private cy: cytoscape.Core | null = null;
  private nodeElementIdByGraphId = new Map<string, string>();
  private edgeElementIdByGraphId = new Map<string, string>();
  private resizeObserver: ResizeObserver | null = null;
  private layoutTimer: number | null = null;
  private destroyed = false;
  private searchRevision = 0;
  private neighborhoodRevision = 0;
  private activeSearchQuery: GraphNodeQuery | null = null;

  ngAfterViewInit(): void {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.cy?.resize());
      this.resizeObserver.observe(this.graphCanvas.nativeElement);
    }
    void this.loadOverview();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.searchRevision += 1;
    this.neighborhoodRevision += 1;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.layoutTimer !== null) {
      window.clearTimeout(this.layoutTimer);
      this.layoutTimer = null;
    }
    this.destroyCytoscape();
  }

  async loadOverview(): Promise<void> {
    const projectId = this.projectId();
    if (projectId.length === 0) {
      this.setError('A project ID is required to load its architecture graph.');
      return;
    }
    await this.loadNeighborhood(`project:${projectId}`, 'overview', {
      depth: DEFAULT_NEIGHBORHOOD_DEPTH,
      direction: 'both',
      limit: INITIAL_NEIGHBORHOOD_LIMIT,
    });
  }

  async returnToOverview(): Promise<void> {
    const projectId = this.projectId();
    if (projectId.length === 0) {
      return;
    }
    await this.loadNeighborhood(`project:${projectId}`, 'overview', {
      depth: DEFAULT_NEIGHBORHOOD_DEPTH,
      direction: 'both',
      limit: INITIAL_NEIGHBORHOOD_LIMIT,
    });
  }

  async retryLoad(): Promise<void> {
    if (this.mode() === 'search') {
      await this.searchGraph();
      return;
    }
    if (this.mode() === 'neighborhood' && this.selectedNode() !== null) {
      await this.exploreSelectedNode();
      return;
    }
    await this.loadOverview();
  }

  async searchGraph(event?: Event): Promise<void> {
    event?.preventDefault();
    this.neighborhoodRevision += 1;
    this.neighborhoodLoading.set(false);
    const revision = ++this.searchRevision;
    this.searchLoading.set(true);
    this.queryError.set('');
    this.searchHasMore.set(false);
    this.searchTotal.set(0);
    this.searchLoaded.set(0);
    this.activeSearchQuery = null;

    const name = this.searchName().trim();
    const pathPrefix = this.searchPath().trim();
    const query: GraphNodeQuery = {
      types: [...this.nodeTypeFilters()],
      ...(name.length === 0 ? {} : { name }),
      ...(pathPrefix.length === 0 ? {} : { pathPrefix }),
      limit: SEARCH_PAGE_SIZE,
      offset: 0,
    };
    const parsedQuery = graphNodeQuerySchema.safeParse(query);
    if (!parsedQuery.success) {
      this.queryError.set(
        'Use a project-relative path without empty, dot, or parent-directory segments, and a search term of at most 256 characters.',
      );
      this.searchLoading.set(false);
      return;
    }

    this.mode.set('search');
    this.activeSearchQuery = parsedQuery.data;
    try {
      const page = await this.graphService.query(this.projectId(), parsedQuery.data);
      if (revision !== this.searchRevision || this.destroyed) {
        return;
      }
      if (page === null) {
        throw new Error('Graph data is no longer available in memory. Generate the graph again.');
      }
      this.validateGraphData(page.nodes, page.edges);
      this.mode.set('search');
      this.searchTotal.set(page.total);
      this.searchLoaded.set(page.nodes.length);
      this.searchHasMore.set(page.nodes.length < page.total);
      this.neighborhoodNodesTruncated.set(false);
      this.neighborhoodEdgesTruncated.set(page.edgesTruncated);
      this.replaceGraphData(page.nodes, page.edges, page.nodes.length > 0 ? 'success' : 'empty');
      if (page.nodes.length > 0) {
        this.selectNodeById(page.nodes[0]?.id ?? '');
        this.focusNode(page.nodes[0]?.id ?? '');
      }
    } catch (error) {
      if (revision === this.searchRevision && !this.destroyed) {
        this.queryError.set(
          error instanceof Error ? error.message : 'RepoLens could not search the graph.',
        );
        this.status.set('error');
      }
    } finally {
      if (revision === this.searchRevision && !this.destroyed) {
        this.searchLoading.set(false);
      }
    }
  }

  async loadMoreSearchResults(): Promise<void> {
    this.neighborhoodRevision += 1;
    this.neighborhoodLoading.set(false);
    const offset = this.searchLoaded();
    const remainingCapacity = MAX_SEARCH_SCENE_NODES - offset;
    const activeQuery = this.activeSearchQuery;
    if (
      !this.searchHasMore() ||
      remainingCapacity <= 0 ||
      this.searchLoading() ||
      activeQuery === null
    ) {
      return;
    }

    const revision = ++this.searchRevision;
    this.searchLoading.set(true);
    this.queryError.set('');
    const parsedQuery = graphNodeQuerySchema.safeParse({
      ...activeQuery,
      limit: Math.min(SEARCH_PAGE_SIZE, remainingCapacity),
      offset,
    });
    if (!parsedQuery.success) {
      this.queryError.set('The current graph filters are invalid. Update them and search again.');
      this.searchLoading.set(false);
      return;
    }

    try {
      const page = await this.graphService.query(this.projectId(), parsedQuery.data);
      if (revision !== this.searchRevision || this.destroyed) {
        return;
      }
      if (page === null) {
        throw new Error('Graph data is no longer available in memory. Generate the graph again.');
      }
      this.validateGraphData(page.nodes, page.edges);
      const merged = this.mergeGraphData(this.nodes(), this.edges(), page.nodes, page.edges);
      this.searchLoaded.set(offset + page.nodes.length);
      this.searchTotal.set(page.total);
      this.searchHasMore.set(offset + page.nodes.length < page.total);
      this.neighborhoodEdgesTruncated.set(this.neighborhoodEdgesTruncated() || page.edgesTruncated);
      this.replaceGraphData(
        merged.nodes,
        merged.edges,
        merged.nodes.length > 0 ? 'success' : 'empty',
      );
    } catch (error) {
      if (revision === this.searchRevision && !this.destroyed) {
        this.queryError.set(
          error instanceof Error ? error.message : 'RepoLens could not load more graph matches.',
        );
      }
    } finally {
      if (revision === this.searchRevision && !this.destroyed) {
        this.searchLoading.set(false);
      }
    }
  }

  async exploreSelectedNode(): Promise<void> {
    const selected = this.selectedNode();
    if (selected === null) {
      return;
    }
    const edgeTypes = this.edgeTypeFilters();
    const query: Omit<GraphNeighborhoodQuery, 'nodeId'> = {
      direction: this.neighborhoodDirection(),
      depth: this.neighborhoodDepth(),
      limit: GRAPH_MAX_NEIGHBORHOOD_NODES,
      ...(edgeTypes.length === GRAPH_EDGE_TYPES.length ? {} : { edgeTypes: [...edgeTypes] }),
    };
    await this.loadNeighborhood(selected.id, 'neighborhood', query);
  }

  setNeighborhoodDepth(value: string): void {
    const depth = Number(value);
    if (Number.isInteger(depth) && depth >= 1 && depth <= GRAPH_MAX_NEIGHBORHOOD_DEPTH) {
      this.neighborhoodDepth.set(depth);
    }
  }

  setNeighborhoodDirection(value: string): void {
    if (value === 'both' || value === 'outgoing' || value === 'incoming') {
      this.neighborhoodDirection.set(value);
    }
  }

  toggleNodeType(type: GraphNodeType, checked: boolean): void {
    this.nodeTypeFilters.update((current) => {
      const selected = new Set(current);
      if (checked) {
        selected.add(type);
      } else {
        selected.delete(type);
      }
      return GRAPH_NODE_TYPES.filter((nodeType) => selected.has(nodeType));
    });
    this.applyFilters();
    if (this.mode() === 'search') {
      void this.searchGraph();
    }
  }

  toggleEdgeType(type: GraphEdgeType, checked: boolean): void {
    this.edgeTypeFilters.update((current) => {
      const selected = new Set(current);
      if (checked) {
        selected.add(type);
      } else {
        selected.delete(type);
      }
      return GRAPH_EDGE_TYPES.filter((edgeType) => selected.has(edgeType));
    });
    this.applyFilters();
  }

  isNodeTypeVisible(type: GraphNodeType): boolean {
    return this.nodeTypeFilters().includes(type);
  }

  isEdgeTypeVisible(type: GraphEdgeType): boolean {
    return this.edgeTypeFilters().includes(type);
  }

  resetFilters(): void {
    this.nodeTypeFilters.set([...GRAPH_NODE_TYPES]);
    this.edgeTypeFilters.set([...GRAPH_EDGE_TYPES]);
    this.applyFilters();
    if (this.mode() === 'search') {
      void this.searchGraph();
    }
  }

  selectNodeById(graphId: string): void {
    const node = this.nodes().find((candidate) => candidate.id === graphId) ?? null;
    if (node === null) {
      return;
    }
    this.selectedNode.set(node);
    this.selectedEdge.set(null);
    this.highlightNode(graphId);
  }

  selectEdgeById(graphId: string): void {
    const edge = this.edges().find((candidate) => candidate.id === graphId) ?? null;
    if (edge === null) {
      return;
    }
    this.selectedEdge.set(edge);
    this.selectedNode.set(null);
    this.highlightEdge(graphId);
  }

  clearSelection(): void {
    this.selectedNode.set(null);
    this.selectedEdge.set(null);
    this.cy?.elements().removeClass('selected neighbor-highlight dimmed');
  }

  focusSelected(): void {
    const node = this.selectedNode();
    if (node !== null) {
      this.focusNode(node.id);
      return;
    }
    const edge = this.selectedEdge();
    if (edge !== null) {
      this.focusEdge(edge.id);
    }
  }

  fitGraph(): void {
    const visible = this.visibleElements();
    if (visible !== null && visible.length > 0) {
      this.cy?.fit(visible, 48);
    }
  }

  centerGraph(): void {
    const visible = this.visibleElements();
    if (visible !== null && visible.length > 0) {
      this.cy?.center(visible);
    }
  }

  resetView(): void {
    const cy = this.cy;
    const visible = this.visibleElements();
    if (cy === null || visible === null || visible.length === 0) {
      return;
    }
    cy.zoom(1);
    cy.center(visible);
  }

  zoomBy(factor: number): void {
    const cy = this.cy;
    if (cy === null) {
      return;
    }
    const level = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor));
    cy.zoom({ level, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
  }

  pathForNode(node: GraphNode): string {
    return node.relativePath ?? node.filePath ?? '';
  }

  nodeName(graphId: string): string {
    return this.nodes().find((node) => node.id === graphId)?.name ?? graphId;
  }

  sourceLocationLabel(location: GraphEdge['sourceLocation'] | GraphNode['location']): string {
    return location === undefined
      ? '—'
      : `${location.filePath}:${location.startLine}:${location.startColumn}`;
  }

  retryMessage(): string {
    return this.queryError() || 'RepoLens could not load this graph neighborhood.';
  }

  private async loadNeighborhood(
    nodeId: string,
    mode: ExplorerMode,
    options: Omit<GraphNeighborhoodQuery, 'nodeId'>,
  ): Promise<void> {
    this.searchRevision += 1;
    this.searchLoading.set(false);
    this.activeSearchQuery = null;
    const revision = ++this.neighborhoodRevision;
    this.neighborhoodLoading.set(true);
    this.queryError.set('');
    try {
      const result = await this.graphService.neighborhood(this.projectId(), { nodeId, ...options });
      if (revision !== this.neighborhoodRevision || this.destroyed) {
        return;
      }
      if (result === null) {
        throw new Error('Graph data is no longer available in memory. Generate the graph again.');
      }
      if (
        result.anchorNodeId !== nodeId ||
        result.depth !== options.depth ||
        result.limit !== options.limit
      ) {
        throw new Error(
          'The graph neighborhood response does not match the requested anchor or bounds.',
        );
      }
      this.validateGraphData(result.nodes, result.edges);
      this.mode.set(mode);
      this.searchHasMore.set(false);
      this.searchLoaded.set(0);
      this.searchTotal.set(0);
      this.neighborhoodNodesTruncated.set(result.nodesTruncated);
      this.neighborhoodEdgesTruncated.set(result.edgesTruncated);
      this.replaceGraphData(
        result.nodes,
        result.edges,
        result.nodes.length > 0 ? 'success' : 'empty',
      );
      this.selectNodeById(result.anchorNodeId);
      this.focusNode(result.anchorNodeId);
    } catch (error) {
      if (revision === this.neighborhoodRevision && !this.destroyed) {
        const message = error instanceof Error ? error.message : 'Unknown graph query failure.';
        this.queryError.set(message);
        if (mode === 'overview' || this.nodes().length === 0) {
          this.status.set('error');
          this.mode.set(mode);
        }
      }
    } finally {
      if (revision === this.neighborhoodRevision && !this.destroyed) {
        this.neighborhoodLoading.set(false);
      }
    }
  }

  private setError(message: string): void {
    this.queryError.set(message);
    this.status.set('error');
  }

  private validateGraphData(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): void {
    const nodeIds = new Set<string>();
    for (const node of nodes) {
      if (node.projectId !== this.projectId() || nodeIds.has(node.id)) {
        throw new Error('The graph response contains duplicate or cross-project nodes.');
      }
      nodeIds.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const edge of edges) {
      if (
        edge.projectId !== this.projectId() ||
        edgeIds.has(edge.id) ||
        !nodeIds.has(edge.sourceId) ||
        !nodeIds.has(edge.targetId)
      ) {
        throw new Error('The graph response contains an invalid edge reference.');
      }
      edgeIds.add(edge.id);
    }
  }

  private mergeGraphData(
    currentNodes: readonly GraphNode[],
    currentEdges: readonly GraphEdge[],
    addedNodes: readonly GraphNode[],
    addedEdges: readonly GraphEdge[],
  ): { readonly nodes: readonly GraphNode[]; readonly edges: readonly GraphEdge[] } {
    const nodesById = new Map(currentNodes.map((node) => [node.id, node]));
    const edgesById = new Map(currentEdges.map((edge) => [edge.id, edge]));
    for (const node of addedNodes) {
      const existing = nodesById.get(node.id);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(node)) {
        throw new Error('The same graph node changed while a search was being paged.');
      }
      nodesById.set(node.id, node);
    }
    for (const edge of addedEdges) {
      const existing = edgesById.get(edge.id);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(edge)) {
        throw new Error('The same graph relationship changed while a search was being paged.');
      }
      edgesById.set(edge.id, edge);
    }
    const nodes = [...nodesById.values()];
    const edges = [...edgesById.values()];
    this.validateGraphData(nodes, edges);
    return { nodes, edges };
  }

  private replaceGraphData(
    nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
    status: Extract<ExplorerStatus, 'success' | 'empty'>,
  ): void {
    this.destroyCytoscape();
    this.nodes.set(nodes);
    this.edges.set(edges);
    this.selectedNode.set(null);
    this.selectedEdge.set(null);
    this.status.set(status);
    if (nodes.length === 0) {
      return;
    }

    const bundle = createCytoscapeElements(nodes, edges);
    this.nodeElementIdByGraphId = new Map(bundle.nodeElementIdByGraphId);
    this.edgeElementIdByGraphId = new Map(bundle.edgeElementIdByGraphId);
    this.cy = this.cytoscapeFactory({
      container: this.graphCanvas.nativeElement,
      elements: bundle.elements,
      style: createCytoscapeStyles(),
      layout: { name: 'preset' },
      minZoom: 0.08,
      maxZoom: 3,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      autoungrabify: false,
      autounselectify: true,
      boxSelectionEnabled: false,
    });
    this.bindCytoscapeEvents();
    this.applyFilters();
    this.scheduleLayout(true);
  }

  private bindCytoscapeEvents(): void {
    const cy = this.cy;
    if (cy === null) {
      return;
    }
    cy.on('tap', 'node', (event) => {
      const graphId = event.target.data('graphId');
      if (typeof graphId === 'string') {
        this.zone.run(() => this.selectNodeById(graphId));
      }
    });
    cy.on('tap', 'edge', (event) => {
      const graphId = event.target.data('graphId');
      if (typeof graphId === 'string') {
        this.zone.run(() => this.selectEdgeById(graphId));
      }
    });
    cy.on('dbltap', 'node', (event) => {
      const graphId = event.target.data('graphId');
      if (typeof graphId === 'string') {
        this.zone.run(() => {
          this.selectNodeById(graphId);
          void this.exploreSelectedNode();
        });
      }
    });
  }

  private applyFilters(): void {
    const cy = this.cy;
    if (cy === null) {
      return;
    }
    const visibleNodeTypes = new Set(this.nodeTypeFilters());
    const visibleEdgeTypes = new Set(this.edgeTypeFilters());
    cy.nodes().forEach((node) => {
      node.toggleClass('filtered-out', !visibleNodeTypes.has(node.data('type') as GraphNodeType));
    });
    cy.edges().forEach((edge) => {
      edge.toggleClass('filtered-out', !visibleEdgeTypes.has(edge.data('type') as GraphEdgeType));
    });
  }

  private highlightNode(graphId: string): void {
    const cy = this.cy;
    if (cy === null) {
      return;
    }
    cy.elements().removeClass('selected neighbor-highlight dimmed');
    const elementId = this.nodeElementIdByGraphId.get(graphId);
    if (elementId === undefined) {
      return;
    }
    const node = cy.getElementById(elementId);
    node.addClass('selected');
    node.neighborhood().addClass('neighbor-highlight');
    cy.elements().not(node.union(node.neighborhood())).addClass('dimmed');
  }

  private highlightEdge(graphId: string): void {
    const cy = this.cy;
    if (cy === null) {
      return;
    }
    cy.elements().removeClass('selected neighbor-highlight dimmed');
    const elementId = this.edgeElementIdByGraphId.get(graphId);
    if (elementId === undefined) {
      return;
    }
    const edge = cy.getElementById(elementId);
    const neighborhood = edge.connectedNodes();
    edge.addClass('selected');
    neighborhood.addClass('neighbor-highlight');
    cy.elements().not(edge.union(neighborhood)).addClass('dimmed');
  }

  private focusNode(graphId: string): void {
    const elementId = this.nodeElementIdByGraphId.get(graphId);
    if (elementId === undefined) {
      return;
    }
    const node = this.cy?.getElementById(elementId);
    if (node !== undefined && node.length > 0) {
      this.cy?.animate({ center: { eles: node }, zoom: 1.25, duration: 180 });
    }
  }

  private focusEdge(graphId: string): void {
    const elementId = this.edgeElementIdByGraphId.get(graphId);
    if (elementId === undefined) {
      return;
    }
    const edge = this.cy?.getElementById(elementId);
    if (edge !== undefined && edge.length > 0) {
      this.cy?.animate({ center: { eles: edge }, zoom: 1.25, duration: 180 });
    }
  }

  private visibleElements(): cytoscape.CollectionReturnValue | null {
    const cy = this.cy;
    if (cy === null) {
      return null;
    }
    return cy.elements(':visible');
  }

  private scheduleLayout(fit: boolean): void {
    const cy = this.cy;
    if (cy === null) {
      return;
    }
    if (this.layoutTimer !== null) {
      window.clearTimeout(this.layoutTimer);
    }
    this.layoutTimer = window.setTimeout(() => {
      this.layoutTimer = null;
      if (this.cy !== cy || cy.destroyed()) {
        return;
      }
      const roots = cy.nodes('[type = "project"]').map((node) => node.id());
      cy.layout({
        name: 'breadthfirst',
        directed: true,
        roots: roots.length > 0 ? roots : undefined,
        fit: false,
        padding: 44,
        spacingFactor: 1.15,
        avoidOverlap: true,
        animate: false,
      }).run();
      if (fit) {
        this.fitGraph();
      }
    }, 0);
  }

  private destroyCytoscape(): void {
    if (this.layoutTimer !== null) {
      window.clearTimeout(this.layoutTimer);
      this.layoutTimer = null;
    }
    this.cy?.destroy();
    this.cy = null;
    this.nodeElementIdByGraphId.clear();
    this.edgeElementIdByGraphId.clear();
  }
}

/** Maps only real, schema-validated graph records into Cytoscape's internal elements. */
export function createCytoscapeElements(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): CytoscapeElementBundle {
  const nodeElementIdByGraphId = new Map<string, string>();
  for (const [index, node] of nodes.entries()) {
    if (nodeElementIdByGraphId.has(node.id)) {
      throw new Error(`Duplicate graph node ID: ${node.id}`);
    }
    nodeElementIdByGraphId.set(node.id, `node-${index}`);
  }
  const edgeElementIdByGraphId = new Map<string, string>();
  for (const [index, edge] of edges.entries()) {
    if (edgeElementIdByGraphId.has(edge.id)) {
      throw new Error(`Duplicate graph edge ID: ${edge.id}`);
    }
    if (!nodeElementIdByGraphId.has(edge.sourceId) || !nodeElementIdByGraphId.has(edge.targetId)) {
      throw new Error(`Graph edge ${edge.id} refers to a node outside the loaded neighborhood.`);
    }
    edgeElementIdByGraphId.set(edge.id, `edge-${index}`);
  }

  const nodeElements: cytoscape.ElementDefinition[] = nodes.map((node) => {
    const id = nodeElementIdByGraphId.get(node.id);
    if (id === undefined) {
      throw new Error(`Graph node ${node.id} could not be mapped into Cytoscape.`);
    }
    return {
      group: 'nodes',
      data: {
        id,
        graphId: node.id,
        type: node.type,
        label: node.name.length > 34 ? `${node.name.slice(0, 33)}…` : node.name,
        color: nodeColor(node.type),
        shape: nodeShape(node.type),
        size:
          node.type === 'project'
            ? 44
            : node.type === 'folder'
              ? 34
              : node.type === 'file'
                ? 29
                : 24,
      },
    };
  });
  const edgeElements: cytoscape.ElementDefinition[] = edges.map((edge) => {
    const id = edgeElementIdByGraphId.get(edge.id);
    const source = nodeElementIdByGraphId.get(edge.sourceId);
    const target = nodeElementIdByGraphId.get(edge.targetId);
    if (id === undefined || source === undefined || target === undefined) {
      throw new Error(`Graph edge ${edge.id} could not be mapped into Cytoscape.`);
    }
    return {
      group: 'edges',
      data: {
        id,
        graphId: edge.id,
        source,
        target,
        type: edge.type,
        label: edge.specifier ?? edge.name ?? edge.type,
        color: edgeColor(edge.type),
      },
    };
  });
  return {
    elements: [...nodeElements, ...edgeElements],
    nodeElementIdByGraphId,
    edgeElementIdByGraphId,
  };
}

function createCytoscapeStyles(): cytoscape.StylesheetJson {
  const primary = themeColor('--rl-primary', '#60a5fa');
  const success = themeColor('--rl-success', '#34d399');
  const warning = themeColor('--rl-warning', '#fbbf24');
  const secondary = themeColor('--rl-secondary-text', '#9ca3af');
  const text = themeColor('--rl-text', '#f3f4f6');
  const background = themeColor('--rl-background', '#111827');
  const border = themeColor('--rl-border', '#526174');
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'background-color': 'data(color)',
        shape: 'data(shape)' as unknown as cytoscape.Css.NodeShape,
        width: 'data(size)',
        height: 'data(size)',
        color: text,
        'font-size': 9,
        'font-family': 'Inter, system-ui, sans-serif',
        'text-wrap': 'ellipsis',
        'text-max-width': '115px',
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 4,
        'text-outline-color': background,
        'text-outline-width': 2,
        'border-width': 1.5,
        'border-color': border,
        'overlay-opacity': 0,
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': 'data(color)',
        'target-arrow-color': 'data(color)',
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.75,
        'curve-style': 'bezier',
        opacity: 0.72,
        'overlay-opacity': 0,
      },
    },
    { selector: 'edge[type = "contains"]', style: { 'line-style': 'dashed', opacity: 0.45 } },
    { selector: 'edge[type = "imports"]', style: { width: 2.2, 'z-index': 2 } },
    {
      selector: 'edge.selected',
      style: {
        width: 4,
        label: 'data(label)',
        color: text,
        'font-size': 8,
        'text-rotation': 'autorotate',
        'text-background-color': background,
        'text-background-opacity': 0.9,
        'text-background-padding': '2px',
        'z-index': 20,
      },
    },
    {
      selector: 'node.selected',
      style: {
        'border-width': 4,
        'border-color': primary,
        'overlay-opacity': 0.12,
        'overlay-color': primary,
        'z-index': 20,
      },
    },
    {
      selector: '.neighbor-highlight',
      style: { opacity: 1, 'border-width': 3, 'border-color': warning, 'z-index': 10 },
    },
    { selector: '.dimmed', style: { opacity: 0.12 } },
    { selector: '.filtered-out', style: { display: 'none' } },
    { selector: '.selected.dimmed', style: { opacity: 1 } },
    { selector: 'node[type = "component"]', style: { 'background-color': primary } },
    { selector: 'node[type = "service"]', style: { 'background-color': success } },
    { selector: 'node[type = "interface"]', style: { 'background-color': warning } },
    { selector: 'node[type = "class"]', style: { 'background-color': secondary } },
  ];
}

function themeColor(name: string, fallback: string): string {
  if (typeof document === 'undefined') {
    return fallback;
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function nodeColor(type: GraphNodeType): string {
  switch (type) {
    case 'project':
    case 'component':
      return themeColor('--rl-primary', '#60a5fa');
    case 'folder':
    case 'interface':
      return themeColor('--rl-warning', '#fbbf24');
    case 'file':
    case 'service':
      return themeColor('--rl-success', '#34d399');
    default:
      return themeColor('--rl-secondary-text', '#9ca3af');
  }
}

function nodeShape(type: GraphNodeType): string {
  switch (type) {
    case 'project':
      return 'round-rectangle';
    case 'folder':
      return 'rectangle';
    case 'interface':
      return 'diamond';
    case 'function':
    case 'api-route':
      return 'hexagon';
    default:
      return 'ellipse';
  }
}

function edgeColor(type: GraphEdgeType): string {
  switch (type) {
    case 'imports':
    case 'api-call':
      return themeColor('--rl-primary', '#60a5fa');
    case 'exports':
    case 'implements':
      return themeColor('--rl-success', '#34d399');
    case 'contains':
      return themeColor('--rl-secondary-text', '#9ca3af');
    default:
      return themeColor('--rl-warning', '#fbbf24');
  }
}
