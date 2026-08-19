import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import { handleErrorReport } from '@server/routes/errors';
import * as forwarder from '@server/lib/error-forwarder';

vi.mock('@server/lib/error-forwarder', () => ({
  forwardError: vi.fn(),
}));

function mockRes(): any {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  };
}

function mockReq(body: unknown, headers: Record<string, string> = {}): any {
  return { body, headers };
}

function lastPayload() {
  return (forwarder.forwardError as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
}

describe('handleErrorReport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 204 and forwards a valid report', () => {
    const res = mockRes();
    handleErrorReport(mockReq({ message: 'boom' }) as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(forwarder.forwardError).toHaveBeenCalledTimes(1);
    expect(lastPayload().message).toBe('boom');
  });

  it('returns 400 when message is missing', () => {
    const res = mockRes();
    handleErrorReport(mockReq({}) as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(forwarder.forwardError).not.toHaveBeenCalled();
  });

  it('returns 400 when message is not a string', () => {
    const res = mockRes();
    handleErrorReport(mockReq({ message: 123 }) as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(forwarder.forwardError).not.toHaveBeenCalled();
  });

  it('returns 400 when body is absent', () => {
    const res = mockRes();
    handleErrorReport(mockReq(undefined) as Request, res as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('redacts secrets in the message before forwarding', () => {
    const res = mockRes();
    handleErrorReport(
      mockReq({ message: 'token sk-ant-api03-abcdefghijklmnop failed' }) as Request,
      res as Response,
    );
    const payload = lastPayload();
    expect(payload.message).not.toContain('sk-ant-api03-abcdefghijklmnop');
    expect(payload.message).toContain('[REDACTED]');
  });

  it('redacts the stack and caps its length', () => {
    const res = mockRes();
    const longStack = 'x'.repeat(20000);
    handleErrorReport(mockReq({ message: 'm', stack: longStack }) as Request, res as Response);
    expect(lastPayload().stack.length).toBeLessThanOrEqual(8000);
  });

  it('captures the user-agent header', () => {
    const res = mockRes();
    handleErrorReport(
      mockReq({ message: 'm' }, { 'user-agent': 'Mozilla/5.0' }) as Request,
      res as Response,
    );
    expect(lastPayload().userAgent).toBe('Mozilla/5.0');
  });

  it('redacts secrets in the context object before forwarding', () => {
    const res = mockRes();
    handleErrorReport(
      mockReq({
        message: 'm',
        context: {
          apiKey: 'sk-ant-api03-AbC123_def456GHI789jkl',
          nested: { token: 'ghp_1234567890abcdefABCDEF1234567890abcd' },
        },
      }) as Request,
      res as Response,
    );
    const payload = lastPayload();
    const ctx = payload.context as Record<string, unknown>;
    expect(JSON.stringify(ctx)).not.toContain('sk-ant-api03-AbC123_def456GHI789jkl');
    expect(JSON.stringify(ctx)).not.toContain('ghp_1234567890abcdefABCDEF1234567890abcd');
    expect(ctx.apiKey).toContain('[REDACTED]');
    expect((ctx.nested as Record<string, unknown>).token).toContain('[REDACTED]');
  });

  it('preserves non-secret context values while redacting secrets', () => {
    const res = mockRes();
    handleErrorReport(
      mockReq({
        message: 'm',
        context: { route: '/dashboard', retryCount: 3, ok: true },
      }) as Request,
      res as Response,
    );
    const ctx = lastPayload().context as Record<string, unknown>;
    expect(ctx.route).toBe('/dashboard');
    expect(ctx.retryCount).toBe(3);
    expect(ctx.ok).toBe(true);
  });
});
