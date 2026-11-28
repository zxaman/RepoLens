import type { ScanHistoryItem } from '@repolens/shared';

export interface ScanHistoryRepository {
  list(projectId: string): Promise<readonly ScanHistoryItem[]>;
  getLatest(projectId: string): Promise<ScanHistoryItem | null>;
  append(projectId: string, item: ScanHistoryItem): Promise<ScanHistoryItem>;
  removeProject(projectId: string): Promise<void>;
}
