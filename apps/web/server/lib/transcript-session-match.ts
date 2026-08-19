/**
 * Inferred transcript↔session association (task #34) — pure matching logic.
 *
 * Upgrades the old "cannot link transcripts to sessions" honesty into an
 * evidence-backed inference: a Claude transcript is a *candidate* for an
 * Amber session when its recorded working directory equals the repository
 * root (or the session's worktree path) AND its activity window overlaps the
 * session's activity window. Everything here is pure and unit-testable; the
 * disk reads live in transcript-service/session-reader.
 *
 * Read-only by construction: no writes, no side effects (ADR-0007).
 */

/** Stable label for the inference rule, surfaced to the UI as `basis`. */
export const TRANSCRIPT_MATCH_BASIS = 'cwd+time-window';

/** Hard cap on returned candidates (most-overlapping first). */
export const TRANSCRIPT_MATCH_MAX_CANDIDATES = 5;

export interface MatchableTranscript {
  id: string;
  outline: string;
  /** Activity window derived from first/last JSONL timestamps. */
  startedAt?: string;
  endedAt?: string;
  /** Working directory recorded in the JSONL stream. */
  cwd?: string;
}

export interface SessionMatchWindow {
  /** Session creation time (required for any overlap reasoning). */
  createdAt?: string;
  /** Last known activity; falls back to createdAt when absent. */
  lastActivity?: string;
}

export interface TranscriptCandidate {
  transcriptId: string;
  outline: string;
  startedAt: string;
  endedAt: string;
  /** Intersection of the two activity windows (evidence for the inference). */
  overlapFrom: string;
  overlapTo: string;
  overlapMs: number;
  cwd: string;
}

export interface TranscriptMatchInput {
  transcripts: MatchableTranscript[];
  sessionWindow: SessionMatchWindow;
  /** Repository root the session belongs to. */
  repoRoot: string;
  /** Optional session worktree path (also a valid cwd match target). */
  worktreePath?: string;
  maxCandidates?: number;
}

/**
 * Normalize a directory path for cross-platform comparison: Windows is
 * case-insensitive and accepts both separators, so lowercase and collapse
 * every separator to `/`, then drop trailing separators and drive-relative
 * quirks. Unix stays case-sensitive only in theory — lowercasing there is
 * harmless because real cwd values from one machine compare consistently.
 */
export function normalizeDirectoryPath(value: string): string {
  const collapsed = value.replace(/[\\/]+/g, '/');
  const trimmed = collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
  return trimmed.toLowerCase();
}

function toEpochMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export interface WindowOverlap {
  fromMs: number;
  toMs: number;
}

/**
 * Inclusive intersection of [aFrom, aTo] and [bFrom, bTo]. A window that
 * merely touches the other at one instant still counts as overlap (duration
 * 0) so a transcript starting exactly at session creation is not dropped.
 */
export function computeWindowOverlap(
  aFromMs: number,
  aToMs: number,
  bFromMs: number,
  bToMs: number,
): WindowOverlap | null {
  const fromMs = Math.max(aFromMs, bFromMs);
  const toMs = Math.min(aToMs, bToMs);
  if (fromMs > toMs) {
    return null;
  }
  return { fromMs, toMs };
}

function cwdMatches(cwd: string, targets: Array<string | undefined>): boolean {
  const normalizedCwd = normalizeDirectoryPath(cwd);
  return targets.some((target) => {
    if (!target) return false;
    return normalizeDirectoryPath(target) === normalizedCwd;
  });
}

/**
 * Pure candidate inference. Returns transcripts whose cwd matches the repo
 * root or the session worktree AND whose [startedAt, endedAt] window overlaps
 * [createdAt, lastActivity], sorted by overlap duration descending (ties by
 * later start first), capped at maxCandidates.
 */
export function matchTranscriptsForSession(input: TranscriptMatchInput): TranscriptCandidate[] {
  const sessionStartMs = input.sessionWindow.createdAt
    ? toEpochMs(input.sessionWindow.createdAt)
    : null;
  if (sessionStartMs === null) {
    return [];
  }

  const lastActivity = input.sessionWindow.lastActivity ?? input.sessionWindow.createdAt!;
  let sessionEndMs = toEpochMs(lastActivity);
  if (sessionEndMs === null || sessionEndMs < sessionStartMs) {
    sessionEndMs = sessionStartMs;
  }

  const candidates: TranscriptCandidate[] = [];

  for (const transcript of input.transcripts) {
    if (!transcript.cwd || !transcript.startedAt || !transcript.endedAt) {
      continue; // no evidence on either axis -> never infer
    }
    if (!cwdMatches(transcript.cwd, [input.repoRoot, input.worktreePath])) {
      continue;
    }

    const startedMs = toEpochMs(transcript.startedAt);
    const endedMs = toEpochMs(transcript.endedAt);
    if (startedMs === null || endedMs === null) {
      continue;
    }
    const transcriptEndMs = Math.max(startedMs, endedMs);

    const overlap = computeWindowOverlap(startedMs, transcriptEndMs, sessionStartMs, sessionEndMs);
    if (!overlap) {
      continue;
    }

    candidates.push({
      transcriptId: transcript.id,
      outline: transcript.outline,
      startedAt: transcript.startedAt,
      endedAt: transcript.endedAt,
      overlapFrom: new Date(overlap.fromMs).toISOString(),
      overlapTo: new Date(overlap.toMs).toISOString(),
      overlapMs: overlap.toMs - overlap.fromMs,
      cwd: transcript.cwd,
    });
  }

  candidates.sort((a, b) => {
    if (b.overlapMs !== a.overlapMs) {
      return b.overlapMs - a.overlapMs;
    }
    // Tie-break: prefer the more recent transcript.
    return b.startedAt.localeCompare(a.startedAt);
  });

  const cap = input.maxCandidates ?? TRANSCRIPT_MATCH_MAX_CANDIDATES;
  return candidates.slice(0, cap);
}
