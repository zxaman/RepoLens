import { z } from 'zod';
import { ProjectGraph } from './graph-engine.js';

const uuidSchema = z.uuid();

export interface GraphBuildLease {
  readonly projectId: string;
  readonly analysisId: string;
  readonly revision: number;
}

export interface GraphProviderOptions {
  readonly maxEntries?: number;
  readonly maxAgeMs?: number;
  readonly now?: () => number;
}

interface GraphEntry {
  readonly revision: number;
  readonly analysisId: string;
  readonly startedAt: number;
  lastAccessedAt: number;
  graph: ProjectGraph | null;
}

/**
 * Process-local graph lifecycle keyed by project ID. Starting a newer analysis invalidates the
 * previous graph immediately; revision leases prevent an older build from publishing afterward.
 */
export class InMemoryGraphProvider {
  private readonly entries = new Map<string, GraphEntry>();
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private nextRevision = 0;

  constructor(options: GraphProviderOptions = {}) {
    this.maxEntries = options.maxEntries ?? 50;
    this.maxAgeMs = options.maxAgeMs ?? 6 * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new RangeError('Graph provider maxEntries must be a positive safe integer.');
    }
    if (!Number.isSafeInteger(this.maxAgeMs) || this.maxAgeMs < 1) {
      throw new RangeError('Graph provider maxAgeMs must be a positive safe integer.');
    }
  }

  beginBuild(projectId: string, analysisId: string): GraphBuildLease {
    uuidSchema.parse(projectId);
    uuidSchema.parse(analysisId);
    this.cleanup();
    const revision = ++this.nextRevision;
    const now = this.now();
    this.entries.set(projectId, {
      revision,
      analysisId,
      startedAt: now,
      lastAccessedAt: now,
      graph: null,
    });
    this.cleanup(now);
    return Object.freeze({ projectId, analysisId, revision });
  }

  publish(lease: GraphBuildLease, graph: ProjectGraph): boolean {
    const current = this.entries.get(lease.projectId);
    if (
      current === undefined ||
      current.revision !== lease.revision ||
      current.analysisId !== lease.analysisId ||
      graph.projectId !== lease.projectId ||
      graph.analysisId !== lease.analysisId
    ) {
      return false;
    }
    current.graph = graph;
    current.lastAccessedAt = this.now();
    return true;
  }

  fail(lease: GraphBuildLease): boolean {
    const current = this.entries.get(lease.projectId);
    if (
      current === undefined ||
      current.revision !== lease.revision ||
      current.analysisId !== lease.analysisId
    ) {
      return false;
    }
    this.entries.delete(lease.projectId);
    return true;
  }

  replace(graph: ProjectGraph): void {
    const lease = this.beginBuild(graph.projectId, graph.analysisId);
    this.publish(lease, graph);
  }

  get(projectId: string): ProjectGraph | null {
    uuidSchema.parse(projectId);
    const entry = this.entries.get(projectId);
    if (entry === undefined || entry.graph === null) {
      return null;
    }
    entry.lastAccessedAt = this.now();
    return entry.graph;
  }

  getAnalysisId(projectId: string): string | null {
    uuidSchema.parse(projectId);
    return this.entries.get(projectId)?.analysisId ?? null;
  }

  disposeProject(projectId: string): boolean {
    uuidSchema.parse(projectId);
    return this.entries.delete(projectId);
  }

  /** Evicts expired graphs and then least-recently-used entries above the configured capacity. */
  cleanup(now = this.now()): number {
    let removed = 0;
    for (const [projectId, entry] of this.entries) {
      if (now - Math.max(entry.lastAccessedAt, entry.startedAt) >= this.maxAgeMs) {
        this.entries.delete(projectId);
        removed += 1;
      }
    }

    if (this.entries.size > this.maxEntries) {
      const leastRecentlyUsed = [...this.entries.entries()].sort(
        (left, right) =>
          left[1].lastAccessedAt - right[1].lastAccessedAt || left[1].revision - right[1].revision,
      );
      for (const [projectId] of leastRecentlyUsed.slice(0, this.entries.size - this.maxEntries)) {
        this.entries.delete(projectId);
        removed += 1;
      }
    }
    return removed;
  }

  dispose(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
