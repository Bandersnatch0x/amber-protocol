import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { sessionEvents } from '../services/session-events';
import { readSessionById } from '../lib/session-reader';
import { appendSessionLedgerRecord, appendSessionTimelineEvent } from '../lib/session-audit-writer';
import { persistSessionStatus } from '../lib/session-writer';
import type { SessionStatus } from '../types/session-events';
import {
  createRunnerControlRequest,
  waitForRunnerAck,
  type RunnerAckOutcome,
  type RunnerControlAction,
  type RunnerControlRequest,
} from '../lib/runner-ack';

// Action-centric guard: each action declares which statuses it can be invoked from.
// This prevents semantic confusion where start/resume both target 'running' but mean
// different things (start=first execution, resume=continue after pause).
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  start: ['idle', 'created', 'routed'],
  pause: ['running', 'executing'],
  resume: ['paused'],
  abort: ['running', 'executing', 'paused'],
};

const controlInputSchema = z.object({ sessionId: z.string() });
const abortInputSchema = controlInputSchema.extend({ reason: z.string().optional() });

function mergeWarnings(...warnings: Array<string | undefined>): string | undefined {
  const values = Array.from(new Set(warnings.filter((warning): warning is string => Boolean(warning))));
  return values.length > 0 ? values.join('; ') : undefined;
}

async function persistAndConfirmStatus(sessionId: string, status: SessionStatus): Promise<SessionStatus> {
  const confirmed = await persistSessionStatus(sessionId, status);
  if (confirmed.status !== status) {
    throw new Error(`Session status persistence was not confirmed: expected ${status}, got ${confirmed.status}`);
  }
  return confirmed.status as SessionStatus;
}

async function tryRecordSessionEvent(
  sessionId: string,
  type: 'session_started' | 'session_paused' | 'session_resumed' | 'session_aborted',
  status: SessionStatus,
  data: Record<string, unknown> = {},
): Promise<string | undefined> {
  try {
    const eventData = Object.fromEntries(
      Object.entries({ sessionId, ...data }).filter(([, value]) => value !== undefined),
    );
    const ledgerRecord = Object.fromEntries(
      Object.entries({
        schemaVersion: 2,
        kind: type,
        sessionId,
        ...data,
        status,
      }).filter(([, value]) => value !== undefined),
    );

    await appendSessionTimelineEvent(sessionId, {
      type,
      data: eventData,
    });
    await appendSessionLedgerRecord(sessionId, ledgerRecord);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'Session audit write failed';
  }
}

async function recordRunnerControlRequest(request: RunnerControlRequest): Promise<string | undefined> {
  const data = {
    sessionId: request.sessionId,
    requestId: request.requestId,
    action: request.action,
    requestedStatus: request.requestedStatus,
    source: 'web-control',
  };

  await appendSessionTimelineEvent(request.sessionId, {
    type: 'runner_control_requested',
    data,
  });

  try {
    await appendSessionLedgerRecord(request.sessionId, {
      schemaVersion: 2,
      kind: 'runner_control_requested',
      ...data,
      status: request.requestedStatus,
    });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'Runner control request ledger write failed';
  }
}

function runnerEventType(outcome: RunnerAckOutcome): 'runner_ack' | 'runner_rejected' | 'runner_timeout' {
  if (outcome.status === 'acked') return 'runner_ack';
  if (outcome.status === 'rejected') return 'runner_rejected';
  return 'runner_timeout';
}

async function tryRecordRunnerAckOutcome(outcome: RunnerAckOutcome): Promise<string | undefined> {
  try {
    const type = runnerEventType(outcome);
    const data = Object.fromEntries(
      Object.entries({
        sessionId: outcome.sessionId,
        requestId: outcome.requestId,
        action: outcome.action,
        requestedStatus: outcome.requestedStatus,
        runnerStatus: outcome.status,
        source: outcome.source,
        message: outcome.message,
      }).filter(([, value]) => value !== undefined),
    );

    await appendSessionTimelineEvent(outcome.sessionId, {
      type,
      data,
    });
    await appendSessionLedgerRecord(outcome.sessionId, {
      schemaVersion: 2,
      kind: type,
      ...data,
      status: outcome.requestedStatus,
    });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : 'Runner ACK audit write failed';
  }
}

async function confirmRunnerControl({
  sessionId,
  action,
  requestedStatus,
}: {
  sessionId: string;
  action: RunnerControlAction;
  requestedStatus: SessionStatus;
}): Promise<{
  runnerAck: RunnerAckOutcome;
  requestPersisted: boolean;
  warning?: string;
}> {
  const request = createRunnerControlRequest({ sessionId, action, requestedStatus });
  const requestWarning = await recordRunnerControlRequest(request);
  const runnerAck = await waitForRunnerAck(request);

  return {
    runnerAck,
    requestPersisted: true,
    warning: requestWarning,
  };
}

function confirmation(
  requestPersisted: boolean,
  manifestConfirmed: boolean,
  runnerAck: RunnerAckOutcome,
) {
  return {
    requestPersisted,
    manifestConfirmed,
    runnerAckStatus: runnerAck.status,
  };
}

async function rejectedControlResult(
  currentStatus: SessionStatus,
  runner: {
    runnerAck: RunnerAckOutcome;
    requestPersisted: boolean;
    warning?: string;
  },
) {
  const ackWarning = await tryRecordRunnerAckOutcome(runner.runnerAck);
  return {
    status: currentStatus,
    timestamp: Date.now(),
    persisted: false,
    confirmed: false,
    runnerAck: runner.runnerAck,
    confirmation: confirmation(runner.requestPersisted, false, runner.runnerAck),
    auditWarning: mergeWarnings(runner.warning, ackWarning),
  };
}

