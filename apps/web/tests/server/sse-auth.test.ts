import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request } from 'express';
import { handleSSE } from '@server/routes/sse';
import { eventBroadcaster } from '@server/services/event-broadcaster';
import * as sessionReader from '@server/lib/session-reader';

vi.mock('@server/lib/session-reader', () => ({
  readSessionById: vi.fn(),
}));

function createMockResponse(): any {
  const handlers = new Map<string, Function[]>();
  return {
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
      handlers.get(event)?.forEach((cb) => cb());
    },
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    flushHeaders: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
}

function createMockRequest(
  overrides: { query?: Record<string, string>; headers?: Record<string, string> } = {},
): any {
  return {
    params: { sessionId: 'session-1' },
    query: {},
    headers: {},
    ...overrides,
  };
}

describe('SSE authentication', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    eventBroadcaster.cleanup();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    eventBroadcaster.cleanup();
  });

  it('opens the stream when a valid token is provided via query param', () => {
    process.env.SSE_AUTH_SECRET = 'valid-token';
    (sessionReader.readSessionById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'session-1',
      goal: 'test',
    });

    const req = createMockRequest({ query: { token: 'valid-token' } });
    const res = createMockResponse();

    handleSSE(req as unknown as Request, res as unknown as Response);

    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.flushHeaders).toHaveBeenCalled();
  });

  it('opens the stream when a valid token is provided via Authorization header', () => {
    process.env.SSE_AUTH_SECRET = 'valid-token';
    (sessionReader.readSessionById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'session-1',
      goal: 'test',
    });

    const req = createMockRequest({ headers: { authorization: 'Bearer valid-token' } });
    const res = createMockResponse();

    handleSSE(req as unknown as Request, res as unknown as Response);

    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
  });

  it('returns 401 when no token is provided', () => {
    process.env.SSE_AUTH_SECRET = 'valid-token';
    const req = createMockRequest();
    const res = createMockResponse();

    handleSSE(req as unknown as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns 401 when an invalid token is provided', () => {
    process.env.SSE_AUTH_SECRET = 'valid-token';
    const req = createMockRequest({ query: { token: 'invalid-token' } });
    const res = createMockResponse();

    handleSSE(req as unknown as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('warns and allows the request when the secret is unset in development', () => {
    delete process.env.SSE_AUTH_SECRET;
    process.env.NODE_ENV = 'development';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    (sessionReader.readSessionById as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'session-1',
      goal: 'test',
    });

    const req = createMockRequest();
    const res = createMockResponse();

    handleSSE(req as unknown as Request, res as unknown as Response);

    expect(warnSpy).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');

    warnSpy.mockRestore();
  });

  it('returns 401 when the secret is unset in production', () => {
    delete process.env.SSE_AUTH_SECRET;
    process.env.NODE_ENV = 'production';
    const req = createMockRequest();
    const res = createMockResponse();

    handleSSE(req as unknown as Request, res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });
});
