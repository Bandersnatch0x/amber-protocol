// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { logError, logWarning } from '@/lib/error-logger';

describe('error-logger', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('POSTs the error report to /api/errors', () => {
    logError(new Error('boom'), { component: 'ErrorBoundary' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/errors');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(String(init.body)).toContain('boom');
  });

  it('includes stack and context in the payload', () => {
    logError(new Error('kaboom'), { component: 'X', action: 'render' });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.message).toBe('kaboom');
    expect(body.stack).toContain('kaboom');
    expect(body.context.component).toBe('X');
  });

  it('handles non-Error values', () => {
    const payload = logError('just a string');
    expect(payload.message).toBe('just a string');
  });

  it('returns the payload and logs to console', () => {
    const payload = logError(new Error('boom'));
    expect(payload.message).toBe('boom');
    expect(console.error).toHaveBeenCalled();
  });

  it('does not throw when the report fetch rejects', () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(() => logError(new Error('x'))).not.toThrow();
  });

  it('logWarning writes to console.warn', () => {
    logWarning('heads up', { action: 'test' });
    expect(console.warn).toHaveBeenCalled();
  });
});
