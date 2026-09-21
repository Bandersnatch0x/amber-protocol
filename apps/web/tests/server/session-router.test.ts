import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sessionRouter } from '@server/routers/session';
import * as sessionReader from '@server/lib/session-reader';
import * as sessionAuditWriter from '@server/lib/session-audit-writer';

vi.mock('@server/lib/session-reader', () => ({
  readSessionList: vi.fn(),
  readSessionById: vi.fn(),
  readTimelineEvents: vi.fn(),
}));

vi.mock('@server/lib/session-audit-writer', () => ({
  readSessionAuditSummary: vi.fn(),
}));

const readSessionList = sessionReader.readSessionList as ReturnType<typeof vi.fn>;
const readSessionById = sessionReader.readSessionById as ReturnType<typeof vi.fn>;
const readTimelineEvents = sessionReader.readTimelineEvents as ReturnType<typeof vi.fn>;
const readSessionAuditSummary = sessionAuditWriter.readSessionAuditSummary as ReturnType<
  typeof vi.fn
>;

const caller = sessionRouter.createCaller({});

describe('sessionRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('passes through the reader result', async () => {
      const sessions = [{ id: 'a' }, { id: 'b' }];
      readSessionList.mockReturnValue(sessions);

      const result = await caller.list();

      expect(result).toBe(sessions);
      expect(readSessionList).toHaveBeenCalledOnce();
    });
  });

  describe('byId', () => {
    it('returns the session when found', async () => {
      const session = {
        id: '11111111-1111-4111-8111-111111111111',
        goal: 'test',
        status: 'running',
      };
      readSessionById.mockReturnValue(session);

      const result = await caller.byId({ id: '11111111-1111-4111-8111-111111111111' });

      expect(result).toBe(session);
      expect(readSessionById).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    });

    it('throws Session not found when the reader returns null', async () => {
      readSessionById.mockReturnValue(null);

      await expect(caller.byId({ id: '22222222-2222-4222-8222-222222222222' })).rejects.toThrow(
        'Session not found',
      );
    });
  });

  describe('timeline', () => {
    it('passes the sessionId and limit through to the reader', async () => {
      const events = [{ type: 'session_started' }];
      readTimelineEvents.mockReturnValue(events);

      const result = await caller.timeline({
        sessionId: '11111111-1111-4111-8111-111111111111',
        limit: 5,
      });

      expect(result).toBe(events);
      expect(readTimelineEvents).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
        limit: 5,
        tail: undefined,
      });
    });

    it('passes the tail parameter through to the reader', async () => {
      const events = [{ type: 'session_completed' }];
      readTimelineEvents.mockReturnValue(events);

      const result = await caller.timeline({
        sessionId: '11111111-1111-4111-8111-111111111111',
        tail: 50,
      });

      expect(result).toBe(events);
      expect(readTimelineEvents).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
        limit: undefined,
        tail: 50,
      });
    });

    it('passes undefined limit and tail when omitted', async () => {
      readTimelineEvents.mockReturnValue([]);

      await caller.timeline({ sessionId: '11111111-1111-4111-8111-111111111111' });

      expect(readTimelineEvents).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', {
        limit: undefined,
        tail: undefined,
      });
    });
  });

  describe('auditSummary', () => {
    it('returns the durable audit summary for a session', async () => {
      const summary = {
        sessionId: '11111111-1111-4111-8111-111111111111',
        ledger: {
          path: '.amber/sessions/11111111-1111-4111-8111-111111111111/ledger.jsonl',
          exists: true,
          verified: true,
          recordCount: 2,
        },
        timeline: {
          path: '.amber/sessions/11111111-1111-4111-8111-111111111111/timeline.jsonl',
          exists: true,
          eventCount: 3,
        },
      };
      readSessionAuditSummary.mockResolvedValue(summary);

      const result = await caller.auditSummary({
        sessionId: '11111111-1111-4111-8111-111111111111',
      });

      expect(readSessionAuditSummary).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
      expect(result).toBe(summary);
    });
  });
});
