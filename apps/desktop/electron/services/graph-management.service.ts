import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
import {
  buildProjectGraph,
  GraphBuildCancelledError,
  GraphEngineError,
  InMemoryGraphProvider,
} from '@repolens/core';
import {
  analysisResultSchema,
  graphBuildProgressSchema,
  graphGenerationReportSchema,
} from '@repolens/shared';
import type {
  GraphBuildProgress,
  GraphCycleQuery,
  GraphCycleReport,
  GraphDependencyQuery,
  GraphGenerationFailureCode,
  GraphGenerationReport,
  GraphNodeQuery,
  GraphNodeQueryResult,
  GraphPathQuery,
  GraphPathResult,
  GraphSummary,
  GraphTraversalResult,
} from '@repolens/shared';
import type { AnalysisManagementService } from './analysis-management.service.js';
import type { ProjectManagementService } from './project-management.service.js';
import type { ScanManagementService } from './scan-management.service.js';
import { safeErrorDetails } from './diagnostic-logging.js';
import { ServiceError } from './service-error.js';

export type GraphProgressSink = (progress: GraphBuildProgress) => void;

/** Narrow main-process facade; callers receive only validated DTOs, never Graphology instances. */
export class GraphManagementService {
  private readonly activeGenerations = new Set<string>();

  constructor(
    private readonly projects: ProjectManagementService,
    private readonly graphs: InMemoryGraphProvider,
    private readonly scans: ScanManagementService,
    private readonly analyses: AnalysisManagementService,
  ) {}

