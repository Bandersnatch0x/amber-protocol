import { describe, it, expect } from 'vitest';
import { SessionEventSchema, SessionStatusSchema } from '@server/types/session-events';

describe('SSE endpoint schema validation', () => {
  it('should validate all event types', () => {
    const events = [
      { type: 'session_started', sessionId: 's1', timestamp: 1000 },
      { type: 'session_paused', sessionId: 's1', timestamp: 1001 },
      { type: 'session_resumed', sessionId: 's1', timestamp: 1002 },
      { type: 'session_completed', sessionId: 's1', timestamp: 1003 },
      { type: 'session_aborted', sessionId: 's1', timestamp: 1004, reason: 'test' },
      { type: 'task_progress', sessionId: 's1', task: 'test', progress: 50, timestamp: 1005 },
      { type: 'error', sessionId: 's1', error: 'err', timestamp: 1006 },
      { type: 'heartbeat', timestamp: 1007 },
    ];

    for (const event of events) {
      const parsed = SessionEventSchema.parse(event);
      expect(parsed.type).toBe(event.type);
    }
  });
});

describe('Session status schema', () => {
  it('should validate all statuses', () => {
    const statuses = ['idle', 'running', 'paused', 'completed', 'aborted'];
    for (const s of statuses) {
      expect(SessionStatusSchema.parse(s)).toBe(s);
    }
  });
});