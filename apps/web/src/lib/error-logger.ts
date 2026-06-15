interface ErrorContext {
  component?: string;
  action?: string;
  [key: string]: any;
}

export function logError(error: unknown, context: ErrorContext = {}) {
  const errorData = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    context,
    timestamp: new Date().toISOString(),
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'server',
  };

  console.error('[Amber Error]', errorData);

  // Phase D: Sentry integration
  // if (import.meta.env.VITE_SENTRY_DSN) {
  //   Sentry.captureException(error, { contexts: { custom: context } });
  // }

  return errorData;
}

export function logWarning(message: string, context: ErrorContext = {}) {
  console.warn('[Amber Warning]', { message, context, timestamp: new Date().toISOString() });
}
