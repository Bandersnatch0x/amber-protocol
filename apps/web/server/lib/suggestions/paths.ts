import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ALLOWED_BASENAMES = new Set(['AGENTS.md', 'CLAUDE.md']);

export function posixRel(value: string): string {
  return value.replace(/\\/g, '/');
}

// Case folding is a property of the filesystem, not of paths in general. Folding
// unconditionally makes `/home/u/proj` look like it lives inside `/home/u/Proj`
// on a case-sensitive volume, which is a cross-repo transcript leak.
const FOLDS_CASE = process.platform === 'win32' || process.platform === 'darwin';

export function normalizeFsPath(value: string): string {
  const normalized = posixRel(path.resolve(value)).replace(/\/+$/, '');
  return FOLDS_CASE ? normalized.toLowerCase() : normalized;
}

export function isRepoScoped(cwd: string | undefined, repoRoot: string): boolean {
  if (!cwd) return false;
  const cwdN = normalizeFsPath(cwd);
  const rootN = normalizeFsPath(repoRoot);
  return cwdN === rootN || cwdN.startsWith(`${rootN}/`);
}

export function isAllowlistedPath(relPath: string): boolean {
  const n = posixRel(relPath).replace(/^(\.\/)+/, '');
  if (n.includes('\0') || n.includes('..') || n.startsWith('/') || /^[a-zA-Z]:/.test(n)) {
    return false;
  }
  if (ALLOWED_BASENAMES.has(n)) return true;
  if (n.startsWith('docs/wiki/') && n.endsWith('.md')) return true;
  if (/^skills\/[^/]+\/SKILL\.md$/.test(n)) return true;
  return false;
}

function isInside(root: string, target: string): boolean {
  if (target === root) return true;
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function realpathOrNull(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

/**
 * Canonicalize `abs` through symlinks and confirm it stays inside `root`.
 *
 * A prefix comparison on the lexical path is not containment: an allowlisted
 * `docs/wiki/x.md` can be a symlink to a file outside the repository, and a
 * `create` writes through a symlinked parent directory just as happily. The
 * target may legitimately not exist yet, so the nearest existing ancestor is
 * the thing canonicalized and the remaining segments are re-appended.
 */
function containedRealPath(root: string, abs: string): string | null {
  const realRoot = realpathOrNull(root);
  if (!realRoot) return null;

  const trailing: string[] = [];
  let current = abs;
  for (;;) {
    const real = realpathOrNull(current);
    if (real !== null) {
      if (!isInside(realRoot, real)) return null;
      const resolved = path.resolve(real, ...trailing);
      return isInside(realRoot, resolved) ? resolved : null;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    trailing.unshift(path.basename(current));
    current = parent;
  }
}

export function resolveRepoFile(repoRoot: string, relPath: string): string | null {
  if (!isAllowlistedPath(relPath)) return null;
  return containedRealPath(repoRoot, path.resolve(repoRoot, posixRel(relPath)));
}

export function sha256Utf8(contents: string): string {
  return crypto.createHash('sha256').update(contents, 'utf8').digest('hex');
}

export function fileHash(absPath: string): string | null {
  try {
    return sha256Utf8(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

export function cursorWorkspaceHash(cwd: string): string {
  return crypto.createHash('md5').update(path.resolve(cwd), 'utf8').digest('hex');
}

export function defaultHomes(): { claudeHome: string; codexHome: string; cursorHome: string } {
  const home = os.homedir();
  return {
    claudeHome: process.env.AMBER_CLAUDE_HOME || home,
    codexHome: process.env.AMBER_CODEX_HOME || process.env.CODEX_HOME || path.join(home, '.codex'),
    cursorHome: process.env.AMBER_CURSOR_HOME || path.join(home, '.cursor'),
  };
}

export const HOST_FILE_CEILING = 50;
export const PROMOTION_TRANSCRIPT_THRESHOLD = 2;
export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
