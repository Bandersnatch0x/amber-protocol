/**
 * Resolve the network interface the API server binds to.
 *
 * The viewer's tRPC endpoints are unauthenticated (publicProcedure) and serve
 * session manifests, timelines, and (redacted) transcripts, and the SSE auth is
 * open when SSE_AUTH_SECRET is unset. Binding to all interfaces would expose all
 * of that to anyone on the same network, so the default is loopback-only —
 * matching the "http://localhost" the server logs. Set HOST explicitly (e.g.
 * 0.0.0.0) to opt into LAN access.
 */
export function resolveHost(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.HOST?.trim();
  return host && host.length > 0 ? host : '127.0.0.1';
}