  async generate(
    projectId: string,
    scanId: string,
    analysisId: string,
    progressSink: GraphProgressSink = () => undefined,
  ): Promise<GraphGenerationReport> {
    if (this.activeGenerations.has(projectId)) {
      return createFailureReport(
        projectId,
        null,
        'GRAPH_ALREADY_RUNNING',
        'Graph generation is already running for this project. Wait for it to finish.',
      );
    }
    this.activeGenerations.add(projectId);
    let lease: ReturnType<InMemoryGraphProvider['beginBuild']> | null = null;
    let graphPublished = false;

    try {
      emitProgress(progressSink, {
        analysisId,
        scanId,
        projectId,
        phase: 'preparing',
        processed: 0,
        total: 1,
        percentage: 0,
      });

      const project = await this.projects.getById(projectId);
      if (project === null || project.status === 'unavailable') {
        return createFailureReport(
          projectId,
          null,
          'PROJECT_UNAVAILABLE',
          'This project is unavailable. Restore its folder before generating a graph.',
        );
      }

      const scan = this.scans.getCurrentResult(projectId, scanId);
      if (scan === null || scan.projectId !== projectId || scan.id !== scanId) {
        return createFailureReport(
          projectId,
          null,
          'SCAN_REQUIRED',
          'Run a new project scan before generating a graph. The requested scan is no longer current.',
        );
      }
      if (scan.status !== 'completed') {
        return createFailureReport(
          projectId,
          null,
          'SCAN_NOT_COMPLETED',
          'Graph generation requires a completed scan. Run a new scan and wait for it to finish.',
        );
      }

      const latestAnalysis = this.analyses.getLatestResult(projectId);
      if (latestAnalysis === null) {
        return createFailureReport(
          projectId,
          null,
          'ANALYSIS_REQUIRED',
          'Run static analysis on the completed scan before generating a graph.',
        );
      }
      if (latestAnalysis.scanId !== scanId || latestAnalysis.analysisId !== analysisId) {
        return createFailureReport(
          projectId,
          latestAnalysis,
          'ANALYSIS_STALE',
          'The static analysis does not match the current scan. Analyze this scan again before generating a graph.',
        );
      }

      const parsedAnalysis = analysisResultSchema.safeParse(
        this.analyses.getCurrentResult(projectId, scanId, analysisId),
      );
      if (!parsedAnalysis.success) {
        return createFailureReport(
          projectId,
          latestAnalysis,
          'ANALYSIS_INVALID',
          'The static analysis result is missing or invalid. Run static analysis again before generating a graph.',
        );
      }
      const analysis = parsedAnalysis.data;
      if (analysis.status === 'failed' || analysis.status === 'cancelled') {
        return createFailureReport(
          projectId,
          analysis,
          'ANALYSIS_FAILED',
          'Static analysis did not complete successfully. Run it again before generating a graph.',
        );
      }
      if (analysis.filesAnalyzed === 0 || analysis.analyzedFiles.length === 0) {
        return createFailureReport(
          projectId,
          analysis,
          'ANALYSIS_EMPTY',
          'Static analysis produced no readable source files. Check the scan and file-read diagnostics, then try again.',
        );
      }

      const sourcePaths = new Set(
        scan.files
          .filter((file) => file.classification === 'source')
          .map((file) => file.relativePath),
      );
      if (analysis.analyzedFiles.some((filePath) => !sourcePaths.has(filePath))) {
        return createFailureReport(
          projectId,
          analysis,
          'ANALYSIS_INVALID',
          'The static analysis references files outside the completed scan. Analyze this scan again before generating a graph.',
        );
      }

      emitProgress(progressSink, {
        analysisId,
        scanId,
        projectId,
        phase: 'preparing',
        processed: 1,
        total: 1,
        percentage: 100,
      });
      lease = this.graphs.beginBuild(projectId, analysisId);
      const graph = await buildProjectGraph(analysis, {
        projectName: project.name,
        onProgress: (progress) => emitProgress(progressSink, progress),
        yieldToEventLoop: () => yieldToEventLoop(),
      });

      const currentProject = await this.projects.getById(projectId);
      if (currentProject === null || currentProject.status === 'unavailable') {
        return createFailureReport(
          projectId,
          analysis,
          'PROJECT_UNAVAILABLE',
          'This project became unavailable while the graph was being generated.',
        );
      }
      const currentScan = this.scans.getCurrentResult(projectId, scanId);
      const currentAnalysis = this.analyses.getCurrentResult(projectId, scanId, analysisId);
      if (
        currentScan === null ||
        currentScan.projectId !== projectId ||
        currentScan.id !== scanId ||
        currentScan.status !== 'completed' ||
        currentAnalysis === null ||
        currentAnalysis.projectId !== projectId ||
        currentAnalysis.scanId !== scanId ||
        currentAnalysis.analysisId !== analysisId
      ) {
        return createFailureReport(
          projectId,
          analysis,
          'GRAPH_SUPERSEDED',
          'The current scan or analysis changed while its graph was being generated. Run graph generation again.',
        );
      }

      if (!this.graphs.publish(lease, graph)) {
        this.graphs.fail(lease);
        return createFailureReport(
          projectId,
          analysis,
          'GRAPH_SUPERSEDED',
          'The project analysis changed while its graph was being generated. Run graph generation again.',
        );
      }
      graphPublished = true;

      const summary = graph.getSummary();
      const cycleReport = graph.findCycles({ maxCycles: 1000 });
      const exported = graph.toExport();
      const dependencyCounts = exported.dependencies.reduce(
        (counts, dependency) => {
          counts[dependency.kind] += 1;
          return counts;
        },
        { local: 0, alias: 0, 'external-package': 0, unresolved: 0 },
      );
      const warnings: string[] = [];
      if (analysis.status === 'partial') {
        warnings.push(
          `Static analysis was partial; the graph covers ${analysis.filesAnalyzed} successfully analyzed source file(s).`,
        );
      }
      if (analysis.filesSkipped > 0) {
        warnings.push(
          `${analysis.filesSkipped} selected source file(s) could not be analyzed and are omitted from the graph.`,
        );
      }
      if (dependencyCounts.unresolved > 0) {
        warnings.push(
          `${dependencyCounts.unresolved} unresolved import(s) remain separate references and are not shown as resolved local graph edges.`,
        );
      }
      if (dependencyCounts['external-package'] > 0) {
        warnings.push(
          `${dependencyCounts['external-package']} external package import(s) are not represented as local graph edges.`,
        );
      }
      if (cycleReport.truncated) {
        warnings.push(
          'Cycle enumeration reached its limit; the reported cycle count is a lower bound.',
        );
      }

      return graphGenerationReportSchema.parse({
        projectId,
        analysisId,
        analysisStatus: analysis.status,
        status: analysis.status,
        totalNodes: summary.metrics.nodeCount,
        totalEdges: summary.metrics.edgeCount,
        nodesByType: Object.fromEntries(
          summary.metrics.nodesByType
            .filter((entry) => entry.count > 0)
            .map((entry) => [entry.type, entry.count]),
        ),
        edgesByType: Object.fromEntries(
          summary.metrics.edgesByType
            .filter((entry) => entry.count > 0)
            .map((entry) => [entry.type, entry.count]),
        ),
        resolvedDependencies: dependencyCounts.local + dependencyCounts.alias,
        unresolvedDependencies: dependencyCounts.unresolved,
        externalDependencies: dependencyCounts['external-package'],
        cycleCount: cycleReport.cycles.length,
        cyclesTruncated: cycleReport.truncated,
        warnings,
      });
    } catch (error) {
      if (lease !== null) {
        this.graphs.fail(lease);
        graphPublished = false;
      }
      if (error instanceof GraphBuildCancelledError) {
        emitProgress(progressSink, {
          analysisId,
          scanId,
          projectId,
          phase: 'cancelled',
          processed: 0,
          total: 0,
          percentage: 0,
        });
        return createFailureReport(
          projectId,
          this.analyses.getLatestResult(projectId),
          'GRAPH_CANCELLED',
          'Graph generation was cancelled before a complete graph could be published.',
        );
      }
      if (error instanceof GraphEngineError) {
        console.error('RepoLens rejected graph generation data.', safeErrorDetails(error));
      } else {
        console.error('RepoLens could not generate a project graph.', safeErrorDetails(error));
      }
      return createFailureReport(
        projectId,
        this.analyses.getLatestResult(projectId),
        'GRAPH_BUILD_FAILED',
        'RepoLens could not generate this graph from the current analysis. Review analysis diagnostics and try again.',
      );
    } finally {
      if (lease !== null && !graphPublished) {
        this.graphs.fail(lease);
      }
      this.activeGenerations.delete(projectId);
    }
  }

