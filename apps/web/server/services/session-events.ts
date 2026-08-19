import { SessionEvent } from '../types/session-events';
import { eventBroadcaster } from './event-broadcaster';
import { eventStore } from './event-store';

class SessionEvents {
  emitSessionStarted(sessionId: string): void {
    const event: SessionEvent = {
      type: 'session_started',
      sessionId,
      timestamp: Date.now(),
    };
    eventStore.addEvent(sessionId, event);
    eventBroadcaster.broadcast(sessionId, event);
  }

  emitSessionPaused(sessionId: string): void {
    const event: SessionEvent = {
      type: 'session_paused',
      sessionId,
      timestamp: Date.now(),
    };
    eventStore.addEvent(sessionId, event);
    eventBroadcaster.broadcast(sessionId, event);
  }

  emitSessionResumed(sessionId: string): void {
    const event: SessionEvent = {
      type: 'session_resumed',
      sessionId,
      timestamp: Date.now(),
    };
    eventStore.addEvent(sessionId, event);
    eventBroadcaster.broadcast(sessionId, event);
  }

  emitSessionCompleted(sessionId: string): void {
    const event: SessionEvent = {
      type: 'session_completed',
      sessionId,
      timestamp: Date.now(),
    };
    eventStore.addEvent(sessionId, event);
    eventBroadcaster.broadcast(sessionId, event);
  }

  emitSessionAborted(sessionId: string, reason?: string): void {
    const event: SessionEvent = {
      type: 'session_aborted',
      sessionId,
      timestamp: Date.now(),
      reason,
    };
    eventStore.addEvent(sessionId, event);
    eventBroadcaster.broadcast(sessionId, event);
  }

  emitGatePassed(sessionId: string, gateId: string): void {
    const event: SessionEvent = {
      type: 'gate_passed',
      sessionId,
      gateId,
      timestamp: Date.now(),
    };
    eventStore.addEvent(sessionId, event);
    eventBroadcaster.broadcast(sessionId, event);
  }

  emitGateFailed(sessionId: string, gateId: string, reason?: string): void {
    const event: SessionEvent = {
      type: 'gate_failed',
      sessionId,
      gateId,
      reason,
      timestamp: Date.now(),
    };
    eventStore.addEvent(sessionId, event);
    eventBroadcaster.broadcast(sessionId, event);
  }

  emitTaskProgress(sessionId: string, task: string, progress: number): void {
    const event: SessionEvent = {
      type: 'task_progress',
      sessionId,
      task,
      progress,
      timestamp: Date.now(),
    };
    eventStore.addEvent(sessionId, event);
    eventBroadcaster.broadcast(sessionId, event);
  }

  emitEvidenceJobChanged(sessionId: string, jobId: string, status: string): void {
    const event: SessionEvent = {
      type: 'evidence-job-changed',
      sessionId,
      jobId,
      status,
      timestamp: Date.now(),
    };
    eventStore.addEvent(sessionId, event);
    eventBroadcaster.broadcast(sessionId, event);
  }

  emitError(sessionId: string, error: string): void {
    const event: SessionEvent = {
      type: 'error',
      sessionId,
      error,
      timestamp: Date.now(),
    };
    eventStore.addEvent(sessionId, event);
    eventBroadcaster.broadcast(sessionId, event);
  }
}

export const sessionEvents = new SessionEvents();
