import type { AppSettings } from '../schemas/app-settings.schema.js';
import type { Project } from '../schemas/project.schema.js';
import type { Result } from '../schemas/result.schema.js';
import type { ScanSummary } from '../schemas/scan.schema.js';

/** Narrow, explicitly permitted API exposed to the Angular renderer by Electron preload. */
export interface RepoLensAPI {
  readonly app: {
    getVersion(): Promise<string>;
    getPlatform(): Promise<string>;
  };
  readonly projects: {
    list(): Promise<Result<readonly Project[]>>;
  };
  readonly scans: {
    getStatus(): Promise<Result<ScanSummary | null>>;
  };
  readonly settings: {
    get(): Promise<Result<AppSettings>>;
  };
}
