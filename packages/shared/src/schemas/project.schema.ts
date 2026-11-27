import { z } from 'zod';

export const projectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    rootPath: z.string().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export type Project = z.infer<typeof projectSchema>;
