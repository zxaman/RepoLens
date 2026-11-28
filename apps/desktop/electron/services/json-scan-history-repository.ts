import { scanHistoryItemSchema, type ScanHistoryItem } from '@repolens/shared';
import { z } from 'zod';
import { atomicWriteJson, readValidatedJson } from './atomic-json-file.js';
import { ServiceError } from './service-error.js';
import type { ScanHistoryRepository } from './scan-history-repository.js';

const HISTORY_PER_PROJECT_LIMIT = 50;

const scanHistoryFileSchema = z
  .object({
    version: z.literal(1),
    projects: z.record(z.uuid(), z.array(scanHistoryItemSchema)),
  })
  .strict()
  .superRefine((history, context) => {
    for (const [projectId, items] of Object.entries(history.projects)) {
      items.forEach((item, index) => {
        if (item.projectId !== projectId) {
          context.addIssue({
            code: 'custom',
            path: ['projects', projectId, index, 'projectId'],
            message: 'A history item must belong to its containing project.',
          });
        }
      });
    }
  });

type ScanHistoryFile = z.infer<typeof scanHistoryFileSchema>;

function emptyHistory(): ScanHistoryFile {
  return { version: 1, projects: {} };
}

export class JsonScanHistoryRepository implements ScanHistoryRepository {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  list(projectId: string): Promise<readonly ScanHistoryItem[]> {
    return this.exclusive(async () => {
      const history = await this.readHistory();
      return sortByDate(history.projects[projectId] ?? []);
    });
  }

  getLatest(projectId: string): Promise<ScanHistoryItem | null> {
    return this.exclusive(async () => {
      const history = await this.readHistory();
      return sortByDate(history.projects[projectId] ?? [])[0] ?? null;
    });
  }

  append(projectId: string, item: ScanHistoryItem): Promise<ScanHistoryItem> {
    return this.exclusive(async () => {
      const parsed = scanHistoryItemSchema.safeParse(item);
      if (!parsed.success || parsed.data.projectId !== projectId) {
        throw new ServiceError('INVALID_INPUT', 'The scan history record is invalid.');
      }

      const history = await this.readHistory();
      const current = history.projects[projectId] ?? [];
      const updated = sortByDate([
        parsed.data,
        ...current.filter((candidate) => candidate.id !== parsed.data.id),
      ]).slice(0, HISTORY_PER_PROJECT_LIMIT);
      const next = scanHistoryFileSchema.parse({
        ...history,
        projects: { ...history.projects, [projectId]: updated },
      });
      await atomicWriteJson(this.filePath, next);
      return parsed.data;
    });
  }

  removeProject(projectId: string): Promise<void> {
    return this.exclusive(async () => {
      const history = await this.readHistory();
      if (!(projectId in history.projects)) {
        return;
      }
      const projects = { ...history.projects };
      delete projects[projectId];
      await atomicWriteJson(this.filePath, scanHistoryFileSchema.parse({ ...history, projects }));
    });
  }

  private readHistory(): Promise<ScanHistoryFile> {
    return readValidatedJson(this.filePath, scanHistoryFileSchema, emptyHistory(), 'scan history');
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function sortByDate(items: readonly ScanHistoryItem[]): ScanHistoryItem[] {
  return [...items].sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}
