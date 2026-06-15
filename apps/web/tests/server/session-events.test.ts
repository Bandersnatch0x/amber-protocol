import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sessionEvents } from '@server/services/session-events';
import { eventBroadcaster } from '@server/services/event-broadcaster';
import { eventStore } from '@server/services/event-store';

vi.mock('@server/services/event-broadcaster', () => ({
  eventBroadcaster: {
    broadcast: vi.fn(),
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
    cleanup: vi.fn(),
  },
}));

vi.mock('@server/services/event-store', () => ({
  eventStore: {
    addEvent: vi.fn(),
  },
}));

describe('SessionEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should emit session started', () => {
    sessionEvents.emitSessionStarted('session-1');
    expect(eventStore.addEvent).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'session_started',
      sessionId: 'session-1',
    }));
    expect(eventBroadcaster.broadcast).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'session_started',
    }));
  });

  it('should emit session paused', () => {
    sessionEvents.emitSessionPaused('session-1');
    expect(eventBroadcaster.broadcast).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'session_paused',
    }));
  });

  it('should emit session resumed', () => {
    sessionEvents.emitSessionResumed('session-1');
    expect(eventBroadcaster.broadcast).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'session_resumed',
    }));
  });

  it('should emit session completed', () => {
    sessionEvents.emitSessionCompleted('session-1');
    expect(eventBroadcaster.broadcast).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'session_completed',
    }));
  });

  it('should emit session aborted with reason', () => {
    sessionEvents.emitSessionAborted('session-1', 'User cancelled');
    expect(eventBroadcaster.broadcast).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'session_aborted',
      reason: 'User cancelled',
    }));
  });

  it('should emit task progress', () => {
    sessionEvents.emitTaskProgress('session-1', 'Reviewing code', 50);
    expect(eventBroadcaster.broadcast).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'task_progress',
      task: 'Reviewing code',
      progress: 50,
    }));
  });

  it('should emit error', () => {
    sessionEvents.emitError('session-1', 'Something went wrong');
    expect(eventBroadcaster.broadcast).toHaveBeenCalledWith('session-1', expect.objectContaining({
      type: 'error',
      error: 'Something went wrong',
    }));
  });
});