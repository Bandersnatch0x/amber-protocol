interface ErrorContext {
  component?: string;
  action?: string;
  [key: string]: unknown;
}

interface ErrorPayload {
  message: string;
  stack?: string;
  context: ErrorContext;
  timestamp: string;
  userAgent: string;
}

// The Vite client cannot read process.env, so external monitoring destinations
// (Sentry / webhook) live on the server. The client reports here and the server
// fans out — see server/routes/errors.ts and server/lib/error-forwarder.ts.
const ERROR_REPORT_ENDPOINT = '/api/errors';

function buildPayload(error: unknown, context: ErrorContext): ErrorPayload {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context,
    timestamp: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
  };
}

export function logError(error: unknown, context: ErrorContext = {}): ErrorPayload {
  const payload = buildPayload(error, context);

  // Always log locally so a dropped network report is never the only record.
  console.error('[Amber Error]', payload);

  // Report to the server, fire-and-forget. keepalive lets the report survive a
  // page teardown (e.g. the error that just crashed the app). A monitoring
  // outage must never surface to the caller.
  if (typeof fetch !== 'undefined') {
    try {
      void fetch(ERROR_REPORT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Ignore synchronous fetch failures.
    }
  }

  return payload;
}

export function logWarning(message: string, context: ErrorContext = {}): void {
  console.warn('[Amber Warning]', { message, context, timestamp: new Date().toISOString() });
}
