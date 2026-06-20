import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { forwardError } from '@server/lib/error-forwarder';

describe('error-forwarder', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const payload = {
    message: 'boom',
    stack: 'Error: boom\n  at x',
    context: { component: 'ErrorBoundary' },
    timestamp: '2026-01-01T00:00:00.000Z',
    userAgent: 'node',
  };

  it('does not call fetch when no transport is configured', () => {
    forwardError(payload, {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs to the webhook URL when ERROR_WEBHOOK_URL is set', () => {
    forwardError(payload, { ERROR_WEBHOOK_URL: 'https://hook.example.com/e' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hook.example.com/e');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(String(init.body)).toContain('boom');
  });

  it('POSTs to Sentry when SENTRY_DSN is set', () => {
    forwardError(payload, { SENTRY_DSN: 'https://o0.ingest.sentry.io/0' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fans out to both transports when both are configured', () => {
    forwardError(payload, {
      SENTRY_DSN: 'https://o0.ingest.sentry.io/0',
      ERROR_WEBHOOK_URL: 'https://hook.example.com/e',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not throw when a transport rejects', () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(() =>
      forwardError(payload, { ERROR_WEBHOOK_URL: 'https://hook.example.com/e' }),
    ).not.toThrow();
  });

  it('defaults to process.env when no env is passed', () => {
    forwardError(payload);
    // No SENTRY_DSN / ERROR_WEBHOOK_URL in the test process env
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
