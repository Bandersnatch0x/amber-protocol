'use client';

import { useEffect, useState, useRef } from 'react';
import { SessionEvent, SessionStatus, SessionEventSchema } from '@/lib/types/session-events';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

interface UseSessionEventsReturn {
  status: SessionStatus | null;
  connectionState: ConnectionState;
  lastEvent: SessionEvent | null;
  error: string | null;
  events: SessionEvent[];
}

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

    const connect = () => {
      setConnectionState('connecting');
      setError(null);

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
            setEvents(prev => [...prev, event]);
          }

          if (event.type === 'session_started') setStatus('running');
          else if (event.type === 'session_paused') setStatus('paused');
          else if (event.type === 'session_resumed') setStatus('running');
          else if (event.type === 'session_completed') setStatus('completed');
          else if (event.type === 'session_aborted') setStatus('aborted');
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
