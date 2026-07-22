import { describe, it, expect, beforeEach } from 'vitest';
import { eventStore } from '../server/services/event-store';
import { SessionEvent } from '../server/types/session-events';

describe('EventStore', () => {
  beforeEach(() => {
    eventStore.clear('test-session');
  });

  it('should store and retrieve events', () => {
    const event: SessionEvent = {
      type: 'session_started',
      sessionId: 'test-session',
      timestamp: Date.now(),
    };

    eventStore.addEvent('test-session', event);
    const events = eventStore.getEvents('test-session');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(event);
  });

  it('should enforce max events limit', () => {
    for (let i = 0; i < 1100; i++) {
      eventStore.addEvent('test-session', {
        type: 'heartbeat',
        timestamp: Date.now() + i,
      });
    }

    const events = eventStore.getEvents('test-session');
    expect(events.length).toBeLessThanOrEqual(1000);
  });

  it('should filter events by timestamp', () => {
    const now = Date.now();

    eventStore.addEvent('test-session', {
      type: 'session_started',
      sessionId: 'test-session',
      timestamp: now - 1000,
    });

    eventStore.addEvent('test-session', {
      type: 'session_paused',
      sessionId: 'test-session',
      timestamp: now,
    });

    const events = eventStore.getEvents('test-session', now - 500);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('session_paused');
  });

  it('should filter ISO string timestamps against a numeric since cursor', () => {
    // CLI timelines write ISO strings; SSE `?since=` is epoch ms. Comparing
    // string > number is a TypeScript/runtime landmine — must parse first.
    const early = '2026-07-14T16:00:00.000Z';
    const late = '2026-07-14T16:02:00.000Z';
    const since = Date.parse('2026-07-14T16:01:00.000Z');

    eventStore.addEvent('test-session', {
      type: 'session_created',
      sessionId: 'test-session',
      timestamp: early,
    });
    eventStore.addEvent('test-session', {
      type: 'stage_completed',
      sessionId: 'test-session',
      timestamp: late,
    });

    const events = eventStore.getEvents('test-session', since);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stage_completed');
  });
});
