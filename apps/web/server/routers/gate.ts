import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { listGates, getGate, approveGate, rejectGate } from '@/lib/gate-reader';

export const gateRouter = router({
  list: publicProcedure
    .input(z.object({
      sessionId: z.string().optional(),
      status: z.enum(['pending', 'approved', 'rejected']).optional(),
    }).optional())
    .query(async ({ input }) => {
      return await listGates(input || {});
    }),

  byId: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      gateId: z.string(),
    }))
    .query(async ({ input }) => {
      return await getGate(input.sessionId, input.gateId);
    }),

  approve: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      gateId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await approveGate(input.sessionId, input.gateId, input.reason);
      return { success: true };
    }),

  reject: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      gateId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await rejectGate(input.sessionId, input.gateId, input.reason);
      return { success: true };
    }),
});
