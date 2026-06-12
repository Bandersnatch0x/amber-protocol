import { z } from 'zod';

export const settingsUpdateSchema = z.object({
  data: z.record(z.unknown()),
  version: z.number().int().positive(),
});

export const preferencesUpdateSchema = z.object({
  appearance: z
    .object({
      theme: z.enum(['light', 'dark', 'system']),
      density: z.enum(['comfortable', 'compact']),
    })
    .optional(),
  localization: z
    .object({
      locale: z.string().min(2).max(10),
      timezone: z.string(),
    })
    .optional(),
  notifications: z
    .object({
      email: z.boolean(),
      push: z.boolean(),
    })
    .optional(),
  version: z.number().int().positive(),
});

export const profileUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  bio: z.string().max(1000).optional(),
  email: z.string().email().optional(),
  version: z.number().int().positive(),
});

export const configUpdateSchema = z.object({
  key: z.string().min(1).max(255),
  value: z.unknown(),
  environment: z.string().default('production'),
  version: z.number().int().positive(),
});

export const settingsExportSchema = z.object({
  version: z.literal('1.0'),
  exportedAt: z.string().datetime(),
  userId: z.string(),
  settings: z.record(z.unknown()),
  preferences: z.object({
    appearance: z.object({
      theme: z.enum(['light', 'dark', 'system']),
      density: z.enum(['comfortable', 'compact']),
    }),
    localization: z.object({
      locale: z.string(),
      timezone: z.string(),
    }),
    notifications: z.object({
      email: z.boolean(),
      push: z.boolean(),
    }),
  }),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8).max(128),
});

export type SettingsExport = z.infer<typeof settingsExportSchema>;
