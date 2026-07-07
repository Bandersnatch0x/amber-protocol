/**
 * Amber artifact store — the single owner of "how the web server reads Amber
 * artifacts off disk": repo-root + `.amber` path resolution (with traversal
 * guard), safe read-one-JSON, and enumerate-a-directory-of-JSON with a
 * skip-corrupt policy. The TS twin of scripts/lib/core/fs-utils.js.
 *
 * Readers (session, route, gate) should shrink to "which subdirectory + what
 * DTO shape" and delegate everything else here.
 *
 * ADR-0006: the viewer is `.amber`-only — no legacy `.harness` fallback.
 * Repositories still on `.harness` must run `amber migrate` first.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { resolveWithin } from './safe-path';
import { AMBER_STATE_DIR } from './state-dir';
import { resolveRepoRoot } from './repo-root';

export interface JsonReadResult {
  value: unknown;
  error: Error | null;
}

export interface JsonDirEntry {
  name: string;
  value: unknown;
}

/**
 * Resolve a path under the repo root. Segments are traversal-guarded: an id
 * that escapes the base (via `..` or an absolute segment) returns null, so
 * callers treat a malicious id exactly like a missing file.
 */
export function resolveRepoPath(...segments: string[]): string | null {
  const repoRoot = resolveRepoRoot();
  if (segments.length === 0) {
    return repoRoot;
  }
  return resolveWithin(repoRoot, ...segments);
}

/**
 * Resolve a path under `.amber/` in the repo root, traversal-guarded the same
 * way as resolveRepoPath.
 */
export function resolveStatePath(...segments: string[]): string | null {
  const stateDir = path.join(resolveRepoRoot(), AMBER_STATE_DIR);
  if (segments.length === 0) {
    return stateDir;
  }
  return resolveWithin(stateDir, ...segments);
}

/** Read and parse one JSON file. Never throws: `{ value, error }`. */
export function readJsonSafe(filePath: string): JsonReadResult {
  try {
    return { value: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (error: unknown) {
    return { value: null, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** Async variant of readJsonSafe for readers that parallelize their reads. */
export async function readJsonSafeAsync(filePath: string): Promise<JsonReadResult> {
  try {
    return { value: JSON.parse(await fsp.readFile(filePath, 'utf8')), error: null };
  } catch (error: unknown) {
    return { value: null, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Enumerate every JSON file in a directory (optionally filtered by suffix),
 * skipping corrupt files so one bad artifact cannot crash enumeration.
 * Returns [] when the directory is missing.
 */
export function readJsonDir(dirPath: string, opts: { suffix?: string } = {}): JsonDirEntry[] {
  const suffix = opts.suffix ?? '.json';

  let files: string[];
  try {
    files = fs.readdirSync(dirPath);
  } catch {
    return [];
  }

  const entries: JsonDirEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(suffix)) {
      continue;
    }
    const { value, error } = readJsonSafe(path.join(dirPath, file));
    if (error) {
      console.error(`Skipping corrupt artifact ${path.join(dirPath, file)}:`, error.message);
      continue;
    }
    entries.push({ name: file.slice(0, -suffix.length), value });
  }
  return entries;
}

/** Async variant of readJsonDir — same skip-corrupt, returns Promise. */
export async function readJsonDirAsync(
  dirPath: string,
  opts: { suffix?: string } = {},
): Promise<JsonDirEntry[]> {
  const suffix = opts.suffix ?? '.json';

  let files: string[];
  try {
    files = await fsp.readdir(dirPath);
  } catch {
    return [];
  }

  const entries: JsonDirEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(suffix)) continue;
    const fullPath = path.join(dirPath, file);
    const { value, error } = await readJsonSafeAsync(fullPath);
    if (error) {
      console.error(`Skipping corrupt artifact ${fullPath}:`, error.message);
      continue;
    }
    entries.push({ name: file.slice(0, -suffix.length), value });
  }
  return entries;
}
