import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';

// Mock database - replace with actual DB calls
const profilesDb = new Map();
const sessionsDb = new Map();

export const profileRouter = router({
  getProfile: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ input }) => {
      const profile = profilesDb.get(input.userId);
      if (!profile) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Profile not found',
        });
      }
      return profile;
    }),

  updateProfile: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        name: z.string().min(1).max(255).optional(),
        bio: z.string().max(1000).optional(),
        version: z.number(),
      })
    )
    .mutation(({ input }) => {
      const current = profilesDb.get(input.userId);

      if (!current) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Profile not found',
        });
      }

      if (current.version !== input.version) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Version conflict. Profile was modified by another session.',
        });
      }

      const updated = {
        ...current,
        name: input.name ?? current.name,
        bio: input.bio ?? current.bio,
        version: current.version + 1,
        updatedAt: new Date(),
      };

      profilesDb.set(input.userId, updated);
      return updated;
    }),

  getSessions: publicProcedure
    .input(z.object({ userId: z.string() }))
    .query(({ input }) => {
      const sessions = Array.from(sessionsDb.values())
        .filter((s: any) => s.userId === input.userId)
        .sort((a: any, b: any) => b.lastActive.getTime() - a.lastActive.getTime());
      return sessions;
    }),

  revokeSession: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        sessionId: z.string(),
        currentSessionId: z.string(),
      })
    )
    .mutation(({ input }) => {
      if (input.sessionId === input.currentSessionId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot revoke current session',
        });
      }

      const session = sessionsDb.get(input.sessionId);
      if (!session || session.userId !== input.userId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Session not found',
        });
      }

      sessionsDb.delete(input.sessionId);
      return { success: true };
    }),

  deleteAccount: publicProcedure
    .input(
      z.object({
        userId: z.string(),
        password: z.string(),
        confirmText: z.literal('DELETE'),
      })
    )
    .mutation(({ input }) => {
      // Soft delete with 30-day retention for GDPR
      const profile = profilesDb.get(input.userId);
      if (!profile) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Profile not found',
        });
      }

      // Mark deleted (actual password verification would happen here)
      profile.deletedAt = new Date();
      profilesDb.set(input.userId, profile);

      // Schedule cleanup job (would be a background job in production)
      // After 30 days: hard delete from all tables

      return { success: true };
    }),
});
