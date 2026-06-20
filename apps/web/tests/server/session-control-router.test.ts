import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sessionControlRouter } from '@server/routers/session-control';
import * as sessionReader from '@server/lib/session-reader';
import { sessionEvents } from '@server/services/session-events';

vi.mock('@server/lib/session-reader', () => ({
  readSessionById: vi.fn(),
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

function mockSessionWithStatus(status: string): void {
  readSessionById.mockReturnValue({ id: 'session-1', goal: 'test', status });
}

const caller = sessionControlRouter.createCaller({});

describe('sessionControlRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('emits session_started and returns running when transitioning from idle', async () => {
      mockSessionWithStatus('idle');

      const result = await caller.start({ sessionId: 'session-1' });

      expect(sessionEvents.emitSessionStarted).toHaveBeenCalledWith('session-1');
      expect(result.status).toBe('running');
    });

    it('is idempotent: returns running without emitting when already running', async () => {
      mockSessionWithStatus('running');

      const result = await caller.start({ sessionId: 'session-1' });

      expect(result.status).toBe('running');
      expect(sessionEvents.emitSessionStarted).not.toHaveBeenCalled();
    });

    it('rejects illegal transition from completed', async () => {
      mockSessionWithStatus('completed');

      await expect(caller.start({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot start from status: completed'
      );
      expect(sessionEvents.emitSessionStarted).not.toHaveBeenCalled();
    });

    it('rejects illegal transition from aborted', async () => {
      mockSessionWithStatus('aborted');

      await expect(caller.start({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot start from status: aborted'
      );
    });

    it('rejects illegal transition from paused', async () => {
      mockSessionWithStatus('paused');

      await expect(caller.start({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot start from status: paused'
      );
    });

    it('throws Session not found when session does not exist', async () => {
      readSessionById.mockReturnValue(null);

      await expect(caller.start({ sessionId: 'missing' })).rejects.toThrow(
        'Session not found'
      );
      expect(sessionEvents.emitSessionStarted).not.toHaveBeenCalled();
    });
  });

  describe('pause', () => {
    it('emits session_paused and returns paused when transitioning from running', async () => {
      mockSessionWithStatus('running');

      const result = await caller.pause({ sessionId: 'session-1' });

      expect(sessionEvents.emitSessionPaused).toHaveBeenCalledWith('session-1');
      expect(result.status).toBe('paused');
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
        'Cannot pause from status: idle'
      );
    });

    it('rejects illegal transition from completed', async () => {
      mockSessionWithStatus('completed');

      await expect(caller.pause({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot pause from status: completed'
      );
    });

    it('throws Session not found when session does not exist', async () => {
      readSessionById.mockReturnValue(null);

      await expect(caller.pause({ sessionId: 'missing' })).rejects.toThrow(
        'Session not found'
      );
    });
  });

  describe('resume', () => {
    it('emits session_resumed and returns running when transitioning from paused', async () => {
      mockSessionWithStatus('paused');

      const result = await caller.resume({ sessionId: 'session-1' });

      expect(sessionEvents.emitSessionResumed).toHaveBeenCalledWith('session-1');
      expect(result.status).toBe('running');
    });

    it('is idempotent: returns running without emitting when already running', async () => {
      mockSessionWithStatus('running');

      const result = await caller.resume({ sessionId: 'session-1' });

      expect(result.status).toBe('running');
      expect(sessionEvents.emitSessionResumed).not.toHaveBeenCalled();
    });

    it('rejects illegal transition from aborted', async () => {
      mockSessionWithStatus('aborted');

      await expect(caller.resume({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot resume from status: aborted'
      );
    });

    it('rejects illegal transition from completed', async () => {
      mockSessionWithStatus('completed');

      await expect(caller.resume({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot resume from status: completed'
      );
    });

    it('rejects illegal transition from idle', async () => {
      mockSessionWithStatus('idle');

      await expect(caller.resume({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot resume from status: idle'
      );
    });

    it('throws Session not found when session does not exist', async () => {
      readSessionById.mockReturnValue(null);

      await expect(caller.resume({ sessionId: 'missing' })).rejects.toThrow(
        'Session not found'
      );
    });
  });

  describe('abort', () => {
    it('emits session_aborted and returns aborted when transitioning from running', async () => {
      mockSessionWithStatus('running');

      const result = await caller.abort({ sessionId: 'session-1', reason: 'manual' });

      expect(sessionEvents.emitSessionAborted).toHaveBeenCalledWith('session-1', 'manual');
      expect(result.status).toBe('aborted');
    });

    it('emits session_aborted when transitioning from paused', async () => {
      mockSessionWithStatus('paused');

      const result = await caller.abort({ sessionId: 'session-1' });

      expect(sessionEvents.emitSessionAborted).toHaveBeenCalledWith('session-1', undefined);
      expect(result.status).toBe('aborted');
    });

    it('is idempotent: returns aborted without emitting when already aborted', async () => {
      mockSessionWithStatus('aborted');

      const result = await caller.abort({ sessionId: 'session-1' });

      expect(result.status).toBe('aborted');
      expect(sessionEvents.emitSessionAborted).not.toHaveBeenCalled();
    });

    it('rejects illegal transition from idle', async () => {
      mockSessionWithStatus('idle');

      await expect(caller.abort({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot abort from status: idle'
      );
    });

    it('rejects illegal transition from completed', async () => {
      mockSessionWithStatus('completed');

      await expect(caller.abort({ sessionId: 'session-1' })).rejects.toThrow(
        'Cannot abort from status: completed'
      );
    });

    it('throws Session not found when session does not exist', async () => {
      readSessionById.mockReturnValue(null);

      await expect(caller.abort({ sessionId: 'missing' })).rejects.toThrow(
        'Session not found'
      );
    });
  });
});
