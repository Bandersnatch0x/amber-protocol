import { createRequire } from 'module';
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
import type { WebAdapter } from '../../../../scripts/lib/web-adapter';

// CLI session transition SSOT folded into the web-adapter seam (ADR-0007
// principle 4: one seam only). Web does not keep a second ALLOWED_TRANSITIONS
// table; legality comes from adapter.isLegalSessionTransition.
const requireCli = createRequire(import.meta.url);
const adapter = requireCli('../../../../scripts/lib/web-adapter.js') as WebAdapter;
const { isLegalSessionTransition, SESSION_STATES } = adapter;

// Web-local action → target status. Sources are not listed here; legality is
// checked via isLegalSessionTransition after idle/running pre-normalization.
// start is special: from created it must go created→routed→executing (not a
// direct created→executing jump — matches continueSession).
const ACTION_TARGET: Record<RunnerControlAction, SessionStatus> = {
  start: 'executing',
  pause: 'paused',
  resume: 'executing',
  abort: 'aborted',
};

/**
 * Map legacy web-only statuses onto CLI vocabulary for legality checks.
 * idle → created, running → executing. Canonical statuses pass through.
 */
function normalizeStatus(status: string): string {
  if (status === 'idle') return SESSION_STATES.CREATED;
  if (status === 'running') return SESSION_STATES.EXECUTING;
  return status;
}

/**
 * Whether the control action may be invoked from the (possibly legacy) status.
 *
 * Action semantics are NOT pure graph edges:
 * - start: only created/routed (created goes via routed first; never pause→executing)
 * - resume: only paused (routed→executing is a legal CLI edge, but that is start, not resume)
 * - pause/abort: pure SSOT edges after idle/running pre-normalization
 */
function canInvokeAction(action: RunnerControlAction, status: string): boolean {
  const from = normalizeStatus(status);
  const target = ACTION_TARGET[action];

  if (action === 'start') {
    // start path: created (via routed) or already routed — never pause→executing
    return from === SESSION_STATES.CREATED || from === SESSION_STATES.ROUTED;
  }

  if (action === 'resume') {
    // resume is only "continue after pause". Do not treat routed→executing as resume
    // even though that edge is legal in the CLI SSOT graph (start owns that path).
    return from === SESSION_STATES.PAUSED;
  }

  return isLegalSessionTransition(from, target);
}

const controlInputSchema = z.object({ sessionId: z.string() });
const abortInputSchema = controlInputSchema.extend({ reason: z.string().optional() });

function mergeWarnings(...warnings: Array<string | undefined>): string | undefined {
  const values = Array.from(
    new Set(warnings.filter((warning): warning is string => Boolean(warning))),
  );
  return values.length > 0 ? values.join('; ') : undefined;
}

