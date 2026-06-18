import path from 'path';

/**
 * Resolve `segments` under `baseDir` and return the absolute path ONLY if it
 * stays inside `baseDir`. Returns null when the segments escape it (path
 * traversal via `..`, an absolute segment, etc.), so a reader treats a
 * malicious id exactly like a missing file rather than reading outside its
 * data directory.
 *
 * Centralizes the inline guard that gate-reader.getGate already performs, so
 * session-reader, route-reader, and the transcript reader share one robust,
 * id-format-agnostic check (it never rejects a legitimate id, whatever its
 * charset — it only blocks escapes).
 */
export function resolveWithin(baseDir: string, ...segments: string[]): string | null {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, ...segments);
  const rel = path.relative(base, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}
