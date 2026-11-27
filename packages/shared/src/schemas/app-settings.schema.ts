import { z } from 'zod';

export const appSettingsSchema = z
  .object({
    appearance: z.enum(['system', 'light', 'dark']),
  })
  .strict();

export type AppSettings = z.infer<typeof appSettingsSchema>;
