import type {
  GraphCycleQuery,
  GraphCycleReport,
  GraphDependencyQuery,
  GraphNodeQuery,
  GraphNodeQueryResult,
  GraphPathQuery,
  GraphPathResult,
  GraphSummary,
  GraphTraversalResult,
} from '@repolens/shared';
import { InMemoryGraphProvider } from '@repolens/core';
import type { ProjectManagementService } from './project-management.service.js';
import { ServiceError } from './service-error.js';

/** Narrow main-process facade; all return values are plain validated DTOs, never Graphology graphs. */
export class GraphManagementService {
  constructor(
    private readonly projects: ProjectManagementService,
    private readonly graphs: InMemoryGraphProvider,
  ) {}

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
    return this.graphs.get(projectId);
  }

  private async assertProjectExists(projectId: string): Promise<void> {
    const project = await this.projects.getById(projectId);
    if (project === null) {
      throw new ServiceError('PROJECT_NOT_FOUND', 'That project is no longer registered.');
    }
  }
}
