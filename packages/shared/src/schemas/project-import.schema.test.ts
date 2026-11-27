import { describe, expect, it } from 'vitest';
import { projectImportResultSchema } from './project-import.schema.js';

const project = {
  id: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
  name: 'sample',
  rootPath: '/workspace/sample',
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
  status: 'registered',
  repositoryType: 'local',
  repositoryIndicators: [],
};

describe('project import result contracts', () => {
  it('distinguishes cancellation, selected previews, and duplicates', () => {
    expect(projectImportResultSchema.parse({ kind: 'cancelled' })).toEqual({ kind: 'cancelled' });
    expect(
      projectImportResultSchema.parse({
        kind: 'selected',
        preview: {
          selectionId: 'b1b2c3d4-e5f6-47a8-9012-abcdef123456',
          name: 'sample',
          rootPath: '/workspace/sample',
          repositoryType: 'local',
          repositoryIndicators: [],
        },
      }),
    ).toMatchObject({ kind: 'selected' });
    expect(projectImportResultSchema.parse({ kind: 'duplicate', project })).toMatchObject({
      kind: 'duplicate',
      project: { id: project.id },
    });
  });

  it('rejects an import preview without a valid selection token', () => {
    expect(
      projectImportResultSchema.safeParse({
        kind: 'selected',
        preview: {
          selectionId: '../project',
          name: 'sample',
          rootPath: '/workspace/sample',
          repositoryType: 'local',
          repositoryIndicators: [],
        },
      }).success,
    ).toBe(false);
  });
});
