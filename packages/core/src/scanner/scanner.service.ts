import {
  scanConfigSchema,
  scanResultSchema,
  type ScanConfig,
  type ScanError,
  type ScanFile,
  type ScanProgress,
  type ScanResult,
  type ScanStatus,
  type ScanWarning,
} from '@repolens/shared';
import { calculateLanguageStatistics } from './language-detector.js';
import { classifyFile, detectFileLanguage } from './file-classifier.js';
import { getFileExtension } from './language-detector.js';
import { IgnoreManager } from './ignore-manager.js';
import { walkDirectoryTree } from './directory-walker.js';
import { hashDiscoveredFiles } from './file-hasher.js';
import { detectTechnologies } from './technology-detector.js';
import {
  isScanCancelled,
  ScanRootError,
  toScanError,
  throwIfScanCancelled,
} from './scan.errors.js';
import type {
  ClassifiedFile,
  MutableScanCounts,
  ScanFileSystem,
  ScanRequest,
  WalkedFile,
} from './scan.types.js';

const MAX_SCAN_WARNINGS = 500;
const CLASSIFICATION_PROGRESS_INTERVAL = 64;
const NEVER_CANCELLED = Object.freeze({ aborted: false });

export interface ScanProjectOptions extends ScanRequest {
  readonly fileSystem: ScanFileSystem;
}

