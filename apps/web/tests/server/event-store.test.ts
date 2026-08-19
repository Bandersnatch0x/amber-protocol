import { describe, it, expect, beforeEach } from 'vitest';
import { eventStore } from '@server/services/event-store';
import { SessionEvent } from '@server/types/session-events';

describe('EventStore', () => {
  beforeEach(() => {
    // Clear all sessions before each test
    eventStore.clear('session-1');
    eventStore.clear('session-2');
  });

  it('should store and retrieve events for a session', () => {
    const event1: SessionEvent = {
      type: 'session_started',
      sessionId: 'session-1',
      timestamp: 100,
    };
    const event2: SessionEvent = { type: 'session_paused', sessionId: 'session-1', timestamp: 200 };

    eventStore.addEvent('session-1', event1);
    eventStore.addEvent('session-1', event2);

    const events = eventStore.getEvents('session-1');
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual(event1);
    expect(events[1]).toEqual(event2);
  });

  it('should return empty array for unknown session', () => {
    const events = eventStore.getEvents('unknown-session');
    expect(events).toEqual([]);
  });

  it('should filter events by since timestamp', () => {
    eventStore.addEvent('session-1', {
      type: 'session_started',
      sessionId: 'session-1',
      timestamp: 100,
    });
    eventStore.addEvent('session-1', {
      type: 'session_paused',
      sessionId: 'session-1',
      timestamp: 200,
    });
    eventStore.addEvent('session-1', {
      type: 'session_resumed',
      sessionId: 'session-1',
      timestamp: 300,
    });

    const recentEvents = eventStore.getEvents('session-1', 150);
    expect(recentEvents).toHaveLength(2);
    expect(recentEvents[0].type).toBe('session_paused');
    expect(recentEvents[1].type).toBe('session_resumed');
  });

  it('should cap events at MAX_EVENTS_PER_SESSION (1000)', () => {
    // Add 1001 events
    for (let i = 0; i < 1001; i++) {
      eventStore.addEvent('session-1', {
        type: 'task_progress',
        sessionId: 'session-1',
        timestamp: i,
        task: `task-${i}`,
        progress: i,
      });
    }

    const events = eventStore.getEvents('session-1');
    expect(events).toHaveLength(1000);

    // First event should be the second one we added (oldest was shifted)
    expect(events[0].timestamp).toBe(1);
    // Last event should be the 1001st
    expect(events[999].timestamp).toBe(1000);
  });

  it('should isolate events between sessions', () => {
    eventStore.addEvent('session-1', {
      type: 'session_started',
      sessionId: 'session-1',
      timestamp: 100,
    });
    eventStore.addEvent('session-2', {
      type: 'session_started',
      sessionId: 'session-2',
      timestamp: 200,
    });

    const events1 = eventStore.getEvents('session-1');
    const events2 = eventStore.getEvents('session-2');

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events1[0].sessionId).toBe('session-1');
    expect(events2[0].sessionId).toBe('session-2');
  });

  it('should clear all events for a session', () => {
    eventStore.addEvent('session-1', {
      type: 'session_started',
      sessionId: 'session-1',
      timestamp: 100,
    });
    eventStore.addEvent('session-1', {
      type: 'session_paused',
      sessionId: 'session-1',
      timestamp: 200,
    });

    eventStore.clear('session-1');

    const events = eventStore.getEvents('session-1');
    expect(events).toEqual([]);
  });

  it('should handle events without timestamp in since filter', () => {
    eventStore.addEvent('session-1', {
      type: 'session_started',
      sessionId: 'session-1',
      timestamp: 100,
    });
    // Event without timestamp (edge case, but type allows it)
    eventStore.addEvent('session-1', {
      type: 'session_paused',
      sessionId: 'session-1',
    } as SessionEvent);
    eventStore.addEvent('session-1', {
      type: 'session_resumed',
      sessionId: 'session-1',
      timestamp: 300,
    });

    // Events without timestamp are filtered out by since (they don't have e.timestamp > since)
    const recentEvents = eventStore.getEvents('session-1', 50);
    expect(recentEvents).toHaveLength(2);
    expect(recentEvents[0].type).toBe('session_started');
    expect(recentEvents[1].type).toBe('session_resumed');
  });

  it('should filter ISO string timestamps against a numeric since cursor', () => {
    const since = Date.parse('2026-07-14T16:01:00.000Z');
    eventStore.addEvent('session-1', {
      type: 'session_created',
      sessionId: 'session-1',
      timestamp: '2026-07-14T16:00:00.000Z',
    });
    eventStore.addEvent('session-1', {
      type: 'stage_completed',
      sessionId: 'session-1',
      timestamp: '2026-07-14T16:02:00.000Z',
    });
    const events = eventStore.getEvents('session-1', since);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stage_completed');
  });
});
