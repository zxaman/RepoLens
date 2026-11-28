import type { ScanConfig, ScanFile, ScanProgress, ScanResult, ScanWarning } from '@repolens/shared';

export type ScanNodeKind = 'file' | 'directory' | 'symlink' | 'other';

export interface ScanFileInfo {
  readonly kind: ScanNodeKind;
  readonly sizeBytes: number;
  readonly modifiedAtMs: number;
}

export interface ScanHashResult {
  readonly sha256: string;
  readonly bytesRead: number;
}

/** The scanner depends on this narrow adapter rather than Electron or a UI framework. */
export interface ScanFileSystem {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<ScanFileInfo>;
  stat(path: string): Promise<ScanFileInfo>;
  readdir(path: string): Promise<readonly string[]>;
  readTextFile(rootPath: string, path: string, maxBytes: number): Promise<string | null>;
  hashFile(
    rootPath: string,
    path: string,
    signal: ScanCancellation,
    maxBytes: number,
  ): Promise<ScanHashResult>;
  isWithinRoot(rootPath: string, candidatePath: string): boolean;
  relativePath(rootPath: string, candidatePath: string): string | null;
  yieldToEventLoop?(): Promise<void>;
}

export interface ScanCancellation {
  readonly aborted: boolean;
}

export interface ScanRequest {
  readonly projectId: string;
  readonly rootPath: string;
  readonly config?: ScanConfig;
  readonly signal?: ScanCancellation;
  readonly onProgress?: (progress: ScanProgress) => void;
  readonly scanId?: string;
  readonly createScanId?: () => string;
  readonly now?: () => Date;
}

export interface WalkedFile {
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly sizeBytes: number;
  readonly modifiedAtMs: number;
}

export interface ClassifiedFile {
  readonly absolutePath: string;
  readonly file: ScanFile;
}

export interface DirectoryWalkResult {
  readonly files: readonly WalkedFile[];
  readonly directoriesDiscovered: number;
  readonly ignoredFiles: number;
  readonly ignoredDirectories: number;
  readonly sensitiveEntriesExcluded: number;
  readonly symlinksSkipped: number;
  readonly warnings: readonly ScanWarning[];
  readonly cancelled: boolean;
}

export interface MutableScanCounts {
  filesDiscovered: number;
  filesProcessed: number;
  directoriesProcessed: number;
  totalBytesProcessed: number;
}

export interface ScanExecutionContext {
  readonly scanId: string;
  readonly projectId: string;
  readonly signal: ScanCancellation;
  readonly onProgress?: (progress: ScanProgress) => void;
  readonly counts: MutableScanCounts;
  readonly filesTotal?: number;
}

export interface ScanExecutionResult {
  readonly result: ScanResult;
}
