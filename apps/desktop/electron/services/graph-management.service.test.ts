import { buildProjectGraph, InMemoryGraphProvider } from '@repolens/core';
import { analysisResultSchema, graphExportJsonSchema, projectSchema } from '@repolens/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectManagementService } from './project-management.service.js';
import { GraphManagementService } from './graph-management.service.js';

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

function makeGraph() {
  const analysis = analysisResultSchema.parse({
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
    ],
    diagnostics: [],
  });
  return buildProjectGraph(analysis);
}

describe('graph management service', () => {
  it('exposes validated summaries, queries, traversals, paths, cycles, JSON, and disposal', async () => {
    const provider = new InMemoryGraphProvider();
    const graph = await makeGraph();
    provider.replace(graph);
    const projects = { getById: vi.fn(async () => project) } as unknown as ProjectManagementService;
    const service = new GraphManagementService(projects, provider);

    await expect(service.summary(projectId)).resolves.toMatchObject({
      projectId,
      analysisId,
      metrics: { fileCount: 2, dependencyEdgeCount: 1 },
    });
    await expect(
      service.query(projectId, { types: ['function'], exported: true }),
    ).resolves.toMatchObject({
      total: 1,
      nodes: [expect.objectContaining({ name: 'greet', type: 'function' })],
    });
    await expect(
      service.dependencies(projectId, { relativePath: 'src/index.ts', direction: 'dependencies' }),
    ).resolves.toMatchObject({
      files: [{ relativePath: 'src/helper.ts', distance: 1 }],
    });
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

  it('does not return a graph after its project registration disappears', async () => {
    const provider = new InMemoryGraphProvider();
    provider.replace(await makeGraph());
    const projects = { getById: vi.fn(async () => null) } as unknown as ProjectManagementService;
    const service = new GraphManagementService(projects, provider);

    await expect(service.summary(projectId)).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
  });
});
