import { describe, expect, it } from 'vitest';
import { createAnalysisContext } from './analysis-context.js';

describe('createAnalysisContext', () => {
  it('keeps only the project identity needed by the analysis engine', () => {
    const context = createAnalysisContext({
      id: 'project-1',
      rootPath: '/workspace/sample',
    });

    expect(context).toEqual({
      project: {
        id: 'project-1',
        rootPath: '/workspace/sample',
      },
    });
  });
});
