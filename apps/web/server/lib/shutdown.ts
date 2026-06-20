/**
 * Build a signal handler that shuts the API server down gracefully.
 *
 * The EventBroadcaster holds a long-lived heartbeat interval and a set of open
 * SSE responses. On SIGTERM/SIGINT we stop the interval and release those
 * connections (cleanup), stop accepting new ones (server.close), then exit —
 * rather than letting the process be killed with sockets half-open.
 *
 * Dependencies are injected so the handler is unit-testable without a real
 * server, real signals, or a real process.exit.
 */

interface Closable {
  close(cb?: () => void): void;
}

interface Cleanable {
  cleanup(): void;
}

export function createShutdownHandler(
  server: Closable,
  broadcaster: Cleanable,
  exit: (code: number) => void,
  log: (message: string) => void = () => {},
): (signal: string) => void {
  return (signal: string): void => {
    log(`Received ${signal}, shutting down...`);
    broadcaster.cleanup();
    server.close(() => exit(0));
  };
}
