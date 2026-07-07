// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionEvents } from '@/lib/hooks/useSessionEvents';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 1;
  onopen: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  static get last(): MockEventSource {
    return MockEventSource.instances[MockEventSource.instances.length - 1];
  }
}

describe('useSessionEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return initial state when sessionId is null', () => {
    const { result } = renderHook(() => useSessionEvents(null));
    expect(result.current.connectionState).toBe('closed');
    expect(result.current.status).toBeNull();
    expect(result.current.lastEvent).toBeNull();
  });

  it('should connect when sessionId is provided', () => {
    const { result } = renderHook(() => useSessionEvents('session-1'));
    expect(MockEventSource.last.url).toBe('/api/sessions/session-1/events');
    act(() => {
      MockEventSource.last.onopen?.();
    });
    expect(result.current.connectionState).toBe('open');
  });

  it('should update status on event', () => {
    const { result } = renderHook(() => useSessionEvents('session-1'));
    act(() => {
      MockEventSource.last.onopen?.();
    });
    act(() => {
      MockEventSource.last.onmessage?.({
        data: JSON.stringify({
          type: 'session_started',
          sessionId: 'session-1',
          timestamp: Date.now(),
        }),
      });
    });
    expect(result.current.status).toBe('executing');
    expect(result.current.events).toHaveLength(1);
  });

  it('should handle reconnect with backoff', () => {
    renderHook(() => useSessionEvents('session-1'));
    const first = MockEventSource.last;
    act(() => {
      first.onerror?.();
    });
    expect(first.close).toHaveBeenCalled();
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.last).not.toBe(first);
  });

  it('should close connection on unmount', () => {
    const { unmount } = renderHook(() => useSessionEvents('session-1'));
    const es = MockEventSource.last;
    unmount();
    expect(es.close).toHaveBeenCalled();
  });

  it('should handle sessionId change', () => {
    const { rerender } = renderHook(
      (props: { sessionId: string | null }) => useSessionEvents(props.sessionId),
      { initialProps: { sessionId: 'session-1' as string | null } },
    );
    expect(MockEventSource.last.url).toBe('/api/sessions/session-1/events');
    rerender({ sessionId: 'session-2' });
    expect(MockEventSource.last.url).toBe('/api/sessions/session-2/events');
  });
});
