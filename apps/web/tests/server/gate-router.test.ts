import { describe, it, expect, beforeEach, vi } from 'vitest';
import { gateRouter } from '@server/routers/gate';
import * as gateReader from '@server/lib/gate-reader';
import * as sessionReader from '@server/lib/session-reader';
import * as sessionWriter from '@server/lib/session-writer';
import * as sessionAuditWriter from '@server/lib/session-audit-writer';
import { sessionEvents } from '@server/services/session-events';

vi.mock('@server/lib/gate-reader', () => ({
  listGates: vi.fn(),
  getGate: vi.fn(),
  approveGate: vi.fn(),
  rejectGate: vi.fn(),
}));

vi.mock('@server/lib/session-reader', () => ({
  readSessionById: vi.fn(),
}));

vi.mock('@server/lib/session-writer', () => ({
  persistSessionStatus: vi.fn(),
}));

vi.mock('@server/lib/session-audit-writer', () => ({
  appendSessionLedgerRecord: vi.fn(),
  appendSessionTimelineEvent: vi.fn(),
  readSessionAuditSummary: vi.fn(),
}));

vi.mock('@server/services/session-events', () => ({
  sessionEvents: {
    emitGateFailed: vi.fn(),
    emitGatePassed: vi.fn(),
    emitSessionResumed: vi.fn(),
  },
}));

const listGates = gateReader.listGates as ReturnType<typeof vi.fn>;
const getGate = gateReader.getGate as ReturnType<typeof vi.fn>;
const approveGate = gateReader.approveGate as ReturnType<typeof vi.fn>;
const rejectGate = gateReader.rejectGate as ReturnType<typeof vi.fn>;
const readSessionByIdMock = sessionReader.readSessionById as ReturnType<typeof vi.fn>;
const persistSessionStatus = sessionWriter.persistSessionStatus as ReturnType<typeof vi.fn>;
const appendSessionLedgerRecord = sessionAuditWriter.appendSessionLedgerRecord as ReturnType<
  typeof vi.fn
>;
const appendSessionTimelineEvent = sessionAuditWriter.appendSessionTimelineEvent as ReturnType<
  typeof vi.fn
>;
const readSessionAuditSummary = sessionAuditWriter.readSessionAuditSummary as ReturnType<
  typeof vi.fn
>;
const emitGateFailed = sessionEvents.emitGateFailed as ReturnType<typeof vi.fn>;
const emitGatePassed = sessionEvents.emitGatePassed as ReturnType<typeof vi.fn>;
const emitSessionResumed = sessionEvents.emitSessionResumed as ReturnType<typeof vi.fn>;

const caller = gateRouter.createCaller({});

function mockPendingGate(overrides: Record<string, unknown> = {}) {
  getGate.mockResolvedValue({
    gateId: 'gate-1',
    sessionId: 'session-1',
    status: 'pending',
    ...overrides,
  });
}

