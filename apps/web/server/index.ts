import { createApp } from './app';
import { resolveHost } from './lib/server-host';
import { eventBroadcaster } from './services/event-broadcaster';
import { createShutdownHandler } from './lib/shutdown';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = resolveHost();

const server = createApp().listen(PORT, HOST, () => {
  console.log(`API server listening on http://${HOST}:${PORT}`);
});

const shutdown = createShutdownHandler(
  server,
  eventBroadcaster,
  (code) => process.exit(code),
  console.log,
);

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
