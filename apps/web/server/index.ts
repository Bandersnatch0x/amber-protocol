import { createApp } from './app';
import { resolveHost } from './lib/server-host';
import { parsePortEnv, resolveApiPort, SERVER_PORT_CANDIDATES } from './lib/api-port';
import { eventBroadcaster } from './services/event-broadcaster';
import { harvestOrphanedEvidenceJobs } from './services/evidence-jobs';
import { createShutdownHandler } from './lib/shutdown';

const HOST = resolveHost();

async function main(): Promise<void> {
  // Explicit PORT/API_PORT always wins (escape hatch, never probed). Under
  // `npm run dev`, server/dev-bootstrap.ts resolves the port exactly once
  // before spawning anything and injects it as PORT/API_PORT, so this
  // process never probes in the shared dev flow — two independent probes
  // used to race and diverge from the vite proxy target. Probing remains
  // the fallback for running the server standalone, so Hyper-V port
  // exclusions (EACCES on listen) fall back instead of crashing startup.
  const PORT = await resolveApiPort({
    explicit: parsePortEnv(process.env.PORT) ?? parsePortEnv(process.env.API_PORT),
    candidates: SERVER_PORT_CANDIDATES,
    host: HOST,
  });

  const server = createApp().listen(PORT, HOST, () => {
    console.log(`API server listening on http://${HOST}:${PORT}`);
  });

  // Startup harvest (lazy): settle evidence jobs left pending/running by a
  // previous server process and prune stale terminal job files. Deferred off
  // the listen callback so it never delays startup; failures only log.
  setImmediate(() => {
    try {
      const { settled, removed } = harvestOrphanedEvidenceJobs();
      if (settled > 0 || removed > 0) {
        console.log(
          `Evidence-job harvest: settled ${settled} orphaned job(s), removed ${removed} stale file(s).`,
        );
      }
    } catch (error) {
      console.error('Evidence-job harvest failed:', error);
    }
  });

  const shutdown = createShutdownHandler(
    server,
    eventBroadcaster,
    (code) => process.exit(code),
    console.log,
  );

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('API server failed to start:', error);
  process.exit(1);
});
