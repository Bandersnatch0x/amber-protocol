import { SessionEvent } from '../types/session-events';

const MAX_EVENTS_PER_SESSION = 1000;

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
    if (since !== undefined) {
      return events.filter(e => 'timestamp' in e && e.timestamp > since);
    }
    return events;
  }

  clear(sessionId: string): void {
    this.events.delete(sessionId);
  }
}

export const eventStore = new EventStore();
