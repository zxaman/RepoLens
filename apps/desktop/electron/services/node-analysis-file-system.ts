import { resolve } from 'node:path';
import type { StaticAnalysisFileSystem } from '@repolens/core';
import { NodeScanFileSystem } from './node-scan-file-system.js';

/** Resolves only normalized relative paths supplied by the validated Phase 3 scan inventory. */
export class NodeAnalysisFileSystem implements StaticAnalysisFileSystem {
  constructor(
    private readonly rootPath: string,
    private readonly allowedPaths: ReadonlySet<string>,
    private readonly scanFileSystem: NodeScanFileSystem = new NodeScanFileSystem(),
  ) {}

  async readTextFile(relativePath: string, maxBytes: number): Promise<string | null> {
    const segments = relativePath.split('/');
    if (
      !this.allowedPaths.has(relativePath) ||
      relativePath.length === 0 ||
      relativePath.startsWith('/') ||
      relativePath.includes('\\') ||
      segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
    ) {
      throw new Error('Static analysis received a non-normalized scan path.');
    }

    const absolutePath = resolve(this.rootPath, ...segments);
    if (!this.scanFileSystem.isWithinRoot(this.rootPath, absolutePath)) {
      throw new Error('Static analysis attempted to read outside the selected project.');
    }
    return this.scanFileSystem.readTextFile(this.rootPath, absolutePath, maxBytes);
  }

  async yieldToEventLoop(): Promise<void> {
    await this.scanFileSystem.yieldToEventLoop();
  }
}
