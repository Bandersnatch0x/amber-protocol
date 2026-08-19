import { concurrently, type CloseEvent } from 'concurrently';
import { resolveSharedDevPort } from './lib/api-port';
import { resolveHost } from './lib/server-host';

/**
 * Dev startup orchestrator (the `npm run dev` entry point).
 *
 * Historical bug: the old script spawned `dev:server` and `dev:client`
 * directly via concurrently, and both sides probed the same candidate list
 * independently (server/index.ts and vite.config.mts). Under concurrent
 * startup the API would bind e.g. 4101, vite's probe would then see 4101 as
 * EADDRINUSE and pick 4102 as the proxy target — diverging the /api proxy
 * from the real server and breaking every proxied request.
 *
 * Fix: resolve the port exactly once here, BEFORE spawning anything, and
 * inject it into both children via PORT/API_PORT. Neither child probes
 * anymore, so there is no race window. Explicit PORT/API_PORT remain the
 * highest-priority escape hatch (used verbatim, never probed).
 *
 * Note: this file is `.mts` on purpose — concurrently v10 is ESM-only and
 * its rxjs namespace breaks under CommonJS require interop (tsx on a CJS
 * package), so the orchestrator must run as real ESM.
 */

async function main(): Promise<void> {
  // Probe on the actual bind host when it is a concrete address; fall back
  // to loopback when HOST is a wildcard (0.0.0.0/::) since the vite proxy
  // always targets 127.0.0.1 anyway.
  const host = resolveHost();
  const probeHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const apiPort = await resolveSharedDevPort({ host: probeHost });

  // Inject the single resolution into both children so neither probes.
  process.env.PORT = String(apiPort);
  process.env.API_PORT = String(apiPort);
  console.log(
    `[dev] API port resolved once: ${apiPort} (shared by server and vite proxy via PORT/API_PORT)`,
  );

  const { result } = concurrently(
    [
      { command: 'npm run dev:server', name: 'server' },
      { command: 'npm run dev:client', name: 'client' },
    ],
    { prefix: 'name', killOthersOn: ['failure', 'success'] },
  );

  const exitCodeOf = (events: CloseEvent[]): number => {
    const own = events.filter((event) => !event.killed);
    const failed = own.find((event) => event.exitCode !== 0);
    if (!failed) return 0;
    return typeof failed.exitCode === 'number' ? failed.exitCode : 1;
  };

  result.then(
    (events) => process.exit(exitCodeOf(events)),
    (events: unknown) =>
      process.exit(Array.isArray(events) ? exitCodeOf(events as CloseEvent[]) : 1),
  );
}

main().catch((error) => {
  console.error('[dev] failed to start:', error);
  process.exit(1);
});
