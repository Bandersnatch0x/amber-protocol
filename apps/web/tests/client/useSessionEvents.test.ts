import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessionEvents } from '@/lib/hooks/useSessionEvents';

describe('useSessionEvents', () => {
  let mockEventSource: any;
  let onopen: Function;
  let onmessage: Function;
  let onerror: Function;

  beforeEach(() => {
    vi.useFakeTimers();
    onopen = vi.fn();
    onmessage = vi.fn();
    onerror = vi.fn();

    mockEventSource = {
      close: vi.fn(),
    };

    global.EventSource = vi.fn(() => {
      const es = {
        ...mockEventSource,
        set onopen(fn: Function) { onopen = fn; },
        set onmessage(fn: Function) { onmessage = fn; },
        set onerror(fn: Function) { onerror = fn; },
        get readyState() { return 1; },
      };
      Object.defineProperty(es, 'onopen', { set: (fn: Function) => { onopen = fn; } });
      Object.defineProperty(es, 'onmessage', { set: (fn: Function) => { onmessage = fn; } });
      Object.defineProperty(es, 'onerror', { set: (fn: Function) => { onerror = fn; } });
      return es;
    }) as any;
  });

  afterEach(() => {
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
    expect(global.EventSource).toHaveBeenCalledWith('/api/sessions/session-1/events');
    act(() => { onopen(); });
    expect(result.current.connectionState).toBe('open');
  });

  it('should update status on event', () => {
    const { result } = renderHook(() => useSessionEvents('session-1'));
    act(() => { onopen(); });
    act(() => {
      onmessage({ data: JSON.stringify({ type: 'session_started', sessionId: 'session-1', timestamp: Date.now() }) });
    });
    expect(result.current.status).toBe('running');
  });

  it('should handle reconnect with backoff', () => {
    const { result } = renderHook(() => useSessionEvents('session-1'));
    act(() => { onerror(); });
    expect(global.EventSource).toHaveBeenCalledTimes(2);
  });

  it('should close connection on unmount', () => {
    const { unmount } = renderHook(() => useSessionEvents('session-1'));
    unmount();
    expect(mockEventSource.close).toHaveBeenCalled();
  });

  it('should handle sessionId change', () => {
    const { rerender } = renderHook(
      (props: { sessionId: string | null }) => useSessionEvents(props.sessionId),
      { initialProps: { sessionId: 'session-1' } }
    );
    expect(global.EventSource).toHaveBeenCalledWith('/api/sessions/session-1/events');
    rerender({ sessionId: 'session-2' });
    expect(global.EventSource).toHaveBeenLastCalledWith('/api/sessions/session-2/events');
  });
});