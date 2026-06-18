import { useEffect, useState, useRef } from 'react';
import { SessionEvent, SessionStatus, SessionEventSchema } from '@/lib/types/session-events';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

// Declarative map from a session event type to the session status it implies.
// Events not in this map (session_created, task_progress, error, heartbeat)
// leave the status unchanged. Previously a 5-branch if/else inside the hook's
// onmessage handler.
const EVENT_STATUS_MAP: Partial<Record<SessionEvent['type'], SessionStatus>> = {
  session_started: 'running',
  session_resumed: 'running',
  session_paused: 'paused',
  session_completed: 'completed',
  session_aborted: 'aborted',
};

export function statusFromEventType(
  type: SessionEvent['type'],
): SessionStatus | null {
  return EVENT_STATUS_MAP[type] ?? null;
}

interface UseSessionEventsReturn {
  status: SessionStatus | null;
  connectionState: ConnectionState;
  lastEvent: SessionEvent | null;
  error: string | null;
  events: SessionEvent[];
}

const MAX_EVENTS = 500;

export function useSessionEvents(sessionId: string | null): UseSessionEventsReturn {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('closed');
  const [lastEvent, setLastEvent] = useState<SessionEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    if (!sessionId) {
      setConnectionState('closed');
      return;
    }

    // Reset state when sessionId changes
    setStatus(null);
    setEvents([]);
    setLastEvent(null);
    setError(null);
    setConnectionState('connecting');

    const connect = () => {
      setConnectionState('connecting');

      const es = new EventSource(`/api/sessions/${sessionId}/events`);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnectionState('open');
        reconnectAttemptRef.current = 0;
      };

      es.onmessage = (e) => {
        try {
          const event = SessionEventSchema.parse(JSON.parse(e.data));
          setLastEvent(event);

          if (event.type !== 'heartbeat') {
            setEvents(prev => {
              const next = [...prev, event];
              return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
            });
          }

          const nextStatus = statusFromEventType(event.type);
          if (nextStatus) setStatus(nextStatus);
        } catch (err) {
          console.error('Failed to parse event:', err);
        }
      };

      es.onerror = (err) => {
        console.error('SSE connection error:', err);
        setConnectionState('error');
        setError('Connection lost. Reconnecting...');
        es.close();

        const backoff = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);
        reconnectAttemptRef.current++;

        reconnectTimeoutRef.current = setTimeout(() => {
          if (eventSourceRef.current === es) {
            connect();
          }
        }, backoff);
      };
    };

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [sessionId]);

  return { status, connectionState, lastEvent, error, events };
}