export const sessionControlRouter = router({
  start: publicProcedure
    .input(controlInputSchema)
    .mutation(async ({ input }) => {
      const session = readSessionById(input.sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const currentStatus = session.status;
      const action = 'start';
      if (!ALLOWED_TRANSITIONS[action].includes(currentStatus)) {
        if (currentStatus === 'running') {
          const status = await persistAndConfirmStatus(input.sessionId, 'executing');
          return { status, timestamp: Date.now(), persisted: true, confirmed: true };
        }
        if (currentStatus === 'executing') return { status: currentStatus, timestamp: Date.now(), persisted: true, confirmed: true };
        throw new Error(`Cannot ${action} from status: ${currentStatus}`);
      }

      const runner = await confirmRunnerControl({
        sessionId: input.sessionId,
        action,
        requestedStatus: 'executing',
      });
      if (runner.runnerAck.status === 'rejected') {
        return rejectedControlResult(currentStatus as SessionStatus, runner);
      }
      const status = await persistAndConfirmStatus(input.sessionId, 'executing');
      const runnerWarning = await tryRecordRunnerAckOutcome(runner.runnerAck);
      const auditWarning = await tryRecordSessionEvent(input.sessionId, 'session_started', status, { source: 'web-control' });
      sessionEvents.emitSessionStarted(input.sessionId);
      return {
        status,
        timestamp: Date.now(),
        persisted: true,
        confirmed: true,
        runnerAck: runner.runnerAck,
        confirmation: confirmation(runner.requestPersisted, true, runner.runnerAck),
        auditWarning: mergeWarnings(auditWarning, runner.warning, runnerWarning),
      };
    }),

  pause: publicProcedure
    .input(controlInputSchema)
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

      const runner = await confirmRunnerControl({
        sessionId: input.sessionId,
        action,
        requestedStatus: 'paused',
      });
      if (runner.runnerAck.status === 'rejected') {
        return rejectedControlResult(currentStatus as SessionStatus, runner);
      }
      const status = await persistAndConfirmStatus(input.sessionId, 'paused');
      const runnerWarning = await tryRecordRunnerAckOutcome(runner.runnerAck);
      const auditWarning = await tryRecordSessionEvent(input.sessionId, 'session_paused', status, { source: 'web-control' });
      sessionEvents.emitSessionPaused(input.sessionId);
      return {
        status,
        timestamp: Date.now(),
        persisted: true,
        confirmed: true,
        runnerAck: runner.runnerAck,
        confirmation: confirmation(runner.requestPersisted, true, runner.runnerAck),
        auditWarning: mergeWarnings(auditWarning, runner.warning, runnerWarning),
      };
    }),

  resume: publicProcedure
    .input(controlInputSchema)
    .mutation(async ({ input }) => {
      const session = readSessionById(input.sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const currentStatus = session.status;
      const action = 'resume';
      if (!ALLOWED_TRANSITIONS[action].includes(currentStatus)) {
        if (currentStatus === 'running') {
          const status = await persistAndConfirmStatus(input.sessionId, 'executing');
          return { status, timestamp: Date.now(), persisted: true, confirmed: true };
        }
        if (currentStatus === 'executing') return { status: currentStatus, timestamp: Date.now(), persisted: true, confirmed: true };
        throw new Error(`Cannot ${action} from status: ${currentStatus}`);
      }

      const runner = await confirmRunnerControl({
        sessionId: input.sessionId,
        action,
        requestedStatus: 'executing',
      });
      if (runner.runnerAck.status === 'rejected') {
        return rejectedControlResult(currentStatus as SessionStatus, runner);
      }
      const status = await persistAndConfirmStatus(input.sessionId, 'executing');
      const runnerWarning = await tryRecordRunnerAckOutcome(runner.runnerAck);
      const auditWarning = await tryRecordSessionEvent(input.sessionId, 'session_resumed', status, { source: 'web-control' });
      sessionEvents.emitSessionResumed(input.sessionId);
      return {
        status,
        timestamp: Date.now(),
        persisted: true,
        confirmed: true,
        runnerAck: runner.runnerAck,
        confirmation: confirmation(runner.requestPersisted, true, runner.runnerAck),
        auditWarning: mergeWarnings(auditWarning, runner.warning, runnerWarning),
      };
    }),

  abort: publicProcedure
    .input(abortInputSchema)
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

      const runner = await confirmRunnerControl({
        sessionId: input.sessionId,
        action,
        requestedStatus: 'aborted',
      });
      if (runner.runnerAck.status === 'rejected') {
        return rejectedControlResult(currentStatus as SessionStatus, runner);
      }
      const status = await persistAndConfirmStatus(input.sessionId, 'aborted');
      const runnerWarning = await tryRecordRunnerAckOutcome(runner.runnerAck);
      const auditWarning = await tryRecordSessionEvent(input.sessionId, 'session_aborted', status, {
        source: 'web-control',
        reason: input.reason,
      });
      sessionEvents.emitSessionAborted(input.sessionId, input.reason);
      return {
        status,
        timestamp: Date.now(),
        persisted: true,
        confirmed: true,
        runnerAck: runner.runnerAck,
        confirmation: confirmation(runner.requestPersisted, true, runner.runnerAck),
        auditWarning: mergeWarnings(auditWarning, runner.warning, runnerWarning),
      };
    }),
});
