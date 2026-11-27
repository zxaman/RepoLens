import { z } from 'zod';

export const scanStatusSchema = z.enum([
  'idle',
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const scanSummarySchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    status: scanStatusSchema,
    startedAt: z.iso.datetime().optional(),
    completedAt: z.iso.datetime().optional(),
    error: z.string().min(1).optional(),
  })
  .strict();

export type ScanStatus = z.infer<typeof scanStatusSchema>;
export type ScanSummary = z.infer<typeof scanSummarySchema>;
