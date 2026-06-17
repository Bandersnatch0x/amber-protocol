/**
 * Web integration layer over the Claude Code transcript reader.
 *
 * Resolves the repository being viewed (apps/web -> repo root, matching
 * session-reader) and exposes redaction-on-by-default reads. Redaction is
 * NOT optional here: the web viewer renders transcripts ephemerally and must
 * never surface raw secrets (Session Lens A0).
 */

import path from 'path';
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

export interface ServiceOptions {
  repoPath?: string;
  claudeHome?: string;
}

function defaultRepoRoot(): string {
  // From apps/web, the repository root is two levels up.
  return path.resolve(process.cwd(), '..', '..');
}

export function listTranscripts(opts: ServiceOptions = {}): TranscriptSummary[] {
  const repoPath = opts.repoPath ?? defaultRepoRoot();
  return listRepoTranscripts(repoPath, { claudeHome: opts.claudeHome });
}

export function readTranscript(
  id: string,
  opts: ServiceOptions & { limit?: number } = {},
): TranscriptDetail | null {
  const repoPath = opts.repoPath ?? defaultRepoRoot();
  // redact is intentionally omitted -> reader defaults to true. No opt-out.
  return readRepoTranscript(repoPath, id, { claudeHome: opts.claudeHome, limit: opts.limit });
}

export function saveDigest(id: string, opts: ServiceOptions = {}): LensSaveResult | null {
  const repoRoot = opts.repoPath ?? defaultRepoRoot();
  return saveTranscriptDigest(id, {
    repoPath: repoRoot,
    repoRoot,
    claudeHome: opts.claudeHome,
  });
}

export function proposeRegressions(id: string, opts: ServiceOptions = {}): RegressionEvidenceResult {
  const repoRoot = opts.repoPath ?? defaultRepoRoot();
  return proposeRegressionsFromTranscript(id, {
    repoPath: repoRoot,
    repoRoot,
    claudeHome: opts.claudeHome,
  });
}
