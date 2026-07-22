import { SessionEvent } from '../types/session-events';

const MAX_EVENTS_PER_SESSION = 1000;

/** Timeline timestamps are number | string; SSE `since` is a number (ms). */
function eventTimeMs(timestamp: SessionEvent['timestamp']): number | null {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return timestamp;
  }
  if (typeof timestamp === 'string' && timestamp) {
    const parsed = Date.parse(timestamp);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

class EventStore {
  private events = new Map<string, SessionEvent[]>();

  addEvent(sessionId: string, event: SessionEvent): void {
    if (!this.events.has(sessionId)) {
      this.events.set(sessionId, []);
    }

    const sessionEvents = this.events.get(sessionId)!;
    sessionEvents.push(event);

    if (sessionEvents.length > MAX_EVENTS_PER_SESSION) {
      sessionEvents.shift();
    }
  }

  getEvents(sessionId: string, since?: number): SessionEvent[] {
    const events = this.events.get(sessionId) || [];
    if (since === undefined) {
      return events;
    }
    // Include events strictly after `since` (resume cursor). ISO string
    // timestamps from CLI timelines must compare as epoch ms, not lexicographically.
    return events.filter((e) => {
      const ms = eventTimeMs(e.timestamp);
      return ms !== null && ms > since;
    });
  }

  clear(sessionId: string): void {
    this.events.delete(sessionId);
  }
}

export const eventStore = new EventStore();
