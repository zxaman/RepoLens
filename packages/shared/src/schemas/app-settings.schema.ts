import { z } from 'zod';

export const appSettingsSchema = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    defaultProjectId: z.uuid().nullable(),
    confirmBeforeRemovingProject: z.boolean(),
    recentProjectsLimit: z.number().int().min(1).max(50),
  })
  .strict();

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = Object.freeze({
  theme: 'system',
  defaultProjectId: null,
  confirmBeforeRemovingProject: true,
  recentProjectsLimit: 10,
});
