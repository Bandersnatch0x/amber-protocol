import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sessionControlRouter } from '@server/routers/session-control';
import * as sessionReader from '@server/lib/session-reader';
import * as sessionWriter from '@server/lib/session-writer';
import * as sessionAuditWriter from '@server/lib/session-audit-writer';
import * as runnerAck from '@server/lib/runner-ack';
import { sessionEvents } from '@server/services/session-events';

vi.mock('@server/lib/session-reader', () => ({
  readSessionById: vi.fn(),
}));

vi.mock('@server/lib/session-writer', () => ({
  persistSessionStatus: vi.fn(),
}));

vi.mock('@server/lib/session-audit-writer', () => ({
  appendSessionLedgerRecord: vi.fn(),
  appendSessionTimelineEvent: vi.fn(),
}));

vi.mock('@server/lib/runner-ack', () => ({
  createRunnerControlRequest: vi.fn(
    ({
      sessionId,
      action,
      requestedStatus,
      requestId,
    }: {
      sessionId: string;
      action: string;
      requestedStatus: string;
      requestId?: string;
    }) => ({
      sessionId,
      action,
      requestedStatus,
      requestId: requestId ?? `${action}-request-1`,
    }),
  ),
  waitForRunnerAck: vi.fn(),
}));

vi.mock('@server/services/session-events', () => ({
  sessionEvents: {
    emitSessionStarted: vi.fn(),
    emitSessionPaused: vi.fn(),
    emitSessionResumed: vi.fn(),
    emitSessionAborted: vi.fn(),
  },
}));

const readSessionById = sessionReader.readSessionById as ReturnType<typeof vi.fn>;
const persistSessionStatus = sessionWriter.persistSessionStatus as ReturnType<typeof vi.fn>;
const appendSessionLedgerRecord = sessionAuditWriter.appendSessionLedgerRecord as ReturnType<
  typeof vi.fn
>;
const appendSessionTimelineEvent = sessionAuditWriter.appendSessionTimelineEvent as ReturnType<
  typeof vi.fn
>;
const createRunnerControlRequest = runnerAck.createRunnerControlRequest as ReturnType<typeof vi.fn>;
const waitForRunnerAck = runnerAck.waitForRunnerAck as ReturnType<typeof vi.fn>;

function mockSessionWithStatus(status: string): void {
  readSessionById.mockReturnValue({ id: 'session-1', goal: 'test', status });
  persistSessionStatus.mockImplementation(async (_sessionId: string, nextStatus: string) => ({
    id: 'session-1',
    goal: 'test',
    status: nextStatus,
  }));
}

const caller = sessionControlRouter.createCaller({});