describe('gateRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emitGateFailed.mockImplementation(() => undefined);
    emitGatePassed.mockImplementation(() => undefined);
    emitSessionResumed.mockImplementation(() => undefined);
    persistSessionStatus.mockResolvedValue({ id: 'session-1', status: 'executing' });
    appendSessionLedgerRecord.mockResolvedValue({});
    appendSessionTimelineEvent.mockResolvedValue(undefined);
    readSessionAuditSummary.mockResolvedValue({
      sessionId: 'session-1',
      gateId: 'gate-1',
      ledger: {
        path: '.amber/sessions/session-1/ledger.jsonl',
        exists: true,
        verified: true,
        recordCount: 1,
      },
      timeline: { path: '.amber/sessions/session-1/timeline.jsonl', exists: true, eventCount: 1 },
    });
  });

  describe('list', () => {
    it('forwards filters to listGates', async () => {
      const gates = [{ id: 'gate-1' }];
      listGates.mockResolvedValue(gates);

      const result = await caller.list({ sessionId: 'session-1', status: 'pending' });

      expect(result).toBe(gates);
      expect(listGates).toHaveBeenCalledWith({ sessionId: 'session-1', status: 'pending' });
    });

    it('passes an empty object when input is omitted', async () => {
      listGates.mockResolvedValue([]);

      await caller.list();

      expect(listGates).toHaveBeenCalledWith({});
    });
  });

  describe('byId', () => {
    it('forwards sessionId and gateId to getGate', async () => {
      const gate = { id: 'gate-1' };
      getGate.mockResolvedValue(gate);

      const result = await caller.byId({ sessionId: 'session-1', gateId: 'gate-1' });

      expect(result).toBe(gate);
      expect(getGate).toHaveBeenCalledWith('session-1', 'gate-1');
    });
  });

  describe('auditSummary', () => {
    it('returns the durable audit summary for a gate', async () => {
      const summary = {
        sessionId: 'session-1',
        gateId: 'gate-1',
        ledger: {
          path: '.amber/sessions/session-1/ledger.jsonl',
          exists: true,
          verified: true,
          recordCount: 2,
          latestForGate: { kind: 'gate_passed', gateId: 'gate-1', hash: 'a'.repeat(64) },
        },
        timeline: {
          path: '.amber/sessions/session-1/timeline.jsonl',
          exists: true,
          eventCount: 3,
          latestForGate: { type: 'gate_passed', gateId: 'gate-1' },
        },
      };
      readSessionAuditSummary.mockResolvedValue(summary);

      const result = await caller.auditSummary({ sessionId: 'session-1', gateId: 'gate-1' });

      expect(readSessionAuditSummary).toHaveBeenCalledWith('session-1', 'gate-1');
      expect(result).toBe(summary);
    });
  });

  describe('approve', () => {
    it('delegates to approveGate and returns success', async () => {
      approveGate.mockResolvedValue(undefined);

      const result = await caller.approve({
        sessionId: 'session-1',
        gateId: 'gate-1',
        reason: 'looks good',
      });

      expect(approveGate).toHaveBeenCalledWith('session-1', 'gate-1', 'looks good', undefined);
      expect(emitGatePassed).toHaveBeenCalledWith('session-1', 'gate-1');
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'gate_passed',
        data: { sessionId: 'session-1', gateId: 'gate-1', approvedBy: 'web:anonymous' },
      });
      expect(appendSessionLedgerRecord).toHaveBeenCalledWith('session-1', {
        schemaVersion: 2,
        kind: 'gate_passed',
        sessionId: 'session-1',
        gateId: 'gate-1',
        approvedBy: 'web:anonymous',
      });
      expect(result).toEqual({ success: true });
    });

    it('records the supplied reviewer in the decision and audit chain', async () => {
      approveGate.mockResolvedValue(undefined);

      const result = await caller.approve({
        sessionId: 'session-1',
        gateId: 'gate-1',
        reason: 'looks good',
        reviewer: 'alice@team',
      });

      expect(approveGate).toHaveBeenCalledWith('session-1', 'gate-1', 'looks good', 'alice@team');
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'gate_passed',
        data: { sessionId: 'session-1', gateId: 'gate-1', approvedBy: 'alice@team' },
      });
      expect(appendSessionLedgerRecord).toHaveBeenCalledWith('session-1', {
        schemaVersion: 2,
        kind: 'gate_passed',
        sessionId: 'session-1',
        gateId: 'gate-1',
        approvedBy: 'alice@team',
      });
      expect(result).toEqual({ success: true });
    });

    it('treats an empty reviewer as the web-anonymous marker', async () => {
      approveGate.mockResolvedValue(undefined);

      await caller.approve({ sessionId: 'session-1', gateId: 'gate-1', reviewer: '   ' });

      expect(approveGate).toHaveBeenCalledWith('session-1', 'gate-1', undefined, undefined);
      expect(appendSessionLedgerRecord).toHaveBeenCalledWith('session-1', {
        schemaVersion: 2,
        kind: 'gate_passed',
        sessionId: 'session-1',
        gateId: 'gate-1',
        approvedBy: 'web:anonymous',
      });
    });

    it('rejects reviewers outside the whitelist charset', async () => {
      await expect(
        caller.approve({ sessionId: 'session-1', gateId: 'gate-1', reviewer: 'bad<script>' }),
      ).rejects.toThrow();

      expect(approveGate).not.toHaveBeenCalled();
      expect(appendSessionLedgerRecord).not.toHaveBeenCalled();
    });

    it('rejects reviewers longer than 64 characters', async () => {
      await expect(
        caller.approve({ sessionId: 'session-1', gateId: 'gate-1', reviewer: 'a'.repeat(65) }),
      ).rejects.toThrow();

      expect(approveGate).not.toHaveBeenCalled();
    });

    it('keeps approval successful when the gate decision event cannot be emitted', async () => {
      approveGate.mockResolvedValue(undefined);
      emitGatePassed.mockImplementation(() => {
        throw new Error('event stream unavailable');
      });

      const result = await caller.approve({ sessionId: 'session-1', gateId: 'gate-1' });

      expect(approveGate).toHaveBeenCalledWith('session-1', 'gate-1', undefined, undefined);
      expect(result).toEqual({ success: true, eventWarning: 'event stream unavailable' });
    });

    it('keeps approval successful when durable audit cannot be written', async () => {
      approveGate.mockResolvedValue(undefined);
      appendSessionTimelineEvent.mockRejectedValue(new Error('timeline locked'));

      const result = await caller.approve({ sessionId: 'session-1', gateId: 'gate-1' });

      expect(result).toEqual({ success: true, eventWarning: 'timeline locked' });
    });
  });

  describe('approveAndResume', () => {
    it('approves the gate and confirms a paused session resumed from persisted status', async () => {
      readSessionByIdMock.mockReturnValue({ id: 'session-1', status: 'paused' });
      mockPendingGate();
      approveGate.mockResolvedValue(undefined);

      const result = await caller.approveAndResume({
        sessionId: 'session-1',
        gateId: 'gate-1',
        reason: 'reviewed',
      });

      expect(readSessionByIdMock).toHaveBeenCalledWith('session-1');
      expect(getGate).toHaveBeenCalledWith('session-1', 'gate-1');
      expect(approveGate).toHaveBeenCalledWith('session-1', 'gate-1', 'reviewed', undefined);
      expect(persistSessionStatus).toHaveBeenCalledWith('session-1', 'executing');
      expect(emitGatePassed).toHaveBeenCalledWith('session-1', 'gate-1');
      expect(emitSessionResumed).toHaveBeenCalledWith('session-1');
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'session_resumed',
        data: { sessionId: 'session-1', source: 'web-gate-approval' },
      });
      expect(result).toMatchObject({
        success: true,
        gateStatus: 'approved',
        sessionStatus: 'executing',
        resumeRequested: true,
        resumeConfirmed: true,
        resumed: true,
        message: 'Session status persisted as executing',
      });
    });

    it('approves without emitting resume and normalizes a legacy running session', async () => {
      readSessionByIdMock.mockReturnValue({ id: 'session-1', status: 'running' });
      mockPendingGate();
      approveGate.mockResolvedValue(undefined);

      const result = await caller.approveAndResume({ sessionId: 'session-1', gateId: 'gate-1' });

      expect(approveGate).toHaveBeenCalledWith('session-1', 'gate-1', undefined, undefined);
      expect(emitGatePassed).toHaveBeenCalledWith('session-1', 'gate-1');
      expect(emitSessionResumed).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: true,
        gateStatus: 'approved',
        sessionStatus: 'executing',
        resumeRequested: false,
        resumeConfirmed: true,
        resumed: true,
        message: 'Legacy running status normalized to executing',
      });
    });

    it('records the supplied reviewer when approving and resuming', async () => {
      readSessionByIdMock.mockReturnValue({ id: 'session-1', status: 'paused' });
      mockPendingGate();
      approveGate.mockResolvedValue(undefined);

      await caller.approveAndResume({
        sessionId: 'session-1',
        gateId: 'gate-1',
        reviewer: 'bob.auditor',
      });

      expect(approveGate).toHaveBeenCalledWith('session-1', 'gate-1', undefined, 'bob.auditor');
      expect(appendSessionLedgerRecord).toHaveBeenCalledWith('session-1', {
        schemaVersion: 2,
        kind: 'gate_passed',
        sessionId: 'session-1',
        gateId: 'gate-1',
        approvedBy: 'bob.auditor',
      });
    });

    it('does not confirm a legacy running session when normalization is not persisted', async () => {
      readSessionByIdMock.mockReturnValue({ id: 'session-1', status: 'running' });
      persistSessionStatus.mockResolvedValue({ id: 'session-1', status: 'running' });
      mockPendingGate();
      approveGate.mockResolvedValue(undefined);

      const result = await caller.approveAndResume({ sessionId: 'session-1', gateId: 'gate-1' });

      expect(result).toMatchObject({
        success: true,
        gateStatus: 'approved',
        sessionStatus: 'running',
        resumeRequested: false,
        resumeConfirmed: false,
        resumed: false,
        message: 'Session status persistence was not confirmed: expected executing, got running',
      });
    });

    it('approves but does not resume terminal or idle sessions', async () => {
      readSessionByIdMock.mockReturnValue({ id: 'session-1', status: 'completed' });
      mockPendingGate();
      approveGate.mockResolvedValue(undefined);

      const result = await caller.approveAndResume({ sessionId: 'session-1', gateId: 'gate-1' });

      expect(approveGate).toHaveBeenCalledWith('session-1', 'gate-1', undefined, undefined);
      expect(emitGatePassed).toHaveBeenCalledWith('session-1', 'gate-1');
      expect(emitSessionResumed).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: true,
        gateStatus: 'approved',
        sessionStatus: 'completed',
        resumeRequested: false,
        resumeConfirmed: false,
        resumed: false,
        message: 'Session is completed and cannot be resumed',
      });
    });

    it('keeps resume confirmed when the resume event cannot be emitted', async () => {
      readSessionByIdMock.mockReturnValue({ id: 'session-1', status: 'paused' });
      mockPendingGate();
      approveGate.mockResolvedValue(undefined);
      emitSessionResumed.mockImplementation(() => {
        throw new Error('SSE unavailable');
      });

      const result = await caller.approveAndResume({ sessionId: 'session-1', gateId: 'gate-1' });

      expect(approveGate).toHaveBeenCalledWith('session-1', 'gate-1', undefined, undefined);
      expect(result).toMatchObject({
        success: true,
        gateStatus: 'approved',
        sessionStatus: 'executing',
        resumeRequested: true,
        resumeConfirmed: true,
        resumed: true,
        message: 'Session status persisted as executing',
        resumeEventWarning: 'SSE unavailable',
      });
    });

    it('returns an approved gate without resume confirmation when status persistence fails', async () => {
      readSessionByIdMock.mockReturnValue({ id: 'session-1', status: 'paused' });
      mockPendingGate();
      approveGate.mockResolvedValue(undefined);
      persistSessionStatus.mockRejectedValue(new Error('manifest locked'));

      const result = await caller.approveAndResume({ sessionId: 'session-1', gateId: 'gate-1' });

      expect(approveGate).toHaveBeenCalledWith('session-1', 'gate-1', undefined, undefined);
      expect(emitSessionResumed).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        success: true,
        gateStatus: 'approved',
        sessionStatus: 'paused',
        resumeRequested: true,
        resumeConfirmed: false,
        resumed: false,
        message: 'manifest locked',
      });
    });

    it('does not approve a gate that is no longer pending', async () => {
      readSessionByIdMock.mockReturnValue({ id: 'session-1', status: 'paused' });
      mockPendingGate({ status: 'approved' });

      await expect(
        caller.approveAndResume({ sessionId: 'session-1', gateId: 'gate-1' }),
      ).rejects.toThrow('Gate already approved');

      expect(approveGate).not.toHaveBeenCalled();
      expect(emitSessionResumed).not.toHaveBeenCalled();
    });

    it('does not approve the gate when the session is missing', async () => {
      readSessionByIdMock.mockReturnValue(null);

      await expect(
        caller.approveAndResume({ sessionId: 'missing', gateId: 'gate-1' }),
      ).rejects.toThrow('Session not found');

      expect(approveGate).not.toHaveBeenCalled();
      expect(emitSessionResumed).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('delegates to rejectGate and returns success', async () => {
      rejectGate.mockResolvedValue(undefined);

      const result = await caller.reject({
        sessionId: 'session-1',
        gateId: 'gate-1',
        reason: 'needs work',
      });

      expect(rejectGate).toHaveBeenCalledWith('session-1', 'gate-1', 'needs work', undefined);
      expect(emitGateFailed).toHaveBeenCalledWith('session-1', 'gate-1', 'needs work');
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'gate_failed',
        data: {
          sessionId: 'session-1',
          gateId: 'gate-1',
          reason: 'needs work',
          rejectedBy: 'web:anonymous',
        },
      });
      expect(appendSessionLedgerRecord).toHaveBeenCalledWith('session-1', {
        schemaVersion: 2,
        kind: 'gate_failed',
        sessionId: 'session-1',
        gateId: 'gate-1',
        reason: 'needs work',
        rejectedBy: 'web:anonymous',
      });
      expect(result).toEqual({ success: true });
    });

    it('records the supplied reviewer in the rejection audit chain', async () => {
      rejectGate.mockResolvedValue(undefined);

      const result = await caller.reject({
        sessionId: 'session-1',
        gateId: 'gate-1',
        reason: 'needs work',
        reviewer: 'carol:review',
      });

      expect(rejectGate).toHaveBeenCalledWith('session-1', 'gate-1', 'needs work', 'carol:review');
      expect(appendSessionTimelineEvent).toHaveBeenCalledWith('session-1', {
        type: 'gate_failed',
        data: {
          sessionId: 'session-1',
          gateId: 'gate-1',
          reason: 'needs work',
          rejectedBy: 'carol:review',
        },
      });
      expect(appendSessionLedgerRecord).toHaveBeenCalledWith('session-1', {
        schemaVersion: 2,
        kind: 'gate_failed',
        sessionId: 'session-1',
        gateId: 'gate-1',
        reason: 'needs work',
        rejectedBy: 'carol:review',
      });
      expect(result).toEqual({ success: true });
    });

    it('rejects reviewers outside the whitelist charset', async () => {
      await expect(
        caller.reject({
          sessionId: 'session-1',
          gateId: 'gate-1',
          reason: 'needs work',
          reviewer: 'evil;rm -rf',
        }),
      ).rejects.toThrow();

      expect(rejectGate).not.toHaveBeenCalled();
      expect(appendSessionLedgerRecord).not.toHaveBeenCalled();
    });

    it('keeps rejection successful when the gate decision event cannot be emitted', async () => {
      rejectGate.mockResolvedValue(undefined);
      emitGateFailed.mockImplementation(() => {
        throw new Error('event stream unavailable');
      });

      const result = await caller.reject({
        sessionId: 'session-1',
        gateId: 'gate-1',
        reason: 'needs work',
      });

      expect(rejectGate).toHaveBeenCalledWith('session-1', 'gate-1', 'needs work', undefined);
      expect(result).toEqual({ success: true, eventWarning: 'event stream unavailable' });
    });

    it('requires a non-empty reason', async () => {
      await expect(
        caller.reject({ sessionId: 'session-1', gateId: 'gate-1', reason: '   ' }),
      ).rejects.toThrow();

      expect(rejectGate).not.toHaveBeenCalled();
    });
  });
});
