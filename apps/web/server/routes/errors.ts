import { Request, Response } from 'express';
import { redactSecrets, redactDeep } from '../lib/redaction';
import { forwardError, ErrorReportPayload } from '../lib/error-forwarder';

// Cap field sizes so a misbehaving (or hostile) client can't push large
// payloads through to external monitoring. The express.json limit on the route
// is the first line of defense; these are the second.
const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;

/**
 * Accept a client error report and fan it out to external monitoring.
 *
 * Runs in Node, so `forwardError` can read `process.env` (Sentry / webhook),
 * which the Vite client cannot. Message and stack are redacted before they
 * leave the process — a client error string can contain a leaked token.
 */
export function handleErrorReport(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawMessage = body.message;

  if (typeof rawMessage !== 'string' || rawMessage.trim().length === 0) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const payload: ErrorReportPayload = {
    message: redactSecrets(rawMessage).slice(0, MAX_MESSAGE_LEN),
    stack:
      typeof body.stack === 'string'
        ? redactSecrets(body.stack).slice(0, MAX_STACK_LEN)
        : undefined,
    context:
      body.context && typeof body.context === 'object'
        ? (redactDeep(body.context) as Record<string, unknown>)
        : undefined,
    timestamp: new Date().toISOString(),
    userAgent:
      typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  };

  forwardError(payload);
  res.status(204).end();
}
