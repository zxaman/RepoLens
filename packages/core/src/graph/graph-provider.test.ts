import { analysisResultSchema, type AnalysisResult } from '@repolens/shared';
import { describe, expect, it } from 'vitest';
import { buildProjectGraph } from './graph-engine.js';
import { InMemoryGraphProvider } from './graph-provider.js';

const scanId = '92370c1b-8755-4057-ae23-0d885ad4d94b';
const timestamp = '2026-11-27T00:00:00.000Z';

function makeGraph(projectId: string, analysisId: string) {
  const analysis: AnalysisResult = analysisResultSchema.parse({
    analysisId,
    scanId,
    projectId,
    status: 'completed',
    startedAt: timestamp,
    completedAt: timestamp,
    durationMs: 0,
    filesSelected: 1,
    filesAnalyzed: 1,
    filesSkipped: 0,
    analyzedFiles: ['src/index.ts'],
    symbols: [],
    imports: [],
    exports: [],
    dependencies: [],
    diagnostics: [],
  });
  return buildProjectGraph(analysis);
}

const projectA = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';
const projectB = 'b1b2c3d4-e5f6-47a8-9012-abcdef123456';
const analysisA = '7d707ca0-312b-4a6f-8950-8df3441d973a';
const analysisB = '8d707ca0-312b-4a6f-8950-8df3441d973a';
const analysisC = '9d707ca0-312b-4a6f-8950-8df3441d973a';

describe('in-memory project graph provider', () => {
  it('replaces graphs per project and refuses to publish a stale analysis lease', async () => {
    const provider = new InMemoryGraphProvider();
    const oldGraph = await makeGraph(projectA, analysisA);
    provider.replace(oldGraph);
    expect(provider.get(projectA)).toBe(oldGraph);

    const staleLease = provider.beginBuild(projectA, analysisB);
    expect(provider.get(projectA)).toBeNull();
    const currentLease = provider.beginBuild(projectA, analysisC);
    const currentGraph = await makeGraph(projectA, analysisC);

    expect(provider.publish(staleLease, oldGraph)).toBe(false);
    expect(provider.publish(currentLease, currentGraph)).toBe(true);
    expect(provider.get(projectA)).toBe(currentGraph);
    expect(provider.getAnalysisId(projectA)).toBe(analysisC);
  });

  it('keeps multiple projects isolated and supports explicit per-project and global disposal', async () => {
    const provider = new InMemoryGraphProvider();
    const graphA = await makeGraph(projectA, analysisA);
    const graphB = await makeGraph(projectB, analysisB);
    provider.replace(graphA);
    provider.replace(graphB);

    expect(provider.size).toBe(2);
    expect(provider.get(projectA)).toBe(graphA);
    expect(provider.get(projectB)).toBe(graphB);
    expect(provider.disposeProject(projectA)).toBe(true);
    expect(provider.disposeProject(projectA)).toBe(false);
    expect(provider.get(projectA)).toBeNull();
    expect(provider.get(projectB)).toBe(graphB);

    provider.dispose();
    expect(provider.size).toBe(0);
    expect(provider.get(projectB)).toBeNull();
  });

  it('cleans expired entries and evicts least-recently-used projects above capacity', async () => {
    let now = 0;
    const provider = new InMemoryGraphProvider({
      maxEntries: 2,
      maxAgeMs: 100,
      now: () => now,
    });
    const graphA = await makeGraph(projectA, analysisA);
    const graphB = await makeGraph(projectB, analysisB);

    provider.replace(graphA);
    now = 10;
    provider.replace(graphB);
    now = 20;
    expect(provider.get(projectA)).toBe(graphA);
    now = 30;
    provider.replace(await makeGraph('c1b2c3d4-e5f6-47a8-9012-abcdef123456', analysisC));
    expect(provider.cleanup(now)).toBe(0);
    expect(provider.get(projectA)).toBe(graphA);
    expect(provider.get(projectB)).toBeNull();
    expect(provider.size).toBe(2);

    now = 131;
    expect(provider.cleanup(now)).toBe(2);
    expect(provider.size).toBe(0);
  });
});
