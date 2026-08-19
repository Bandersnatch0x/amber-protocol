/**
 * Web integration layer over the Claude Code transcript reader.
 *
 * Resolves the repository being viewed (apps/web -> repo root, matching
 * session-reader) and exposes redaction-on-by-default reads. Redaction is
 * NOT optional here: the web viewer renders transcripts ephemerally and must
 * never surface raw secrets (Session Lens A0).
 */

import {
  listRepoTranscripts,
  readRepoTranscript,
  type TranscriptSummary,
  type TranscriptDetail,
} from './claude-transcript-reader';
import { saveTranscriptDigest, type LensSaveResult } from './lens-store';
import {
  proposeRegressionsFromTranscript,
  type RegressionEvidenceResult,
} from './regression-evidence';
import { resolveRepoRoot } from './repo-root';
import { readSessionById } from './session-reader';
import {
  matchTranscriptsForSession,
  TRANSCRIPT_MATCH_BASIS,
  type TranscriptCandidate,
} from './transcript-session-match';

export interface ServiceOptions {
  repoPath?: string;
  claudeHome?: string;
}

function defaultRepoRoot(): string {
  // Honors AMBER_REPO_ROOT (repo-root.ts) so e2e and hosted setups can pin
  // the repository being viewed; otherwise walks up from the web app.
  return resolveRepoRoot();
}

// Read-path-only override: lets hermetic e2e fixtures point the transcript
// lookup at a seeded Claude home. Mutations below never consult this.
function readClaudeHome(opts: ServiceOptions): string | undefined {
  return opts.claudeHome ?? process.env.AMBER_CLAUDE_HOME;
}

export function listTranscripts(opts: ServiceOptions = {}): TranscriptSummary[] {
  const repoPath = opts.repoPath ?? defaultRepoRoot();
  return listRepoTranscripts(repoPath, { claudeHome: readClaudeHome(opts) });
}

export function readTranscript(
  id: string,
  opts: ServiceOptions & { limit?: number } = {},
): TranscriptDetail | null {
  const repoPath = opts.repoPath ?? defaultRepoRoot();
  // redact is intentionally omitted -> reader defaults to true. No opt-out.
  return readRepoTranscript(repoPath, id, { claudeHome: readClaudeHome(opts), limit: opts.limit });
}

export function saveDigest(id: string, opts: ServiceOptions = {}): LensSaveResult | null {
  const repoRoot = opts.repoPath ?? defaultRepoRoot();
  return saveTranscriptDigest(id, {
    repoPath: repoRoot,
    repoRoot,
    claudeHome: opts.claudeHome,
  });
}

export function proposeRegressions(
  id: string,
  opts: ServiceOptions = {},
): RegressionEvidenceResult {
  const repoRoot = opts.repoPath ?? defaultRepoRoot();
  return proposeRegressionsFromTranscript(id, {
    repoPath: repoRoot,
    repoRoot,
    claudeHome: opts.claudeHome,
  });
}

export interface TranscriptCandidatesResult {
  candidates: TranscriptCandidate[];
  basis: string;
}

// Session manifests disagree on the worktree shape: the CLI schema declares a
// plain string while the web control plane writes { path, active }. Accept
// both without preferring one — the matcher normalizes either form.
function sessionWorktreePath(session: {
  worktree?: { path: string } | null;
  manifest: Record<string, unknown>;
}): string | undefined {
  const raw = session.manifest.worktree;
  if (typeof raw === 'string' && raw) {
    return raw;
  }
  return session.worktree?.path;
}

/**
 * Read-only inference of which Claude transcripts may belong to an Amber
 * session (task #34): cwd match + time-window overlap. Missing manifest,
 * missing transcripts, or missing timestamps degrade to an empty candidate
 * list — never an error — so the caller can fall back to the honest
 * "cannot link automatically" copy.
 */
export function candidatesForSession(
  sessionId: string,
  opts: ServiceOptions = {},
): TranscriptCandidatesResult {
  const empty: TranscriptCandidatesResult = { candidates: [], basis: TRANSCRIPT_MATCH_BASIS };

  const session = readSessionById(sessionId);
  if (!session) {
    return empty;
  }

  const repoRoot = opts.repoPath ?? defaultRepoRoot();
  const summaries = listRepoTranscripts(repoRoot, { claudeHome: readClaudeHome(opts) });
  if (summaries.length === 0) {
    return empty;
  }

  const candidates = matchTranscriptsForSession({
    transcripts: summaries.map((summary) => ({
      id: summary.id,
      outline: summary.outline,
      startedAt: summary.firstTimestamp,
      endedAt: summary.lastTimestamp,
      cwd: summary.cwd,
    })),
    sessionWindow: {
      createdAt: session.createdAt,
      lastActivity: session.updatedAt ?? session.createdAt,
    },
    repoRoot,
    worktreePath: sessionWorktreePath(session),
  });

  return { candidates, basis: TRANSCRIPT_MATCH_BASIS };
}