  async summary(projectId: string): Promise<GraphSummary | null> {
    const graph = await this.getGraph(projectId);
    return graph?.getSummary() ?? null;
  }

  async query(projectId: string, query: GraphNodeQuery): Promise<GraphNodeQueryResult | null> {
    const graph = await this.getGraph(projectId);
    return graph?.queryNodes(query) ?? null;
  }

  async dependencies(
    projectId: string,
    query: GraphDependencyQuery,
  ): Promise<GraphTraversalResult | null> {
    const graph = await this.getGraph(projectId);
    return graph?.traverseDependencies(query) ?? null;
  }

  async shortestPath(projectId: string, query: GraphPathQuery): Promise<GraphPathResult | null> {
    const graph = await this.getGraph(projectId);
    return graph?.findDependencyPath(query) ?? null;
  }

  async cycles(projectId: string, query: GraphCycleQuery): Promise<GraphCycleReport | null> {
    const graph = await this.getGraph(projectId);
    return graph?.findCycles(query) ?? null;
  }

  async exportJson(projectId: string): Promise<string | null> {
    const graph = await this.getGraph(projectId);
    return graph?.exportJson() ?? null;
  }

  async dispose(projectId: string): Promise<{ readonly disposed: true }> {
    await this.assertProjectExists(projectId);
    this.graphs.disposeProject(projectId);
    return { disposed: true };
  }

  private async getGraph(projectId: string) {
    await this.assertProjectExists(projectId);
    this.graphs.cleanup();
    const graph = this.graphs.get(projectId);
    if (graph === null) {
      return null;
    }
    const summary = graph.getSummary();
    const currentScan = this.scans.getCurrentResult(projectId, summary.scanId);
    if (
      currentScan === null ||
      currentScan.status !== 'completed' ||
      this.analyses.getCurrentResult(projectId, summary.scanId, summary.analysisId) === null
    ) {
      this.graphs.disposeProject(projectId);
      return null;
    }
    return graph;
  }

  private async assertProjectExists(projectId: string): Promise<void> {
    const project = await this.projects.getById(projectId);
    if (project === null) {
      throw new ServiceError('PROJECT_NOT_FOUND', 'That project is no longer registered.');
    }
  }
}

function emitProgress(sink: GraphProgressSink, value: unknown): void {
  const progress = graphBuildProgressSchema.safeParse(value);
  if (!progress.success) {
    return;
  }
  try {
    sink(progress.data);
  } catch {
    // Renderer progress observers cannot interrupt graph construction or cleanup.
  }
}

function createFailureReport(
  projectId: string,
  analysis: ReturnType<AnalysisManagementService['getLatestResult']>,
  failureCode: GraphGenerationFailureCode,
  errorMessage: string,
): GraphGenerationReport {
  return graphGenerationReportSchema.parse({
    projectId,
    analysisId: analysis?.analysisId ?? null,
    analysisStatus: analysis?.status ?? null,
    status: 'failed',
    totalNodes: 0,
    totalEdges: 0,
    nodesByType: {},
    edgesByType: {},
    resolvedDependencies: 0,
    unresolvedDependencies: 0,
    externalDependencies: 0,
    cycleCount: 0,
    cyclesTruncated: false,
    warnings: [],
    failureCode,
    errorMessage,
  });
}
