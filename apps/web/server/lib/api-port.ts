import { execFileSync } from 'node:child_process';
import net from 'node:net';

/**
 * Elastic API port resolution.
 *
 * On Windows, Hyper-V dynamic port exclusions (`netsh interface ipv4 show
 * excludedportrange protocol=tcp`) shift after every reboot and can cover the
 * API's default ports, making `listen` fail with EACCES. Resolution order:
 *
 * 1. An explicit env override (PORT / API_PORT / AMBER_E2E_API_PORT) always
 *    wins and is used verbatim — the escape hatch never probes.
 * 2. Otherwise candidates are probed in order with a real test-listen on the
 *    bind host; EACCES/EADDRINUSE (and any other listen error) marks the
 *    candidate unavailable and the next one is tried.
 *
 * A one-line notice is printed only when the first (default) candidate is
 * skipped, so machines with a healthy default port stay silent.
 */

/** Standalone dev: server default 3001, then 4101+ as a fallback bank. */
export const SERVER_PORT_CANDIDATES: readonly number[] = [
  3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010, 4101, 4102, 4103, 4104, 4105, 4106,
  4107, 4108, 4109, 4110,
];

/** E2E: config default 3101, same fallback bank (kept clear of client ports 5173/5273). */
export const E2E_API_PORT_CANDIDATES: readonly number[] = [
  3101, 3102, 3103, 3104, 3105, 3106, 3107, 3108, 3109, 3110, 4101, 4102, 4103, 4104, 4105, 4106,
  4107, 4108, 4109, 4110,
];

/** Injectable listener so unit tests can simulate EACCES/EADDRINUSE.
 * Resolves with the actually-bound port (relevant when probing port 0). */
export type PortListener = (port: number, host: string) => Promise<number | void>;

const defaultListener: PortListener = (port, host) =>
  new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => reject(error));
    probe.listen(port, host, () => {
      // Report the actually-bound port so callers can treat port 0 (OS pick)
      // as "available" without confusing it with a fallback.
      const address = probe.address();
      const bound = address !== null && typeof address !== 'string' ? address.port : undefined;
      probe.close(() => resolve(bound ?? port));
    });
  });

/**
 * Parse a raw port env value. Undefined/blank means "no override"; anything
 * that is not a valid port number is a user error and throws.
 */
export function parsePortEnv(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port value: ${JSON.stringify(raw)}`);
  }
  return parsed;
}

/**
 * Resolve the API port. Explicit override wins without probing; otherwise
 * return the first candidate that accepts a test-listen on `host`.
 */
export async function resolveApiPort(options: {
  explicit?: number;
  candidates: readonly number[];
  host: string;
  listen?: PortListener;
  log?: (message: string) => void;
}): Promise<number> {
  const { explicit, candidates, host, log = console.log } = options;
  if (explicit !== undefined) return explicit;
  if (candidates.length === 0) throw new Error('resolveApiPort: no candidate ports provided');

  const listen = options.listen ?? defaultListener;
  const attempted: Array<{ port: number; code: string }> = [];
  for (const candidate of candidates) {
    try {
      const bound = await listen(candidate, host);
      const chosen = typeof bound === 'number' && bound > 0 ? bound : candidate;
      if (chosen !== candidates[0]) {
        const detail = attempted.map((entry) => `${entry.port} (${entry.code})`).join(', ');
        log(
          `[api-port] default port ${candidates[0]} unavailable [attempted: ${detail}]; using ${chosen} instead (set AMBER_E2E_API_PORT/PORT to pin a port)`,
        );
      }
      return chosen;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      attempted.push({ port: candidate, code });
    }
  }
  const detail = attempted.map((entry) => `${entry.port} (${entry.code})`).join(', ');
  throw new Error(`resolveApiPort: no available port among candidates [${detail}]`);
}

/**
 * One-shot dev port resolution shared by the API server and the vite proxy.
 *
 * `npm run dev` (server/dev-bootstrap.ts) calls this exactly once BEFORE
 * spawning either process and injects the result as PORT/API_PORT, so neither
 * child probes on its own. Two independent concurrent probes raced: once the
 * API bound candidate N, the vite probe saw N as EADDRINUSE and targeted N+1,
 * silently diverging the /api proxy from the real server. Explicit
 * PORT/API_PORT remain the highest-priority escape hatch and are used
 * verbatim; probing only happens when neither is set.
 */
export async function resolveSharedDevPort(
  options: {
    env?: NodeJS.ProcessEnv;
    host?: string;
    log?: (message: string) => void;
  } = {},
): Promise<number> {
  const env = options.env ?? process.env;
  const explicit = parsePortEnv(env.PORT) ?? parsePortEnv(env.API_PORT);
  if (explicit !== undefined) return explicit;
  return resolveApiPort({
    candidates: SERVER_PORT_CANDIDATES,
    host: options.host ?? '127.0.0.1',
    log: options.log,
  });
}

/**
 * Inline probe script run via `node -e` in a short-lived child process
 * (execFileSync, no shell — argument quoting is safe). Reads the probe spec
 * from AMBER_PORT_PROBE and prints the first bindable port on stdout.
 */
const PROBE_SCRIPT = [
  "const net = require('net');",
  'const spec = JSON.parse(process.env.AMBER_PORT_PROBE);',
  'const tryPort = (index) => {',
  '  if (index >= spec.candidates.length) {',
  "    console.error('no available port among candidates: ' + spec.candidates.join(', '));",
  '    process.exit(1);',
  '  }',
  '  const port = spec.candidates[index];',
  '  const probe = net.createServer();',
  "  probe.once('error', () => tryPort(index + 1));",
  '  probe.listen(port, spec.host, () => {',
  '    const address = probe.address();',
  '    const bound = address && typeof address !== "string" ? address.port : port;',
  '    probe.close(() => console.log(bound));',
  '  });',
  '};',
  'tryPort(0);',
].join('\n');

/**
 * Synchronous variant for Playwright's config file (which cannot use
 * top-level await). Same candidate semantics as `resolveApiPort`.
 */
export function resolveApiPortSync(options: {
  explicit?: number;
  candidates: readonly number[];
  host: string;
  log?: (message: string) => void;
}): number {
  if (options.explicit !== undefined) return options.explicit;
  const stdout = execFileSync(process.execPath, ['-e', PROBE_SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      // The probe's stdout is machine-readable; strip any inherited color
      // forcing (e.g. Playwright workers set FORCE_COLOR) so no ANSI codes
      // wrap the port number.
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      AMBER_PORT_PROBE: JSON.stringify({ host: options.host, candidates: options.candidates }),
    },
  });
  // Tolerate stray decoration (log hooks, colorizers) by extracting the port.
  const match = stdout.match(/\b([1-9]\d{0,4})\b/);
  const parsed = match ? Number(match[1]) : NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`resolveApiPortSync: probe returned ${JSON.stringify(stdout.trim())}`);
  }
  if (parsed !== options.candidates[0]) {
    (options.log ?? console.log)(
      `[api-port] default port ${options.candidates[0]} unavailable; using ${parsed} instead (set the port env var to pin a port)`,
    );
  }
  return parsed;
}
