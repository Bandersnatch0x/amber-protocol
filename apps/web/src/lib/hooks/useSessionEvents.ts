import { useCallback, useEffect, useState, useRef } from 'react';
import { SessionEvent, SessionStatus, SessionEventSchema } from '@/lib/types/session-events';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

// Declarative map from a session event type to the session status it implies.
// Events not in this map (session_created, task_progress, error, heartbeat)
// leave the status unchanged. Previously a 5-branch if/else inside the hook's
// onmessage handler.
const EVENT_STATUS_MAP: Partial<Record<SessionEvent['type'], SessionStatus>> = {
  session_started: 'executing',
  session_resumed: 'executing',
  session_paused: 'paused',
  session_completed: 'completed',
  session_aborted: 'aborted',
};

export function statusFromEventType(type: SessionEvent['type']): SessionStatus | null {
  return EVENT_STATUS_MAP[type] ?? null;
}

interface UseSessionEventsReturn {
  status: SessionStatus | null;
  connectionState: ConnectionState;
  lastEvent: SessionEvent | null;
  error: string | null;
  events: SessionEvent[];
  reconnect: () => void;
  reconnectAttempt: number;
}

const MAX_EVENTS = 500;

export function useSessionEvents(sessionId: string | null): UseSessionEventsReturn {
  const [status, setStatus] = useState<SessionStatus | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(() =>
    sessionId ? 'connecting' : 'closed',
  );
  const [lastEvent, setLastEvent] = useState<SessionEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  // Bumped by manualReconnect to re-run the connection effect on demand.
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const reconnectAttemptRef = useRef(0);
  const isManuallyClosedRef = useRef(false);

  // Reset per-session state when the session identity changes (render-time
  // adjustment — the react.dev replacement for resetting state in an effect).
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId);
    setStatus(null);
    setEvents([]);
    setLastEvent(null);
    setError(null);
    setReconnectAttempt(0);
    setConnectionState(sessionId ? 'connecting' : 'closed');
  }

  useEffect(() => {
    if (!sessionId) return;

    isManuallyClosedRef.current = false;
    reconnectAttemptRef.current = 0;

    const eventSourceRef: { current: EventSource | null } = { current: null };
    let reconnectTimeout: NodeJS.Timeout | null = null;

    const closeEventSource = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    const appendEvent = (event: SessionEvent) => {
      setLastEvent(event);

      if (event.type !== 'heartbeat') {
        setEvents((prev) => {
          const next = [...prev, event];
          return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
        });
      }

      const nextStatus = statusFromEventType(event.type);
      if (nextStatus) setStatus(nextStatus);
    };

    const connect = () => {
      if (isManuallyClosedRef.current) return;

      closeEventSource();

      const es = new EventSource(`/api/sessions/${sessionId}/events`);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnectionState('open');
        setError(null);
        reconnectAttemptRef.current = 0;
        setReconnectAttempt(0);
      };

      es.onmessage = (e) => {
        try {
          appendEvent(SessionEventSchema.parse(JSON.parse(e.data)));
        } catch {
          // Event parse failures are non-fatal; skip malformed events
        }
      };

      es.onerror = () => {
        setConnectionState('error');
        setError('Connection lost. Reconnecting...');
        es.close();
        if (eventSourceRef.current === es) {
          eventSourceRef.current = null;
        }

        const backoff = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 10000);
        reconnectAttemptRef.current += 1;
        setReconnectAttempt(reconnectAttemptRef.current);

        reconnectTimeout = setTimeout(connect, backoff);
      };
    };

    connect();

    const handleOnline = () => {
      if (isManuallyClosedRef.current) return;
      reconnectAttemptRef.current = 0;
      setReconnectAttempt(0);
      connect();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }

    return () => {
      isManuallyClosedRef.current = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
      closeEventSource();
    };
  }, [sessionId, reconnectNonce]);

  const manualReconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    isManuallyClosedRef.current = false;
    setConnectionState('connecting');
    setReconnectNonce((nonce) => nonce + 1);
  }, []);

  return {
    status,
    connectionState,
    lastEvent,
    error,
    events,
    reconnect: manualReconnect,
    reconnectAttempt,
  };
}