describe('sessionControlRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appendSessionLedgerRecord.mockResolvedValue({});
    appendSessionTimelineEvent.mockResolvedValue(undefined);
    waitForRunnerAck.mockImplementation(async (request: Record<string, unknown>) => ({
      ...request,
      status: 'acked',
      source: 'test-runner',
      message: 'runner accepted',
      receivedAt: '2026-07-08T00:00:00.000Z',
    }));
  });

  describe('start', () => {
    it('emits session_started and returns executing when transitioning from idle (via routed)', async () => {
      mockSessionWithStatus('idle');

      const result = await caller.start({ sessionId: 'session-1' });

      // idle→created pre-normalization then created→routed→executing (CLI SSOT)
      expect(persistSessionStatus).toHaveBeenCalledWith('session-1', 'routed');
      expect(persistSessionStatus).toHaveBeenCalledWith('session-1', 'executing');
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'route_selected',
        data: {
          sessionId: 'session-1',
          fromState: 'created',
          toState: 'routed',
          source: 'web-control',
        },
      });
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'session_started',
        data: { sessionId: 'session-1', source: 'web-control' },
      });
      expect(appendSessionLedgerRecord).toHaveBeenCalledWith('session-1', {
        schemaVersion: 2,
        kind: 'session_started',
        sessionId: 'session-1',
        source: 'web-control',
        status: 'executing',
      });
      expect(sessionEvents.emitSessionStarted).toHaveBeenCalledWith('session-1');
      expect(result.status).toBe('executing');
      expect(result.confirmed).toBe(true);
      expect(createRunnerControlRequest).toHaveBeenCalledWith({
        sessionId: 'session-1',
        action: 'start',
        requestedStatus: 'executing',
      });
      expect(waitForRunnerAck).toHaveBeenCalledWith({
        sessionId: 'session-1',
        action: 'start',
        requestedStatus: 'executing',
        requestId: 'start-request-1',
      });
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'runner_ack',
        data: {
          sessionId: 'session-1',
          requestId: 'start-request-1',
          action: 'start',
          requestedStatus: 'executing',
          runnerStatus: 'acked',
          source: 'test-runner',
          message: 'runner accepted',
        },
      });
      expect(appendSessionLedgerRecord).toHaveBeenCalledWith('session-1', {
        schemaVersion: 2,
        kind: 'runner_ack',
        sessionId: 'session-1',
        requestId: 'start-request-1',
        action: 'start',
        requestedStatus: 'executing',
        runnerStatus: 'acked',
        source: 'test-runner',
        status: 'executing',
        message: 'runner accepted',
      });
      expect(result.runnerAck).toMatchObject({
        status: 'acked',
        requestId: 'start-request-1',
        action: 'start',
        requestedStatus: 'executing',
      });
    });

    it('from created routes through routed before executing (no direct created→executing)', async () => {
      mockSessionWithStatus('created');

      const result = await caller.start({ sessionId: 'session-1' });

      const persistCalls = persistSessionStatus.mock.calls.map(([, status]) => status);
      expect(persistCalls).toEqual(['routed', 'executing']);
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'route_selected',
        data: {
          sessionId: 'session-1',
          fromState: 'created',
          toState: 'routed',
          source: 'web-control',
        },
      });
      // Runner handshake only targets executing after routed is persisted
      expect(createRunnerControlRequest).toHaveBeenCalledWith({
        sessionId: 'session-1',
        action: 'start',
        requestedStatus: 'executing',
      });
      expect(createRunnerControlRequest).not.toHaveBeenCalledWith(
        expect.objectContaining({ requestedStatus: 'created' }),
      );
      expect(result.status).toBe('executing');
    });

    it('from routed goes directly to executing without an intermediate route step', async () => {
      mockSessionWithStatus('routed');

      const result = await caller.start({ sessionId: 'session-1' });

      expect(persistSessionStatus).toHaveBeenCalledWith('session-1', 'executing');
      expect(persistSessionStatus).not.toHaveBeenCalledWith('session-1', 'routed');
      expect(appendSessionTimelineEvent).not.toHaveBeenCalledWith(
        'session-1',
        expect.objectContaining({ type: 'route_selected' }),
      );
      expect(result.status).toBe('executing');
    });

    it('generates its own request id instead of accepting a caller-supplied id', async () => {
      mockSessionWithStatus('routed');

      await caller.start({ sessionId: 'session-1', requestId: 'replay-request' } as never);

      expect(createRunnerControlRequest).toHaveBeenCalledWith({
        sessionId: 'session-1',
        action: 'start',
        requestedStatus: 'executing',
      });
      expect(waitForRunnerAck).toHaveBeenCalledWith({
        sessionId: 'session-1',
        action: 'start',
        requestedStatus: 'executing',
        requestId: 'start-request-1',
      });
    });

    it('normalizes legacy running to executing when starting', async () => {
      mockSessionWithStatus('running');

      const result = await caller.start({ sessionId: 'session-1' });

      expect(persistSessionStatus).toHaveBeenCalledWith('session-1', 'executing');
      expect(result.status).toBe('executing');
      expect(sessionEvents.emitSessionStarted).not.toHaveBeenCalled();
    });

    it('records a timeout outcome when no runner ACK is observed', async () => {
      mockSessionWithStatus('routed');
      waitForRunnerAck.mockImplementation(async (request: Record<string, unknown>) => ({
        ...request,
        status: 'timeout',
        source: 'runner-ack-timeout',
        message: 'No runner ACK observed before timeout.',
        receivedAt: '2026-07-08T00:00:00.000Z',
      }));

      const result = await caller.start({ sessionId: 'session-1' });

      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'runner_timeout',
        data: {
          sessionId: 'session-1',
          requestId: 'start-request-1',
          action: 'start',
          requestedStatus: 'executing',
          runnerStatus: 'timeout',
          source: 'runner-ack-timeout',
          message: 'No runner ACK observed before timeout.',
        },
      });
      expect(result.runnerAck).toMatchObject({
        status: 'timeout',
        requestId: 'start-request-1',
      });
      expect(result.confirmation).toMatchObject({
        requestPersisted: true,
        manifestConfirmed: true,
        runnerAckStatus: 'timeout',
      });
    });

    it('does not transition when the runner control request cannot be persisted to timeline', async () => {
      mockSessionWithStatus('routed');
      appendSessionTimelineEvent.mockRejectedValueOnce(new Error('timeline locked'));

      await expect(caller.start({ sessionId: 'session-1' })).rejects.toThrow('timeline locked');

      expect(waitForRunnerAck).not.toHaveBeenCalled();
      expect(persistSessionStatus).not.toHaveBeenCalled();
      expect(sessionEvents.emitSessionStarted).not.toHaveBeenCalled();
    });

    it('rejects illegal transition from completed', async () => {
      mockSessionWithStatus('completed');

      await expect(caller.start({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot start from status: completed',
      );
      expect(sessionEvents.emitSessionStarted).not.toHaveBeenCalled();
    });

    it('rejects illegal transition from aborted', async () => {
      mockSessionWithStatus('aborted');

      await expect(caller.start({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot start from status: aborted',
      );
    });

    it('rejects illegal transition from paused', async () => {
      mockSessionWithStatus('paused');

      await expect(caller.start({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot start from status: paused',
      );
    });

    it('throws Session not found when session does not exist', async () => {
      readSessionById.mockReturnValue(null);

      await expect(caller.start({ sessionId: 'missing' })).rejects.toThrow('Session not found');
      expect(sessionEvents.emitSessionStarted).not.toHaveBeenCalled();
    });
  });

  describe('pause', () => {
    it('emits session_paused and returns paused when transitioning from running', async () => {
      mockSessionWithStatus('running');

      const result = await caller.pause({ sessionId: 'session-1' });

      expect(persistSessionStatus).toHaveBeenCalledWith('session-1', 'paused');
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'session_paused',
        data: { sessionId: 'session-1', source: 'web-control' },
      });
      expect(appendSessionLedgerRecord).toHaveBeenCalledWith('session-1', {
        schemaVersion: 2,
        kind: 'session_paused',
        sessionId: 'session-1',
        source: 'web-control',
        status: 'paused',
      });
      expect(sessionEvents.emitSessionPaused).toHaveBeenCalledWith('session-1');
      expect(result.status).toBe('paused');
      expect(result.confirmed).toBe(true);
      expect(result.runnerAck).toMatchObject({
        status: 'acked',
        action: 'pause',
        requestedStatus: 'paused',
      });
    });

    it('is idempotent: returns paused without emitting when already paused', async () => {
      mockSessionWithStatus('paused');

      const result = await caller.pause({ sessionId: 'session-1' });

      expect(result.status).toBe('paused');
      expect(sessionEvents.emitSessionPaused).not.toHaveBeenCalled();
    });

    it('rejects illegal transition from idle', async () => {
      mockSessionWithStatus('idle');

      await expect(caller.pause({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot pause from status: idle',
      );
    });

    it('rejects illegal transition from completed', async () => {
      mockSessionWithStatus('completed');

      await expect(caller.pause({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot pause from status: completed',
      );
    });

    it('throws Session not found when session does not exist', async () => {
      readSessionById.mockReturnValue(null);

      await expect(caller.pause({ sessionId: 'missing' })).rejects.toThrow('Session not found');
    });
  });

  describe('resume', () => {
    it('persists, confirms, emits session_resumed, and returns executing from paused', async () => {
      mockSessionWithStatus('paused');

      const result = await caller.resume({ sessionId: 'session-1' });

      expect(persistSessionStatus).toHaveBeenCalledWith('session-1', 'executing');
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'session_resumed',
        data: { sessionId: 'session-1', source: 'web-control' },
      });
      expect(appendSessionLedgerRecord).toHaveBeenCalledWith('session-1', {
        schemaVersion: 2,
        kind: 'session_resumed',
        sessionId: 'session-1',
        source: 'web-control',
        status: 'executing',
      });
      expect(sessionEvents.emitSessionResumed).toHaveBeenCalledWith('session-1');
      expect(result.status).toBe('executing');
      expect(result.confirmed).toBe(true);
      expect(result.runnerAck).toMatchObject({
        status: 'acked',
        action: 'resume',
        requestedStatus: 'executing',
      });
    });

    it('returns an unconfirmed result and leaves manifest untouched when runner rejects resume', async () => {
      mockSessionWithStatus('paused');
      waitForRunnerAck.mockImplementation(async (request: Record<string, unknown>) => ({
        ...request,
        status: 'rejected',
        source: 'test-runner',
        message: 'runner refused resume',
        receivedAt: '2026-07-08T00:00:00.000Z',
      }));

      const result = await caller.resume({ sessionId: 'session-1' });

      expect(persistSessionStatus).not.toHaveBeenCalled();
      expect(sessionEvents.emitSessionResumed).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        status: 'paused',
        persisted: false,
        confirmed: false,
        runnerAck: {
          status: 'rejected',
          action: 'resume',
          requestedStatus: 'executing',
          message: 'runner refused resume',
        },
        confirmation: {
          requestPersisted: true,
          manifestConfirmed: false,
          runnerAckStatus: 'rejected',
        },
      });
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'runner_rejected',
        data: {
          sessionId: 'session-1',
          requestId: 'resume-request-1',
          action: 'resume',
          requestedStatus: 'executing',
          runnerStatus: 'rejected',
          source: 'test-runner',
          message: 'runner refused resume',
        },
      });
    });

    it('rejects resume when persisted status cannot be confirmed', async () => {
      mockSessionWithStatus('paused');
      persistSessionStatus.mockResolvedValue({ id: 'session-1', goal: 'test', status: 'paused' });

      await expect(caller.resume({ sessionId: 'session-1' })).rejects.toThrow(
        'Session status persistence was not confirmed: expected executing, got paused',
      );
      expect(sessionEvents.emitSessionResumed).not.toHaveBeenCalled();
    });

    it('normalizes legacy running to executing without emitting when resuming', async () => {
      mockSessionWithStatus('running');

      const result = await caller.resume({ sessionId: 'session-1' });

      expect(persistSessionStatus).toHaveBeenCalledWith('session-1', 'executing');
      expect(result.status).toBe('executing');
      expect(sessionEvents.emitSessionResumed).not.toHaveBeenCalled();
    });

    it('rejects illegal transition from aborted', async () => {
      mockSessionWithStatus('aborted');

      await expect(caller.resume({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot resume from status: aborted',
      );
    });

    it('rejects illegal transition from completed', async () => {
      mockSessionWithStatus('completed');

      await expect(caller.resume({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot resume from status: completed',
      );
    });

    it('rejects illegal transition from idle', async () => {
      mockSessionWithStatus('idle');

      await expect(caller.resume({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot resume from status: idle',
      );
    });

    it('rejects resume from routed (start owns routed→executing; resume is pause-only)', async () => {
      mockSessionWithStatus('routed');

      await expect(caller.resume({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot resume from status: routed',
      );
      expect(persistSessionStatus).not.toHaveBeenCalled();
      expect(sessionEvents.emitSessionResumed).not.toHaveBeenCalled();
    });

    it('throws Session not found when session does not exist', async () => {
      readSessionById.mockReturnValue(null);

      await expect(caller.resume({ sessionId: 'missing' })).rejects.toThrow('Session not found');
    });
  });

  describe('abort', () => {
    it('emits session_aborted and returns aborted when transitioning from running', async () => {
      mockSessionWithStatus('running');

      const result = await caller.abort({ sessionId: 'session-1', reason: 'manual' });

      expect(persistSessionStatus).toHaveBeenCalledWith('session-1', 'aborted');
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'session_aborted',
        data: { sessionId: 'session-1', source: 'web-control', reason: 'manual' },
      });
      expect(appendSessionLedgerRecord).toHaveBeenCalledWith('session-1', {
        schemaVersion: 2,
        kind: 'session_aborted',
        sessionId: 'session-1',
        source: 'web-control',
        status: 'aborted',
        reason: 'manual',
      });
      expect(sessionEvents.emitSessionAborted).toHaveBeenCalledWith('session-1', 'manual');
      expect(result.status).toBe('aborted');
      expect(result.confirmed).toBe(true);
      expect(result.runnerAck).toMatchObject({
        status: 'acked',
        action: 'abort',
        requestedStatus: 'aborted',
      });
    });

    it('keeps abort successful but surfaces an audit warning when ledger write fails', async () => {
      mockSessionWithStatus('running');
      appendSessionLedgerRecord.mockRejectedValue(new Error('ledger locked'));

      const result = await caller.abort({ sessionId: 'session-1', reason: 'manual' });

      expect(sessionEvents.emitSessionAborted).toHaveBeenCalledWith('session-1', 'manual');
      expect(result).toMatchObject({
        status: 'aborted',
        persisted: true,
        confirmed: true,
        auditWarning: 'ledger locked',
      });
    });

    it('emits session_aborted when transitioning from paused', async () => {
      mockSessionWithStatus('paused');

      const result = await caller.abort({ sessionId: 'session-1' });

      expect(persistSessionStatus).toHaveBeenCalledWith('session-1', 'aborted');
      expect(sessionEvents.emitSessionAborted).toHaveBeenCalledWith('session-1', undefined);
      expect(result.status).toBe('aborted');
    });

    it('is idempotent: returns aborted without emitting when already aborted', async () => {
      mockSessionWithStatus('aborted');

      const result = await caller.abort({ sessionId: 'session-1' });

      expect(result.status).toBe('aborted');
      expect(sessionEvents.emitSessionAborted).not.toHaveBeenCalled();
    });

    it('allows abort from idle via created→aborted (CLI SSOT after idle→created normalize)', async () => {
      mockSessionWithStatus('idle');

      const result = await caller.abort({ sessionId: 'session-1' });

      expect(persistSessionStatus).toHaveBeenCalledWith('session-1', 'aborted');
      expect(sessionEvents.emitSessionAborted).toHaveBeenCalledWith('session-1', undefined);
      expect(result.status).toBe('aborted');
    });

    it('rejects illegal transition from completed', async () => {
      mockSessionWithStatus('completed');

      await expect(caller.abort({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot abort from status: completed',
      );
    });

    it('throws Session not found when session does not exist', async () => {
      readSessionById.mockReturnValue(null);

      await expect(caller.abort({ sessionId: 'missing' })).rejects.toThrow('Session not found');
    });
  });
});