export async function scanProject(options: ScanProjectOptions): Promise<ScanResult> {
  const scanId = options.scanId ?? options.createScanId?.() ?? createScanId();
  const now = options.now ?? (() => new Date());
  const started = now();
  const startedAt = started.toISOString();
  const signal = options.signal ?? NEVER_CANCELLED;
  const counts: MutableScanCounts = {
    filesDiscovered: 0,
    filesProcessed: 0,
    directoriesProcessed: 0,
    totalBytesProcessed: 0,
  };
  const warnings: ScanWarning[] = [];
  const errors: ScanError[] = [];
  const warningKeys = new Set<string>();
  let droppedWarningCount = 0;
  let files: readonly ClassifiedFile[] = [];
  let directoriesDiscovered = 0;
  let ignoredFiles = 0;
  let ignoredDirectories = 0;
  let sensitiveEntriesExcluded = 0;
  let symlinksSkipped = 0;
  let technologies: ScanResult['technologies'] = [];
  let status: ScanStatus = 'completed';
  let errorSummary: string | undefined;

  const forwardProgress = (progress: ScanProgress): void => {
    try {
      options.onProgress?.(progress);
    } catch {
      // Reporting progress must never fail a local scan.
    }
  };

  const recordWarning = (warning: ScanWarning): void => {
    const key = `${warning.code}|${warning.relativePath ?? ''}|${warning.message}`;
    if (warningKeys.has(key)) {
      return;
    }
    warningKeys.add(key);
    if (warnings.length >= MAX_SCAN_WARNINGS) {
      droppedWarningCount += 1;
      return;
    }
    warnings.push(warning);
  };

  const emitProgress = (
    phase: ScanProgress['phase'],
    details: {
      readonly currentPath?: string;
      readonly filesTotal?: number;
      readonly percentage?: number;
    } = {},
  ): void => {
    if (options.onProgress === undefined) {
      return;
    }
    const progress: ScanProgress = {
      scanId,
      projectId: options.projectId,
      phase,
      filesDiscovered: counts.filesDiscovered,
      filesProcessed: counts.filesProcessed,
      directoriesProcessed: counts.directoriesProcessed,
      totalBytesProcessed: counts.totalBytesProcessed,
      ...(details.currentPath === undefined ? {} : { currentPath: details.currentPath }),
      ...(details.filesTotal === undefined ? {} : { filesTotal: details.filesTotal }),
      ...(details.percentage === undefined ? {} : { percentage: details.percentage }),
    };
    forwardProgress(progress);
  };

  let config: ScanConfig = scanConfigSchema.parse({});
  const configResult = scanConfigSchema.safeParse(options.config ?? {});
  if (!configResult.success) {
    status = 'failed';
    errorSummary = 'The scan options are invalid.';
    errors.push({ code: 'INTERNAL_ERROR', message: errorSummary });
  } else {
    config = configResult.data;
  }

  emitProgress('initializing');

  if (status !== 'failed') {
    try {
      throwIfScanCancelled(signal);
      const rootPath = await options.fileSystem.realpath(options.rootPath);
      const rootInfo = await options.fileSystem.stat(rootPath);
      if (rootInfo.kind !== 'directory') {
        throw new ScanRootError(
          'ROOT_NOT_DIRECTORY',
          'The selected project path is not a directory.',
        );
      }

      const ignoreManager = await IgnoreManager.create(
        rootPath,
        options.fileSystem,
        config,
        recordWarning,
        signal,
      );
      emitProgress('walking');
      const walkResult = await walkDirectoryTree({
        rootPath,
        fileSystem: options.fileSystem,
        ignoreManager,
        execution: {
          scanId,
          projectId: options.projectId,
          signal,
          ...(options.onProgress === undefined ? {} : { onProgress: forwardProgress }),
          counts,
        },
        onWarning: recordWarning,
      });
      directoriesDiscovered = walkResult.directoriesDiscovered;
      ignoredFiles = walkResult.ignoredFiles;
      ignoredDirectories = walkResult.ignoredDirectories;
      sensitiveEntriesExcluded = walkResult.sensitiveEntriesExcluded;
      symlinksSkipped = walkResult.symlinksSkipped;
      counts.filesDiscovered = walkResult.files.length;

      emitProgress('classifying', { filesTotal: walkResult.files.length });
      const classifiedFiles: ClassifiedFile[] = [];
      for (let index = 0; index < walkResult.files.length; index += 1) {
        if (signal.aborted) {
          break;
        }
        const file = walkResult.files[index];
        if (file === undefined) {
          continue;
        }
        classifiedFiles.push(classifyWalkedFile(file));
        counts.filesProcessed = classifiedFiles.length;
        if (
          classifiedFiles.length % CLASSIFICATION_PROGRESS_INTERVAL === 0 ||
          classifiedFiles.length === walkResult.files.length
        ) {
          emitProgress('classifying', {
            filesTotal: walkResult.files.length,
            ...(walkResult.files.length === 0
              ? {}
              : {
                  percentage: Math.round((classifiedFiles.length / walkResult.files.length) * 100),
                }),
            currentPath: file.relativePath,
          });
          await options.fileSystem.yieldToEventLoop?.();
        }
      }
      files = classifiedFiles;

      if (signal.aborted || walkResult.cancelled) {
        status = 'cancelled';
      } else {
        counts.filesProcessed = 0;
        emitProgress('hashing', { filesTotal: files.length });
        const hashResult = await hashDiscoveredFiles({
          scanId,
          projectId: options.projectId,
          rootPath,
          files,
          fileSystem: options.fileSystem,
          signal,
          maxHashBytes: config.maxHashBytes,
          filesDiscovered: counts.filesDiscovered,
          directoriesProcessed: counts.directoriesProcessed,
          ...(options.onProgress === undefined ? {} : { onProgress: forwardProgress }),
          onWarning: recordWarning,
        });
        files = hashResult.files;
        counts.filesProcessed = hashResult.filesProcessed;
        counts.totalBytesProcessed = hashResult.bytesHashed;
        if (hashResult.cancelled) {
          status = 'cancelled';
        }
      }

      if (status !== 'cancelled') {
        emitProgress('detecting');
        try {
          technologies = await detectTechnologies({
            rootPath,
            files,
            fileSystem: options.fileSystem,
            signal,
            onWarning: recordWarning,
          });
          if (signal.aborted) {
            status = 'cancelled';
          }
        } catch (error) {
          if (isScanCancelled(error, signal)) {
            status = 'cancelled';
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      if (isScanCancelled(error, signal)) {
        status = 'cancelled';
      } else {
        status = 'failed';
        const scanError = toScanError(error);
        errors.push(scanError);
        errorSummary = scanError.message;
      }
    }
  }

  if (signal.aborted && status === 'completed') {
    status = 'cancelled';
  }

  if (droppedWarningCount > 0) {
    warnings.push({
      code: 'WARNINGS_TRUNCATED',
      message: `${droppedWarningCount} additional scan warnings were omitted from this result.`,
    });
  }

  const completed = now();
  const fileResults = [...files.map(({ file }) => file)].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
  const countsByClassification = countClassifications(fileResults);
  const result = scanResultSchema.parse({
    id: scanId,
    projectId: options.projectId,
    status,
    startedAt,
    completedAt: completed.toISOString(),
    durationMs: Math.max(0, completed.getTime() - started.getTime()),
    directoriesDiscovered,
    filesDiscovered: counts.filesDiscovered,
    filesProcessed: counts.filesProcessed,
    sourceFiles: countsByClassification.source,
    configurationFiles: countsByClassification.configuration,
    packageManifests: countsByClassification['package-manifest'],
    documentationFiles: countsByClassification.documentation,
    assetFiles: countsByClassification.asset,
    otherFiles: countsByClassification.other,
    ignoredFiles,
    ignoredDirectories,
    sensitiveEntriesExcluded,
    symlinksSkipped,
    bytesHashed: counts.totalBytesProcessed,
    languages: calculateLanguageStatistics(fileResults),
    technologies,
    warnings,
    ...(errorSummary === undefined ? {} : { errorSummary }),
    files: fileResults,
    errors,
  });

  emitProgress('finalizing', {
    ...(status === 'completed' ? { percentage: 100 } : {}),
    filesTotal: counts.filesDiscovered,
  });
  return result;
}

function classifyWalkedFile(file: WalkedFile): ClassifiedFile {
  const scanFile: ScanFile = {
    relativePath: file.relativePath,
    extension: getFileExtension(file.relativePath),
    sizeBytes: file.sizeBytes,
    modifiedAt: new Date(file.modifiedAtMs).toISOString(),
    classification: classifyFile(file.relativePath),
    language: detectFileLanguage(file.relativePath),
    hashStatus: 'not-attempted',
  };
  return { absolutePath: file.absolutePath, file: scanFile };
}

function createScanId(): string {
  const cryptoProvider = Reflect.get(globalThis, 'crypto') as
    | {
        readonly randomUUID?: () => string;
        readonly getRandomValues?: (values: Uint8Array) => Uint8Array;
      }
    | undefined;
  if (cryptoProvider?.randomUUID !== undefined) {
    return cryptoProvider.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (cryptoProvider?.getRandomValues !== undefined) {
    cryptoProvider.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function countClassifications(
  files: readonly ScanFile[],
): Record<ScanFile['classification'], number> {
  const counts: Record<ScanFile['classification'], number> = {
    source: 0,
    configuration: 0,
    'package-manifest': 0,
    documentation: 0,
    asset: 0,
    other: 0,
  };
  for (const file of files) {
    counts[file.classification] += 1;
  }
  return counts;
}
