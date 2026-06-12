import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import {
  settingsUpdateSchema,
  preferencesUpdateSchema,
  profileUpdateSchema,
  settingsExportSchema,
} from '@/lib/validators/settings';
import { TRPCError } from '@trpc/server';

// Mock database - replace with actual DB calls
const settingsDb = new Map();
const preferencesDb = new Map();
const profilesDb = new Map();

export const settingsRouter = router({
  getSettings: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ input }) => {
      const settings = settingsDb.get(input.userId) || {
        userId: input.userId,
        data: {},
        version: 1,
        updatedAt: new Date(),
      };
      return settings;
    }),

  updateSettings: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        data: z.record(z.unknown()),
        version: z.number(),
      })
    )
    .mutation(({ input }) => {
      const current = settingsDb.get(input.userId);

      // Optimistic locking check
      if (current && current.version !== input.version) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Version conflict. Settings were modified by another session.',
        });
      }

      const updated = {
        userId: input.userId,
        data: input.data,
        version: (current?.version || 0) + 1,
        updatedAt: new Date(),
      };

      settingsDb.set(input.userId, updated);
      return updated;
    }),

  getPreferences: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ input }) => {
      const prefs = preferencesDb.get(input.userId) || {
        userId: input.userId,
        appearance: { theme: 'system', density: 'comfortable' },
        localization: { locale: 'en', timezone: 'UTC' },
        notifications: { email: true, push: false },
        version: 1,
        updatedAt: new Date(),
      };
      return prefs;
    }),

  updatePreferences: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        appearance: z
          .object({
            theme: z.enum(['light', 'dark', 'system']),
            density: z.enum(['comfortable', 'compact']),
          })
          .optional(),
        localization: z
          .object({
            locale: z.string(),
            timezone: z.string(),
          })
          .optional(),
        notifications: z
          .object({
            email: z.boolean(),
            push: z.boolean(),
          })
          .optional(),
        version: z.number(),
      })
    )
    .mutation(({ input }) => {
      const current = preferencesDb.get(input.userId);

      if (current && current.version !== input.version) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Version conflict. Preferences were modified by another session.',
        });
      }

      const updated = {
        userId: input.userId,
        appearance: input.appearance || current?.appearance || { theme: 'system', density: 'comfortable' },
        localization: input.localization || current?.localization || { locale: 'en', timezone: 'UTC' },
        notifications: input.notifications || current?.notifications || { email: true, push: false },
        version: (current?.version || 0) + 1,
        updatedAt: new Date(),
      };

      preferencesDb.set(input.userId, updated);
      return updated;
    }),

  exportSettings: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ input }) => {
      const settings = settingsDb.get(input.userId) || { data: {} };
      const preferences = preferencesDb.get(input.userId) || {
        appearance: { theme: 'system', density: 'comfortable' },
        localization: { locale: 'en', timezone: 'UTC' },
        notifications: { email: true, push: false },
      };

      return {
        version: '1.0' as const,
        exportedAt: new Date().toISOString(),
        userId: input.userId,
        settings: settings.data,
        preferences: {
          appearance: preferences.appearance,
          localization: preferences.localization,
          notifications: preferences.notifications,
        },
      };
    }),

  importSettings: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        data: settingsExportSchema,
      })
    )
    .mutation(({ input }) => {
      // Version compatibility check
      if (input.data.version !== '1.0') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Unsupported export version',
        });
      }

      const currentSettings = settingsDb.get(input.userId) || { version: 0 };
      const currentPrefs = preferencesDb.get(input.userId) || { version: 0 };

      settingsDb.set(input.userId, {
        userId: input.userId,
        data: input.data.settings,
        version: currentSettings.version + 1,
        updatedAt: new Date(),
      });

      preferencesDb.set(input.userId, {
        userId: input.userId,
        ...input.data.preferences,
        version: currentPrefs.version + 1,
        updatedAt: new Date(),
      });

      return { success: true };
    }),
});
