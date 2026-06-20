/**
 * Forward a client-reported error to external monitoring from the server.
 *
 * The Vite client cannot read `process.env`, so Sentry / webhook destinations
 * are unreachable from the browser. The browser POSTs errors to `/api/errors`
 * and this module — running in Node, where `process.env` exists — fans them out
 * to whichever transports are configured. Webhook URLs therefore never ship in
 * the client bundle.
 *
 * Every transport is fire-and-forget: a monitoring outage must never block the
 * request or surface as an error to the caller.
 */

export interface ErrorReportPayload {
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  timestamp: string;
  userAgent?: string;
}

function postJson(url: string, payload: ErrorReportPayload): void {
  try {
    const result = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    // Swallow async rejections so a dead transport can't crash the process.
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch {
    // Swallow synchronous throws (e.g. an invalid URL) for the same reason.
  }
}

/**
 * Build the Sentry envelope ingest URL from a DSN. Mirrors the lightweight
 * (no-SDK) construction the client used previously.
 */
function sentryIngestUrl(dsn: string): string | null {
  const projectId = dsn.split('/').pop();
  if (!projectId) {
    return null;
  }
  return dsn.replace(/\/$/, '').replace(/\/api\/\d+$/, `/api/${projectId}/envelope/`);
}

export function forwardError(
  payload: ErrorReportPayload,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const webhook = env.ERROR_WEBHOOK_URL;
  if (typeof webhook === 'string' && webhook.length > 0) {
    postJson(webhook, payload);
  }

  const dsn = env.SENTRY_DSN;
  if (typeof dsn === 'string' && dsn.length > 0) {
    const url = sentryIngestUrl(dsn);
    if (url) {
      postJson(url, payload);
    }
  }
}
