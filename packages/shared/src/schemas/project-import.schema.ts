import { z } from 'zod';
import { projectIndicatorSchema, projectSchema } from './project.schema.js';

export const projectImportPreviewSchema = z
  .object({
    selectionId: z.uuid(),
    name: z.string().min(1).max(255),
    rootPath: z.string().min(1).max(4096),
    repositoryType: z.enum(['git', 'local']),
    repositoryIndicators: z.array(projectIndicatorSchema),
  })
  .strict();

export const projectImportResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cancelled') }).strict(),
  z.object({ kind: z.literal('selected'), preview: projectImportPreviewSchema }).strict(),
  z.object({ kind: z.literal('duplicate'), project: projectSchema }).strict(),
]);

export const projectImportCommitResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('created'), project: projectSchema }).strict(),
  z.object({ kind: z.literal('duplicate'), project: projectSchema }).strict(),
]);

export type ProjectImportPreview = z.infer<typeof projectImportPreviewSchema>;
export type ProjectImportResult = z.infer<typeof projectImportResultSchema>;
export type ProjectImportCommitResult = z.infer<typeof projectImportCommitResultSchema>;
