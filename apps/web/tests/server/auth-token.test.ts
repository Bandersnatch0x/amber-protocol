import { describe, it, expect, afterEach } from 'vitest';
import type { Request } from 'express';
import { validateSSEAuthToken } from '@server/lib/auth-token';

function mockRequest(
  overrides: { query?: Record<string, string>; headers?: Record<string, string> } = {},
): Partial<Request> {
  return {
    query: {},
    headers: {},
    ...overrides,
  };
}

describe('auth-token', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // --- Production, secret configured ---

  it('validates a matching token via query param', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSE_AUTH_SECRET = 'prod-secret';
    const result = validateSSEAuthToken(
      mockRequest({ query: { token: 'prod-secret' } }) as Request,
    );
    expect(result.valid).toBe(true);
  });

  it('validates a matching token via Authorization header', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSE_AUTH_SECRET = 'prod-secret';
    const result = validateSSEAuthToken(
      mockRequest({ headers: { authorization: 'Bearer prod-secret' } }) as Request,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects a mismatched token via query param', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSE_AUTH_SECRET = 'prod-secret';
    const result = validateSSEAuthToken(mockRequest({ query: { token: 'wrong' } }) as Request);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Invalid');
  });

  it('rejects a mismatched token via Authorization header', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSE_AUTH_SECRET = 'prod-secret';
    const result = validateSSEAuthToken(
      mockRequest({ headers: { authorization: 'Bearer wrong' } }) as Request,
    );
    expect(result.valid).toBe(false);
  });

  it('rejects when token length differs from secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSE_AUTH_SECRET = 'long-secret-value';
    const result = validateSSEAuthToken(mockRequest({ query: { token: 'short' } }) as Request);
    expect(result.valid).toBe(false);
  });

  it('rejects missing token when secret is set', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSE_AUTH_SECRET = 'prod-secret';
    const result = validateSSEAuthToken(mockRequest() as Request);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing');
  });

  it('rejects empty query string token', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSE_AUTH_SECRET = 'prod-secret';
    const result = validateSSEAuthToken(mockRequest({ query: { token: '' } }) as Request);
    expect(result.valid).toBe(false);
  });

  // --- Production, secret NOT configured ---

  it('rejects in production with no secret configured', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SSE_AUTH_SECRET;
    const result = validateSSEAuthToken(mockRequest() as Request);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not configured');
  });

  // --- Development, secret NOT configured ---

  it('allows in development with no secret configured', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SSE_AUTH_SECRET;
    const result = validateSSEAuthToken(mockRequest() as Request);
    expect(result.valid).toBe(true);
  });

  it('allows in test with no secret configured', () => {
    delete process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    delete process.env.SSE_AUTH_SECRET;
    const result = validateSSEAuthToken(mockRequest() as Request);
    expect(result.valid).toBe(true);
  });

  // --- Token extraction priority ---

  it('prefers query token over Authorization header', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSE_AUTH_SECRET = 'query-wins';
    // Query has the correct token, header has wrong
    const result = validateSSEAuthToken(
      mockRequest({
        query: { token: 'query-wins' },
        headers: { authorization: 'Bearer header-loses' },
      }) as Request,
    );
    expect(result.valid).toBe(true);
  });

  it('falls back to Authorization header when query is absent', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSE_AUTH_SECRET = 'bearer-wins';
    const result = validateSSEAuthToken(
      mockRequest({
        headers: { authorization: 'Bearer bearer-wins' },
      }) as Request,
    );
    expect(result.valid).toBe(true);
  });

  // --- Edge cases ---

  it('handles non-string query token gracefully', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSE_AUTH_SECRET = 'secret';
    const req = mockRequest() as any;
    req.query = { token: ['array', 'token'] };
    const result = validateSSEAuthToken(req as Request);
    expect(result.valid).toBe(false);
  });

  it('handles missing Authorization header prefix', () => {
    process.env.NODE_ENV = 'production';
    process.env.SSE_AUTH_SECRET = 'no-bearer';
    const result = validateSSEAuthToken(
      mockRequest({ headers: { authorization: 'no-bearer' } }) as Request,
    );
    expect(result.valid).toBe(false);
  });
});
