import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { readSessionList, readSessionById, readTimelineEvents } from '../lib/session-reader';
import { readSessionAuditSummary } from '../lib/session-audit-writer';

export const sessionRouter = router({
  list: publicProcedure.query(() => {
    return readSessionList();
  }),

  byId: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const session = readSessionById(input.id);
    if (!session) {
      throw new Error('Session not found');
    }
    return session;
  }),

  timeline: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        limit: z.number().optional(),
        tail: z.number().optional(),
      }),
    )
    .query(({ input }) => {
      return readTimelineEvents(input.sessionId, {
        limit: input.limit,
        tail: input.tail,
      });
    }),

  auditSummary: publicProcedure.input(z.object({ sessionId: z.string() })).query(({ input }) => {
    return readSessionAuditSummary(input.sessionId);
  }),
});
