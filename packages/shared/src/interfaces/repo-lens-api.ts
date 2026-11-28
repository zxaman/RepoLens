import type { AnalysisProgress, AnalysisResult } from '../schemas/analysis.schema.js';
import type { AppSettings } from '../schemas/app-settings.schema.js';
import type {
  ProjectImportCommitResult,
  ProjectImportResult,
} from '../schemas/project-import.schema.js';
import type { Project } from '../schemas/project.schema.js';
import type {
  ScanConfig,
  ScanHistoryItem,
  ScanProgress,
  ScanResult,
} from '../schemas/scan.schema.js';
import type { Result } from '../schemas/result.schema.js';

export interface RepoLensAPI {
  readonly app: {
    getVersion(): Promise<string>;
    getPlatform(): Promise<string>;
  };
  readonly projects: {
    importFolder(): Promise<Result<ProjectImportResult>>;
    confirmImport(selectionId: string): Promise<Result<ProjectImportCommitResult>>;
    cancelImport(selectionId: string): Promise<Result<{ readonly cancelled: true }>>;
    list(): Promise<Result<readonly Project[]>>;
    getById(id: string): Promise<Result<Project | null>>;
    getActive(): Promise<Result<Project | null>>;
    setActive(id: string): Promise<Result<Project>>;
    remove(id: string): Promise<Result<{ readonly removed: true }>>;
    refresh(id: string): Promise<Result<Project>>;
  };
  readonly scans: {
    start(projectId: string, config?: ScanConfig): Promise<Result<ScanResult>>;
    cancel(scanId: string): Promise<Result<{ readonly cancelled: true }>>;
    onProgress(callback: (progress: ScanProgress) => void): () => void;
    getHistory(projectId: string): Promise<Result<readonly ScanHistoryItem[]>>;
    getLatest(projectId: string): Promise<Result<ScanHistoryItem | null>>;
  };
  readonly analysis: {
    start(projectId: string, scanId: string): Promise<Result<AnalysisResult>>;
    cancel(analysisId: string): Promise<Result<{ readonly cancelled: true }>>;
    onProgress(callback: (progress: AnalysisProgress) => void): () => void;
  };
  readonly settings: {
    get(): Promise<Result<AppSettings>>;
    update(settings: AppSettings): Promise<Result<AppSettings>>;
    reset(): Promise<Result<AppSettings>>;
  };
}
