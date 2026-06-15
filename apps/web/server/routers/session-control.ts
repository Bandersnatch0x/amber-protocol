import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { sessionEvents } from '../services/session-events';
import { readSessionById } from '../lib/session-reader';
import { SessionStatusSchema } from '../types/session-events';

const statusTransitions: Record<string, string[]> = {
  idle: ['running'],
  running: ['paused', 'aborted', 'completed'],
  paused: ['running', 'aborted'],
  completed: [],
  aborted: [],
};

export const sessionControlRouter = router({
  start: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const session = readSessionById(input.sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const currentStatus = session.status;
      if (!statusTransitions[currentStatus]?.includes('running')) {
        if (currentStatus === 'running') return { status: currentStatus, timestamp: Date.now() };
        throw new Error(`Cannot start from status: ${currentStatus}`);
      }

      sessionEvents.emitSessionStarted(input.sessionId);
      return { status: 'running', timestamp: Date.now() };
    }),

  pause: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const session = readSessionById(input.sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const currentStatus = session.status;
      if (!statusTransitions[currentStatus]?.includes('paused')) {
        if (currentStatus === 'paused') return { status: currentStatus, timestamp: Date.now() };
        throw new Error(`Cannot pause from status: ${currentStatus}`);
      }

      sessionEvents.emitSessionPaused(input.sessionId);
      return { status: 'paused', timestamp: Date.now() };
    }),

  resume: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const session = readSessionById(input.sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const currentStatus = session.status;
      if (!statusTransitions[currentStatus]?.includes('running')) {
        if (currentStatus === 'running') return { status: currentStatus, timestamp: Date.now() };
        throw new Error(`Cannot resume from status: ${currentStatus}`);
      }

      sessionEvents.emitSessionResumed(input.sessionId);
      return { status: 'running', timestamp: Date.now() };
    }),

  abort: publicProcedure
    .input(z.object({ sessionId: z.string(), reason: z.string().optional() }))
    .mutation(({ input }) => {
      const session = readSessionById(input.sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const currentStatus = session.status;
      if (!statusTransitions[currentStatus]?.includes('aborted')) {
        if (currentStatus === 'aborted') return { status: currentStatus, timestamp: Date.now() };
        throw new Error(`Cannot abort from status: ${currentStatus}`);
      }

      sessionEvents.emitSessionAborted(input.sessionId, input.reason);
      return { status: 'aborted', timestamp: Date.now() };
    }),
});
