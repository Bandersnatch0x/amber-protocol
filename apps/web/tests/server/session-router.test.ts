import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sessionRouter } from '@server/routers/session';
import * as sessionReader from '@server/lib/session-reader';

vi.mock('@server/lib/session-reader', () => ({
  readSessionList: vi.fn(),
  readSessionById: vi.fn(),
  readTimelineEvents: vi.fn(),
}));

const readSessionList = sessionReader.readSessionList as ReturnType<typeof vi.fn>;
const readSessionById = sessionReader.readSessionById as ReturnType<typeof vi.fn>;
const readTimelineEvents = sessionReader.readTimelineEvents as ReturnType<typeof vi.fn>;

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
      const session = { id: 'session-1', goal: 'test', status: 'running' };
      readSessionById.mockReturnValue(session);

      const result = await caller.byId({ id: 'session-1' });

      expect(result).toBe(session);
      expect(readSessionById).toHaveBeenCalledWith('session-1');
    });

    it('throws Session not found when the reader returns null', async () => {
      readSessionById.mockReturnValue(null);

      await expect(caller.byId({ id: 'missing' })).rejects.toThrow('Session not found');
    });
  });

  describe('timeline', () => {
    it('passes the sessionId and limit through to the reader', async () => {
      const events = [{ type: 'session_started' }];
      readTimelineEvents.mockReturnValue(events);

      const result = await caller.timeline({ sessionId: 'session-1', limit: 5 });

      expect(result).toBe(events);
      expect(readTimelineEvents).toHaveBeenCalledWith('session-1', 5);
    });

    it('passes undefined limit when omitted', async () => {
      readTimelineEvents.mockReturnValue([]);

      await caller.timeline({ sessionId: 'session-1' });

      expect(readTimelineEvents).toHaveBeenCalledWith('session-1', undefined);
    });
  });
});
