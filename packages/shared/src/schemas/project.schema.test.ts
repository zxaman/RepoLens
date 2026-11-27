import { describe, expect, it } from 'vitest';
import { projectSchema } from './project.schema.js';

const validProject = {
  id: 'a1b2c3d4-e5f6-47a8-9012-abcdef123456',
  name: 'Sample',
  rootPath: '/workspace/sample',
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
  status: 'registered' as const,
  repositoryType: 'local' as const,
  repositoryIndicators: [],
};

describe('projectSchema', () => {
  it('accepts a valid project contract and optional recent-open metadata', () => {
    expect(
      projectSchema.parse({ ...validProject, lastOpenedAt: '2026-11-28T00:00:00.000Z' }),
    ).toEqual({
      ...validProject,
      lastOpenedAt: '2026-11-28T00:00:00.000Z',
    });
  });

  it('rejects invalid identifiers, timestamps, names, and unexpected fields', () => {
    expect(projectSchema.safeParse({ ...validProject, id: 'not-a-uuid' }).success).toBe(false);
    expect(projectSchema.safeParse({ ...validProject, createdAt: 'yesterday' }).success).toBe(
      false,
    );
    expect(projectSchema.safeParse({ ...validProject, name: '../escape' }).success).toBe(false);
    expect(
      projectSchema.safeParse({ ...validProject, secret: 'not part of the contract' }).success,
    ).toBe(false);
  });
});
