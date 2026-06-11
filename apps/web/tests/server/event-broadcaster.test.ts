import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { eventBroadcaster } from '@/server/services/event-broadcaster';
import { SessionEvent } from '@/server/types/session-events';

function createMockResponse(): any {
  const handlers = new Map<string, Function[]>();
  const mock: any = {
    write: vi.fn((data: string, cb?: Function) => {
      if (cb) setTimeout(() => cb(null), 0);
      return true;
    }),
    end: vi.fn(),
    on: vi.fn((event: string, cb: Function) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(cb);
    }),
    emit: (event: string) => {
      handlers.get(event)?.forEach(cb => cb());
    },
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
  };
  return mock;
}

describe('EventBroadcaster', () => {
  beforeEach(() => {
    eventBroadcaster.cleanup();
  });

  afterEach(() => {
    eventBroadcaster.cleanup();
  });

  it('should add and remove connections', () => {
    const res = createMockResponse();
    const added = eventBroadcaster.addConnection('session-1', res);
    expect(added).toBe(true);
    expect(eventBroadcaster.connectionCount('session-1')).toBe(1);

    res.emit('close');
    expect(eventBroadcaster.connectionCount('session-1')).toBe(0);
  });

  it('should broadcast to multiple connections', async () => {
    const res1 = createMockResponse();
    const res2 = createMockResponse();
    eventBroadcaster.addConnection('session-1', res1);
    eventBroadcaster.addConnection('session-1', res2);

    const event: SessionEvent = { type: 'session_started', sessionId: 'session-1', timestamp: Date.now() };
    await eventBroadcaster.broadcast('session-1', event);

    expect(res1.write).toHaveBeenCalled();
    expect(res2.write).toHaveBeenCalled();
  });

  it('should enforce max connections per session', () => {
    const responses = Array.from({ length: 12 }, () => createMockResponse());
    const results = responses.map(r => eventBroadcaster.addConnection('session-1', r));

    const successful = results.filter(Boolean).length;
    expect(successful).toBeLessThanOrEqual(10);
  });

  it('should cleanup all connections', () => {
    for (let i = 0; i < 5; i++) {
      eventBroadcaster.addConnection('session-1', createMockResponse());
    }

    eventBroadcaster.cleanup();
    expect(eventBroadcaster.totalConnectionCount()).toBe(0);
  });

  it('should remove dead connections on broadcast failure', async () => {
    const res = createMockResponse();
    eventBroadcaster.addConnection('session-1', res);

    res.write = vi.fn((_data: string, cb?: Function) => {
      if (cb) setTimeout(() => cb(new Error('write failed')), 0);
      return false;
    });

    const event: SessionEvent = { type: 'heartbeat', timestamp: Date.now() };
    await eventBroadcaster.broadcast('session-1', event);

    expect(eventBroadcaster.connectionCount('session-1')).toBe(0);
  });
});