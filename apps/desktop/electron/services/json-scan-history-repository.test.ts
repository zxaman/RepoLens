import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanHistoryItemSchema, type ScanHistoryItem } from '@repolens/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonScanHistoryRepository } from './json-scan-history-repository.js';

const temporaryDirectories: string[] = [];
const projectId = 'a1b2c3d4-e5f6-47a8-9012-abcdef123456';

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'repolens-scan-history-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function historyItem(
  id: string,
  startedAt: string,
  overrides: Partial<ScanHistoryItem> = {},
): ScanHistoryItem {
  return scanHistoryItemSchema.parse({
    id,
    projectId,
    status: 'completed',
    startedAt,
    completedAt: startedAt,
    durationMs: 0,
    directoriesDiscovered: 1,
    filesDiscovered: 0,
    filesProcessed: 0,
    sourceFiles: 0,
    configurationFiles: 0,
    packageManifests: 0,
    documentationFiles: 0,
    assetFiles: 0,
    otherFiles: 0,
    ignoredFiles: 0,
    ignoredDirectories: 0,
    sensitiveEntriesExcluded: 0,
    symlinksSkipped: 0,
    bytesHashed: 0,
    languages: [],
    technologies: [],
    warnings: [],
    ...overrides,
  });
}

describe('JSON scan-history repository', () => {
  it('persists recent summaries by project across repository recreation', async () => {
    const directory = await makeDirectory();
    const filePath = join(directory, 'user-data', 'scan-history.json');
    const repository = new JsonScanHistoryRepository(filePath);
    const older = historyItem('92370c1b-8755-4057-ae23-0d885ad4d94b', '2026-11-26T00:00:00.000Z');
    const newer = historyItem('b1b5c2bc-a3a6-4c15-bf7a-a242f820df0b', '2026-11-27T00:00:00.000Z', {
      status: 'cancelled',
    });

    await Promise.all([repository.append(projectId, older), repository.append(projectId, newer)]);
    const reopened = new JsonScanHistoryRepository(filePath);
    await expect(reopened.list(projectId)).resolves.toEqual([newer, older]);
    await expect(reopened.getLatest(projectId)).resolves.toEqual(newer);
    await expect(reopened.list('d7fc56d1-83e3-4945-b0cb-071e58a9a211')).resolves.toEqual([]);
    await reopened.removeProject(projectId);
    await expect(reopened.list(projectId)).resolves.toEqual([]);
    expect(await readFile(filePath, 'utf8')).toContain('"version": 1');
  });

  it('rejects cross-project records and preserves a malformed history file before recovery', async () => {
    const directory = await makeDirectory();
    const filePath = join(directory, 'scan-history.json');
    const repository = new JsonScanHistoryRepository(filePath);
    const item = historyItem('92370c1b-8755-4057-ae23-0d885ad4d94b', '2026-11-27T00:00:00.000Z');
    await expect(
      repository.append('d7fc56d1-83e3-4945-b0cb-071e58a9a211', item),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await writeFile(filePath, '{broken history', 'utf8');
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(repository.list(projectId)).resolves.toEqual([]);
    logger.mockRestore();

    const files = await readdir(directory);
    expect(files.some((name) => name.startsWith('scan-history.json.corrupt-'))).toBe(true);
  });
});
