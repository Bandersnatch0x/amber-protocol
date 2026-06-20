import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { sessionEvents } from '../services/session-events';
import { readSessionById } from '../lib/session-reader';
import { SessionStatusSchema } from '../types/session-events';

// Action-centric guard: each action declares which statuses it can be invoked from.
// This prevents semantic confusion where start/resume both target 'running' but mean
// different things (start=first execution, resume=continue after pause).
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  start: ['idle'],
  pause: ['running'],
  resume: ['paused'],
  abort: ['running', 'paused'],
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
      const action = 'start';
      if (!ALLOWED_TRANSITIONS[action].includes(currentStatus)) {
        if (currentStatus === 'running') return { status: currentStatus, timestamp: Date.now() };
        throw new Error(`Cannot ${action} from status: ${currentStatus}`);
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
      const action = 'pause';
      if (!ALLOWED_TRANSITIONS[action].includes(currentStatus)) {
        if (currentStatus === 'paused') return { status: currentStatus, timestamp: Date.now() };
        throw new Error(`Cannot ${action} from status: ${currentStatus}`);
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
      const action = 'resume';
      if (!ALLOWED_TRANSITIONS[action].includes(currentStatus)) {
        if (currentStatus === 'running') return { status: currentStatus, timestamp: Date.now() };
        throw new Error(`Cannot ${action} from status: ${currentStatus}`);
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
      const action = 'abort';
      if (!ALLOWED_TRANSITIONS[action].includes(currentStatus)) {
        if (currentStatus === 'aborted') return { status: currentStatus, timestamp: Date.now() };
        throw new Error(`Cannot ${action} from status: ${currentStatus}`);
      }

      sessionEvents.emitSessionAborted(input.sessionId, input.reason);
      return { status: 'aborted', timestamp: Date.now() };
    }),
});
