import { Request } from 'express';
import crypto from 'crypto';

export interface SSEAuthResult {
  valid: boolean;
  reason?: string;
}

function extractToken(req: Request): string | undefined {
  const queryToken = req.query.token;
  if (typeof queryToken === 'string' && queryToken.length > 0) {
    return queryToken;
  }

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }

  return undefined;
}

export function validateSSEAuthToken(req: Request): SSEAuthResult {
  const secret = process.env.SSE_AUTH_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return { valid: false, reason: 'SSE authentication is not configured' };
    }

    console.warn(
      '[auth-token] SSE_AUTH_SECRET is not set. The SSE endpoint is open in development/test environments.',
    );
    return {
      valid: true,
      reason: 'SSE authentication is not configured; allowed in development/test',
    };
  }

  const token = extractToken(req);
  if (!token) {
    return { valid: false, reason: 'Missing SSE authentication token' };
  }

  const secretBuffer = Buffer.from(secret);
  const tokenBuffer = Buffer.from(token);

  if (secretBuffer.length !== tokenBuffer.length) {
    return { valid: false, reason: 'Invalid SSE authentication token' };
  }

  try {
    if (crypto.timingSafeEqual(secretBuffer, tokenBuffer)) {
      return { valid: true };
    }
    return { valid: false, reason: 'Invalid SSE authentication token' };
  } catch {
    return { valid: false, reason: 'Invalid SSE authentication token' };
  }
}
