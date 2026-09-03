import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { readSessionList, readSessionById, readTimelineEvents } from '../lib/session-reader';
import { readSessionAuditSummary } from '../lib/session-audit-writer';

const sessionIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'Invalid session ID format');

export const sessionRouter = router({
  list: publicProcedure.query(() => {
    return readSessionList();
  }),

  byId: publicProcedure.input(z.object({ id: sessionIdSchema })).query(({ input }) => {
    const session = readSessionById(input.id);
    if (!session) {
      throw new Error('Session not found');
    }
    return session;
  }),

  timeline: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
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

  auditSummary: publicProcedure.input(z.object({ sessionId: sessionIdSchema })).query(({ input }) => {
    return readSessionAuditSummary(input.sessionId);
  }),
});