async function persistAndConfirmStatus(
  sessionId: string,
  status: SessionStatus,
): Promise<SessionStatus> {
  const confirmed = await persistSessionStatus(sessionId, status);
  if (confirmed.status !== status) {
    throw new Error(
      `Session status persistence was not confirmed: expected ${status}, got ${confirmed.status}`,
    );
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

/**
 * Intermediate created→routed bookkeeping for web start (mirrors continueSession).
 * No runner handshake — routing is local metadata before start→executing.
 */
async function transitionCreatedToRouted(sessionId: string): Promise<{
  status: SessionStatus;
  warning?: string;
}> {
  if (!isLegalSessionTransition(SESSION_STATES.CREATED, SESSION_STATES.ROUTED)) {
    throw new Error(`Cannot start from status: ${SESSION_STATES.CREATED}`);
  }

  const status = await persistAndConfirmStatus(sessionId, SESSION_STATES.ROUTED as SessionStatus);

  try {
    const data = {
      sessionId,
      fromState: SESSION_STATES.CREATED,
      toState: SESSION_STATES.ROUTED,
      source: 'web-control',
    };
    await appendSessionTimelineEvent(sessionId, {
      type: 'route_selected',
      data,
    });
    await appendSessionLedgerRecord(sessionId, {
      schemaVersion: 2,
      kind: 'route_selected',
      ...data,
      status: SESSION_STATES.ROUTED,
    });
    return { status };
  } catch (error) {
    return {
      status,
      warning: error instanceof Error ? error.message : 'Route audit write failed',
    };
  }
}

async function recordRunnerControlRequest(
  request: RunnerControlRequest,
): Promise<string | undefined> {
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

function runnerEventType(
  outcome: RunnerAckOutcome,
): 'runner_ack' | 'runner_rejected' | 'runner_timeout' {
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

interface ControlledTransitionParams {
  sessionId: string;
  action: RunnerControlAction;
  currentStatus: SessionStatus;
  targetStatus: SessionStatus;
  eventType: 'session_started' | 'session_paused' | 'session_resumed' | 'session_aborted';
  eventData?: Record<string, unknown>;
  emit: () => void;
}

// Shared happy-path pipeline for all control mutations: runner confirm -> reject
// short-circuit -> persist -> ack/audit records -> emit. Disallowed-status fallbacks
// stay in each mutation because they genuinely differ per action.
async function runControlledTransition({
  sessionId,
  action,
  currentStatus,
  targetStatus,
  eventType,
  eventData = {},
  emit,
}: ControlledTransitionParams) {
  const runner = await confirmRunnerControl({
    sessionId,
    action,
    requestedStatus: targetStatus,
  });
  if (runner.runnerAck.status === 'rejected') {
    return rejectedControlResult(currentStatus, runner);
  }
  const status = await persistAndConfirmStatus(sessionId, targetStatus);
  const runnerWarning = await tryRecordRunnerAckOutcome(runner.runnerAck);
  const auditWarning = await tryRecordSessionEvent(sessionId, eventType, status, {
    source: 'web-control',
    ...eventData,
  });
  emit();
  return {
    status,
    timestamp: Date.now(),
    persisted: true,
    confirmed: true,
    runnerAck: runner.runnerAck,
    confirmation: confirmation(runner.requestPersisted, true, runner.runnerAck),
    auditWarning: mergeWarnings(auditWarning, runner.warning, runnerWarning),
  };
}

export const sessionControlRouter = router({
  start: publicProcedure.input(controlInputSchema).mutation(async ({ input }) => {
    const session = readSessionById(input.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const currentStatus = session.status;
    const action: RunnerControlAction = 'start';

    // Legacy recovery: running is treated as executing (already started).
    if (currentStatus === 'running') {
      const status = await persistAndConfirmStatus(input.sessionId, 'executing');
      return { status, timestamp: Date.now(), persisted: true, confirmed: true };
    }
    if (currentStatus === 'executing') {
      return { status: currentStatus, timestamp: Date.now(), persisted: true, confirmed: true };
    }

    if (!canInvokeAction(action, currentStatus)) {
      throw new Error(`Cannot ${action} from status: ${currentStatus}`);
    }

    // created (and legacy idle) must not jump to executing — route first, then execute.
    let routeWarning: string | undefined;
    let statusForTransition: SessionStatus = currentStatus as SessionStatus;
    if (normalizeStatus(currentStatus) === SESSION_STATES.CREATED) {
      const routed = await transitionCreatedToRouted(input.sessionId);
      statusForTransition = routed.status;
      routeWarning = routed.warning;
      if (!isLegalSessionTransition(SESSION_STATES.ROUTED, SESSION_STATES.EXECUTING)) {
        throw new Error(`Cannot ${action} from status: ${statusForTransition}`);
      }
    } else if (!isLegalSessionTransition(normalizeStatus(currentStatus), ACTION_TARGET.start)) {
      throw new Error(`Cannot ${action} from status: ${currentStatus}`);
    }

    const result = await runControlledTransition({
      sessionId: input.sessionId,
      action,
      currentStatus: statusForTransition,
      targetStatus: ACTION_TARGET.start,
      eventType: 'session_started',
      emit: () => sessionEvents.emitSessionStarted(input.sessionId),
    });

    return {
      ...result,
      auditWarning: mergeWarnings(routeWarning, result.auditWarning),
    };
  }),

  pause: publicProcedure.input(controlInputSchema).mutation(async ({ input }) => {
    const session = readSessionById(input.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const currentStatus = session.status;
    const action: RunnerControlAction = 'pause';
    if (!canInvokeAction(action, currentStatus)) {
      if (currentStatus === 'paused') return { status: currentStatus, timestamp: Date.now() };
      throw new Error(`Cannot ${action} from status: ${currentStatus}`);
    }

    return runControlledTransition({
      sessionId: input.sessionId,
      action,
      currentStatus: currentStatus as SessionStatus,
      targetStatus: ACTION_TARGET.pause,
      eventType: 'session_paused',
      emit: () => sessionEvents.emitSessionPaused(input.sessionId),
    });
  }),

  resume: publicProcedure.input(controlInputSchema).mutation(async ({ input }) => {
    const session = readSessionById(input.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const currentStatus = session.status;
    const action: RunnerControlAction = 'resume';

    // Legacy recovery: running is already-executing vocabulary drift.
    if (currentStatus === 'running') {
      const status = await persistAndConfirmStatus(input.sessionId, 'executing');
      return { status, timestamp: Date.now(), persisted: true, confirmed: true };
    }
    if (currentStatus === 'executing') {
      return { status: currentStatus, timestamp: Date.now(), persisted: true, confirmed: true };
    }

    if (!canInvokeAction(action, currentStatus)) {
      throw new Error(`Cannot ${action} from status: ${currentStatus}`);
    }

    return runControlledTransition({
      sessionId: input.sessionId,
      action,
      currentStatus: currentStatus as SessionStatus,
      targetStatus: ACTION_TARGET.resume,
      eventType: 'session_resumed',
      emit: () => sessionEvents.emitSessionResumed(input.sessionId),
    });
  }),

  abort: publicProcedure.input(abortInputSchema).mutation(async ({ input }) => {
    const session = readSessionById(input.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const currentStatus = session.status;
    const action: RunnerControlAction = 'abort';
    if (!canInvokeAction(action, currentStatus)) {
      if (currentStatus === 'aborted') return { status: currentStatus, timestamp: Date.now() };
      throw new Error(`Cannot ${action} from status: ${currentStatus}`);
    }

    return runControlledTransition({
      sessionId: input.sessionId,
      action,
      currentStatus: currentStatus as SessionStatus,
      targetStatus: ACTION_TARGET.abort,
      eventType: 'session_aborted',
      eventData: { reason: input.reason },
      emit: () => sessionEvents.emitSessionAborted(input.sessionId, input.reason),
    });
  }),
});
