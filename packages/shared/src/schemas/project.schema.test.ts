import { describe, expect, it } from 'vitest';
import { projectSchema } from './project.schema.js';

const validProject = {
  id: 'project-1',
  name: 'Sample',
  rootPath: '/workspace/sample',
  createdAt: '2026-11-27T00:00:00.000Z',
  updatedAt: '2026-11-27T00:00:00.000Z',
};

describe('projectSchema', () => {
  it('accepts a valid project contract', () => {
    expect(projectSchema.parse(validProject)).toEqual(validProject);
  });

  it('rejects invalid timestamps and unexpected fields', () => {
    expect(projectSchema.safeParse({ ...validProject, createdAt: 'yesterday' }).success).toBe(
      false,
    );
    expect(
      projectSchema.safeParse({ ...validProject, secret: 'not part of the contract' }).success,
    ).toBe(false);
  });
});
