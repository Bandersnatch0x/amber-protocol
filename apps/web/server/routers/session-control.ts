import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { sessionEvents } from '../services/session-events';
import { readSessionById } from '../lib/session-reader';
import { persistSessionStatus } from '../lib/session-writer';
import type { SessionStatus } from '../types/session-events';

// Action-centric guard: each action declares which statuses it can be invoked from.
// This prevents semantic confusion where start/resume both target 'running' but mean
// different things (start=first execution, resume=continue after pause).
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  start: ['idle'],
  pause: ['running'],
  resume: ['paused'],
  abort: ['running', 'paused'],
};

async function persistAndConfirmStatus(sessionId: string, status: SessionStatus): Promise<SessionStatus> {
  const confirmed = await persistSessionStatus(sessionId, status);
  if (confirmed.status !== status) {
    throw new Error(`Session status persistence was not confirmed: expected ${status}, got ${confirmed.status}`);
  }
  return confirmed.status as SessionStatus;
}

export const sessionControlRouter = router({
  start: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
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

      const status = await persistAndConfirmStatus(input.sessionId, 'running');
      sessionEvents.emitSessionStarted(input.sessionId);
      return { status, timestamp: Date.now(), persisted: true, confirmed: true };
    }),

  pause: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
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

      const status = await persistAndConfirmStatus(input.sessionId, 'paused');
      sessionEvents.emitSessionPaused(input.sessionId);
      return { status, timestamp: Date.now(), persisted: true, confirmed: true };
    }),

  resume: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
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

      const status = await persistAndConfirmStatus(input.sessionId, 'running');
      sessionEvents.emitSessionResumed(input.sessionId);
      return { status, timestamp: Date.now(), persisted: true, confirmed: true };
    }),

  abort: publicProcedure
    .input(z.object({ sessionId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
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

      const status = await persistAndConfirmStatus(input.sessionId, 'aborted');
      sessionEvents.emitSessionAborted(input.sessionId, input.reason);
      return { status, timestamp: Date.now(), persisted: true, confirmed: true };
    }),
});
