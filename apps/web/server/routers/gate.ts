import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { listGates, getGate, approveGate, rejectGate } from '../lib/gate-reader';
import { readSessionById } from '../lib/session-reader';
import { persistSessionStatus } from '../lib/session-writer';
import { sessionEvents } from '../services/session-events';

function tryEmitGatePassed(sessionId: string, gateId: string): string | undefined {
  try {
    sessionEvents.emitGatePassed(sessionId, gateId);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'Gate decision event failed';
  }
}

function tryEmitGateFailed(sessionId: string, gateId: string, reason: string): string | undefined {
  try {
    sessionEvents.emitGateFailed(sessionId, gateId, reason);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'Gate rejection event failed';
  }
}

function tryEmitSessionResumed(sessionId: string): string | undefined {
  try {
    sessionEvents.emitSessionResumed(sessionId);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'Resume event failed';
  }
}

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
      const eventWarning = tryEmitGatePassed(input.sessionId, input.gateId);
      if (eventWarning) return { success: true, eventWarning };
      return { success: true };
    }),

  approveAndResume: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      gateId: z.string(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const session = readSessionById(input.sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const gate = await getGate(input.sessionId, input.gateId);
      if (!gate) {
        throw new Error('Gate not found');
      }
      if (gate.sessionId !== input.sessionId) {
        throw new Error('Gate does not belong to session');
      }
      if (gate.status !== 'pending') {
        throw new Error(`Gate already ${gate.status}`);
      }

      await approveGate(input.sessionId, input.gateId, input.reason);
      const eventWarning = tryEmitGatePassed(input.sessionId, input.gateId);

      if (session.status === 'paused') {
        try {
          const confirmedSession = await persistSessionStatus(input.sessionId, 'running');
          if (confirmedSession.status !== 'running') {
            return {
              success: true,
              gateStatus: 'approved' as const,
              sessionStatus: confirmedSession.status,
              resumeRequested: true,
              resumeConfirmed: false,
              resumed: false,
              message: `Session status persistence was not confirmed: expected running, got ${confirmedSession.status}`,
              eventWarning,
              timestamp: Date.now(),
            };
          }

          const resumeEventWarning = tryEmitSessionResumed(input.sessionId);
          return {
            success: true,
            gateStatus: 'approved' as const,
            sessionStatus: confirmedSession.status,
            resumeRequested: true,
            resumeConfirmed: true,
            resumed: true,
            message: 'Session status persisted as running',
            eventWarning,
            resumeEventWarning,
            timestamp: Date.now(),
          };
        } catch (error) {
          return {
            success: true,
            gateStatus: 'approved' as const,
            sessionStatus: session.status,
            resumeRequested: true,
            resumeConfirmed: false,
            resumed: false,
            message: error instanceof Error ? error.message : 'Resume persistence failed',
            eventWarning,
            timestamp: Date.now(),
          };
        }
      }

      if (session.status === 'running') {
        return {
          success: true,
          gateStatus: 'approved' as const,
          sessionStatus: 'running',
          resumeRequested: false,
          resumeConfirmed: true,
          resumed: true,
          message: 'Session is already running',
          eventWarning,
          timestamp: Date.now(),
        };
      }

      return {
        success: true,
        gateStatus: 'approved' as const,
        sessionStatus: session.status,
        resumeRequested: false,
        resumeConfirmed: false,
        resumed: false,
        message: `Session is ${session.status} and cannot be resumed`,
        eventWarning,
        timestamp: Date.now(),
      };
    }),

  reject: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      gateId: z.string(),
      reason: z.string().trim().min(1),
    }))
    .mutation(async ({ input }) => {
      await rejectGate(input.sessionId, input.gateId, input.reason);
      const eventWarning = tryEmitGateFailed(input.sessionId, input.gateId, input.reason);
      if (eventWarning) return { success: true, eventWarning };
      return { success: true };
    }),
});
