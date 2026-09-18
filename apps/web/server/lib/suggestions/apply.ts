import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileHash, resolveRepoFile, sha256Utf8 } from './paths';
import {
  overlayStatus,
  readSuggestionState,
  writeSuggestionRecord,
  type AppliedFileRecord,
} from './store';
import type { ImprovementSuggestion, SuggestionMutationResult, SuggestionOperation } from './types';
import type { WebAdapter } from '../../../../../scripts/lib/web-adapter';

// The §8.6 audit seam — the suggestion-review ledger through the web-adapter
// bridge only (seam guard; no deep scripts/lib imports from apps/web/server).
const requireCli = createRequire(import.meta.url);
const adapter = requireCli('../../../../../scripts/lib/web-adapter.js') as WebAdapter;

function currentHash(absPath: string): string | null {
  return fs.existsSync(absPath) ? fileHash(absPath) : null;
}

// ── Apply: plan (validate without mutating) → commit (all-or-nothing) ──

/**
 * Validate one operation against the current target state WITHOUT mutating
 * anything, projecting the applied record Apply would produce. Returns the
 * same refusal strings as the commit path, so a §8.6 precheck failure and a
 * mid-commit failure read identically.
 */
function planOne(repoRoot: string, operation: SuggestionOperation): AppliedFileRecord | string {
  const abs = resolveRepoFile(repoRoot, operation.path);
  if (!abs) return `Path is not allowlisted: ${operation.path}`;

  const existing = currentHash(abs);
  if (operation.verb === 'create') {
    if (existing !== null) return `Create refused; file already exists: ${operation.path}`;
    if (operation.expectedHash !== null)
      return `Create expectedHash must be empty: ${operation.path}`;
    if (typeof operation.contents !== 'string')
      return `Create is missing contents: ${operation.path}`;
    return {
      path: operation.path,
      beforeHash: null,
      afterHash: sha256Utf8(operation.contents),
      previousContents: null,
    };
  }

  if (operation.verb === 'update') {
    if (existing === null) return `Update refused; file is missing: ${operation.path}`;
    if (existing !== operation.expectedHash)
      return `Update refused; file changed under the card: ${operation.path}`;
    if (typeof operation.contents !== 'string')
      return `Update is missing contents: ${operation.path}`;
    return {
      path: operation.path,
      beforeHash: existing,
      afterHash: sha256Utf8(operation.contents),
      previousContents: null,
    };
  }

  if (existing === null) return `Remove refused; file is missing: ${operation.path}`;
  if (existing !== operation.expectedHash)
    return `Remove refused; file changed under the card: ${operation.path}`;
  return {
    path: operation.path,
    beforeHash: existing,
    // Absent, not "hash of what used to be here" — Undo compares afterHash
    // against the file's current state, and a removed file hashes to null.
    afterHash: null,
    previousContents: null,
  };
}

function applyOne(repoRoot: string, operation: SuggestionOperation): AppliedFileRecord | string {
  const abs = resolveRepoFile(repoRoot, operation.path);
  if (!abs) return `Path is not allowlisted: ${operation.path}`;

  const existing = currentHash(abs);
  if (operation.verb === 'create') {
    if (existing !== null) return `Create refused; file already exists: ${operation.path}`;
    if (operation.expectedHash !== null)
      return `Create expectedHash must be empty: ${operation.path}`;
    if (typeof operation.contents !== 'string')
      return `Create is missing contents: ${operation.path}`;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, operation.contents);
    return {
      path: operation.path,
      beforeHash: null,
      afterHash: sha256Utf8(operation.contents),
      previousContents: null,
    };
  }

  if (operation.verb === 'update') {
    if (existing === null) return `Update refused; file is missing: ${operation.path}`;
    if (existing !== operation.expectedHash)
      return `Update refused; file changed under the card: ${operation.path}`;
    if (typeof operation.contents !== 'string')
      return `Update is missing contents: ${operation.path}`;
    const previousContents = fs.readFileSync(abs, 'utf8');
    fs.writeFileSync(abs, operation.contents);
    return {
      path: operation.path,
      beforeHash: existing,
      afterHash: sha256Utf8(operation.contents),
      previousContents,
    };
  }

  if (existing === null) return `Remove refused; file is missing: ${operation.path}`;
  if (existing !== operation.expectedHash)
    return `Remove refused; file changed under the card: ${operation.path}`;
  const previousContents = fs.readFileSync(abs, 'utf8');
  fs.unlinkSync(abs);
  return {
    path: operation.path,
    beforeHash: existing,
    // Absent, not "hash of what used to be here" — Undo compares afterHash
    // against the file's current state, and a removed file hashes to null.
    afterHash: null,
    previousContents,
  };
}

function rollback(repoRoot: string, applied: AppliedFileRecord[]): void {
  for (const record of [...applied].reverse()) {
    const abs = resolveRepoFile(repoRoot, record.path);
    if (!abs) continue;
    if (record.previousContents === null) {
      try {
        fs.unlinkSync(abs);
      } catch {
        // Best-effort rollback of a create.
      }
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, record.previousContents);
  }
}

// ── §8.6 compensation: byte-restore after an audit-append failure ──

export interface CompensationResult {
  ok: boolean;
  detail: string;
}

/**
 * Compensate a failed Apply audit append: byte-restore every file Apply
 * touched (the existing rollback machinery) and VERIFY the restore — a
 * rollback whose write fails silently (or leaves different bytes) is a
 * degraded state, not a compensation.
 */
export function compensateApply(repoRoot: string, applied: AppliedFileRecord[]): CompensationResult {
  try {
    rollback(repoRoot, applied);
  } catch (err) {
    return { ok: false, detail: `byte-restore threw: ${describeError(err)}` };
  }
  for (const record of applied) {
    const abs = resolveRepoFile(repoRoot, record.path);
    const current = abs ? currentHash(abs) : null;
    if (current !== record.beforeHash) {
      return {
        ok: false,
        detail: `${record.path} did not return to its pre-Apply state`,
      };
    }
  }
  return { ok: true, detail: '' };
}

/** The pre-Undo bytes of every file Undo is about to change. */
export interface PreUndoCapture {
  abs: string;
  path: string;
  bytes: string;
  afterHash: string | null;
}

/**
 * Compensate a failed Undo audit append: write the captured pre-Undo bytes
 * back (re-creating files Undo removed) and verify each file matches what
 * Apply left (afterHash).
 */
export function compensateUndo(preUndo: PreUndoCapture[]): CompensationResult {
  for (const capture of preUndo) {
    try {
      if (capture.afterHash === null) {
        // Apply removed this file, so the exact post-Apply state is absent:
        // remove it again instead of re-creating empty bytes.
        if (fs.existsSync(capture.abs)) fs.unlinkSync(capture.abs);
      } else {
        fs.writeFileSync(capture.abs, capture.bytes);
      }
    } catch (err) {
      return { ok: false, detail: `restoring ${capture.path} threw: ${describeError(err)}` };
    }
  }
  for (const capture of preUndo) {
    if (currentHash(capture.abs) !== capture.afterHash) {
      return { ok: false, detail: `${capture.path} did not return to its post-Apply state` };
    }
  }
  return { ok: true, detail: '' };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// A failed audit append after the target mutation is NEVER success: the
// compensated variant names the rollback, the degraded variant names the
// degraded state and the operator reconciliation step (§8.6 step 3).
function auditWriteFailed(action: string, compensation: CompensationResult, errors: string[]): {
  ok: false;
  code: string;
  message: string;
} {
  if (compensation.ok) {
    return {
      ok: false,
      code: 'audit-write-failed',
      message: `The ${action} was rolled back after its audit event could not be recorded (${errors.join('; ')}); no file, overlay, or review-ledger change remains.`,
    };
  }
  return {
    ok: false,
    code: 'audit-write-failed',
    message:
      `DEGRADED STATE — the ${action} mutated files but its audit event could not be recorded and ` +
      `byte-restore compensation failed (${compensation.detail}; ledger errors: ${errors.join('; ')}). ` +
      `This is never reported as success. Operator reconciliation: inspect the affected files and ` +
      `.amber/suggestions/review.jsonl, restore the files by hand to their pre-${action} state if needed, ` +
      `and re-run the ${action} once the review ledger is writable again.`,
  };
}

// A mid-commit I/O throw after earlier operations succeeded is NEVER
// success: the compensated variant names the rollback, the degraded variant
// names the affected paths and the operator reconciliation step — the same
// never-silent contract as auditWriteFailed above.
function commitIoFailed(
  action: string,
  compensation: CompensationResult,
  err: unknown,
  affectedPaths: string[],
): {
  ok: false;
  code: string;
  message: string;
} {
  if (compensation.ok) {
    return {
      ok: false,
      code: 'commit-io-failed',
      message: `The ${action} failed mid-commit with an I/O error and was rolled back to its pre-${action} state (${describeError(err)}); no file, overlay, or review-ledger change remains.`,
    };
  }
  return {
    ok: false,
    code: 'commit-io-degraded',
    message:
      `DEGRADED STATE — the ${action} mutated files (${affectedPaths.join(', ')}) but mid-commit ` +
      `compensation failed (${compensation.detail}). This is never reported as success. ` +
      `Operator reconciliation: inspect the affected files and ` +
      `.amber/suggestions/review.jsonl, restore the files by hand to their pre-${action} state if needed, ` +
      `and re-run the ${action} once file I/O is working again.`,
  };
}

// The §8.6 precheck refusal: nothing is mutated and the underlying stable
// code rides the result verbatim.
function precheckRefusal(action: string, result: { code: string; errors: string[] }): {
  ok: false;
  code: string;
  message: string;
} {
  return {
    ok: false,
    code: result.code,
    message: `Refused before any change: the ${action} audit event could not be prechecked (${result.errors.join('; ')}).`,
  };
}

export function applySuggestion(
  repoRoot: string,
  card: ImprovementSuggestion,
  now = new Date(),
): SuggestionMutationResult {
  const overlaid = overlayStatus(
    card,
    readSuggestionState(repoRoot).records[card.fingerprint],
    now,
  );
  if (overlaid.status === 'applied') {
    return { ok: false, code: 'already-applied', message: 'This suggestion is already applied.' };
  }
  if (overlaid.status === 'dismissed') {
    return { ok: false, code: 'dismissed', message: 'This suggestion was dismissed.' };
  }

  // §8.6 step 1 — precheck, before any mutation: validate every target
  // (allowlist, content hash), then walk the review ledger chain and probe
  // its appendability with the projected applied record.
  const planned: AppliedFileRecord[] = [];
  for (const operation of card.operations) {
    const projection = planOne(repoRoot, operation);
    if (typeof projection === 'string') {
      return { ok: false, code: 'stale', message: projection };
    }
    planned.push(projection);
  }
  const precheck = adapter.precheckSuggestionReviewAppend(repoRoot, {
    kind: 'applied',
    fingerprint: card.fingerprint,
    applied: planned.map(({ path, beforeHash, afterHash }) => ({ path, beforeHash, afterHash })),
  });
  if (!precheck.ok) return precheckRefusal('Apply', precheck);

  // §8.6 step 2 — commit: the existing all-or-nothing file writes, now
  // fail-closed: an I/O throw mid-commit is compensated exactly like a
  // failed audit append — byte-restore every successful write, verify the
  // restore, and return an explicit failure (never success, never a silent
  // partial state).
  const applied: AppliedFileRecord[] = [];
  let commitError: unknown = null;
  try {
    for (const operation of card.operations) {
      const result = applyOne(repoRoot, operation);
      if (typeof result === 'string') {
        // A stale refusal mid-commit must still restore every operation that
        // already landed. This rollback ride sits inside the loop's fail-closed
        // catch below: if the restore itself throws, the same §8.6 contract
        // applies (compensateApply → commitIoFailed, degraded when
        // compensation fails) — never a loud throw, never a silent partial.
        rollback(repoRoot, applied);
        return { ok: false, code: 'stale', message: result };
      }
      applied.push(result);
    }
  } catch (err) {
    commitError = err;
  }
  if (commitError !== null) {
    return commitIoFailed(
      'Apply',
      compensateApply(repoRoot, applied),
      commitError,
      applied.map((record) => record.path),
    );
  }

  // §8.6 step 2 continued — the mandatory audit append, then the overlay.
  // The overlay's applied status is written only after the audit append
  // succeeds; a failed append triggers byte-restore compensation and the
  // explicit audit-write-failed refusal.
  const audit = adapter.recordSuggestionApplied(repoRoot, {
    fingerprint: card.fingerprint,
    applied: applied.map(({ path, beforeHash, afterHash }) => ({ path, beforeHash, afterHash })),
  });
  if (!audit.ok) {
    return auditWriteFailed('Apply', compensateApply(repoRoot, applied), audit.errors);
  }

  const updatedAt = now.toISOString();
  writeSuggestionRecord(repoRoot, card.fingerprint, {
    status: 'applied',
    updatedAt,
    applied,
  });
  return { ok: true, suggestion: { ...overlaid, status: 'applied', updatedAt } };
}

export function undoSuggestion(
  repoRoot: string,
  card: ImprovementSuggestion,
  now = new Date(),
): SuggestionMutationResult {
  const record = readSuggestionState(repoRoot).records[card.fingerprint];
  if (!record || record.status !== 'applied' || !record.applied) {
    return { ok: false, code: 'not-applied', message: 'Nothing to undo for this suggestion.' };
  }

  // §8.6 step 1 — precheck, before any mutation: validate every target
  // (allowlist, content hash against what Apply left) and capture the
  // pre-Undo bytes the compensation would need, then probe the ledger. The
  // restored-hash projection describes the post-Undo world (the pre-Apply
  // bytes, or file-absent for what Apply created).
  const planned: { abs: string; previousContents: string | null; path: string }[] = [];
  const preUndo: PreUndoCapture[] = [];
  const restoredProjection = record.applied.map((file) => ({
    path: file.path,
    hash:
      file.previousContents === null ? null : sha256Utf8(file.previousContents),
  }));
  for (const file of record.applied) {
    const abs = resolveRepoFile(repoRoot, file.path);
    if (!abs) {
      return {
        ok: false,
        code: 'not-allowlisted',
        message: `Undo path is not allowlisted: ${file.path}`,
      };
    }
    if (currentHash(abs) !== file.afterHash) {
      return {
        ok: false,
        code: 'stale',
        message: `Undo refused; file changed after apply: ${file.path}`,
      };
    }
    planned.push({ abs, previousContents: file.previousContents, path: file.path });
    // A file Apply REMOVED (afterHash null) is absent now, so there are no
    // pre-Undo bytes to read — compensation re-creates it from the applied
    // record's previousContents instead. Reading it here would throw ENOENT
    // before the precheck ever runs.
    preUndo.push({
      abs,
      path: file.path,
      bytes: file.afterHash === null ? '' : fs.readFileSync(abs, 'utf8'),
      afterHash: file.afterHash,
    });
  }
  const precheck = adapter.precheckSuggestionReviewAppend(repoRoot, {
    kind: 'undone',
    fingerprint: card.fingerprint,
    restored: restoredProjection,
  });
  if (!precheck.ok) return precheckRefusal('Undo', precheck);

  // §8.6 step 2 — commit: every target was validated above, so a stale
  // second file cannot leave the first one already rolled back. Fail-closed:
  // an I/O throw mid-commit restores every file to the exact post-Apply
  // state via the captured pre-Undo bytes and returns an explicit failure.
  let undoError: unknown = null;
  try {
    for (const file of planned) {
      if (file.previousContents === null) {
        fs.unlinkSync(file.abs);
        continue;
      }
      fs.mkdirSync(path.dirname(file.abs), { recursive: true });
      fs.writeFileSync(file.abs, file.previousContents);
    }
  } catch (err) {
    undoError = err;
  }
  if (undoError !== null) {
    return commitIoFailed(
      'Undo',
      compensateUndo(preUndo),
      undoError,
      planned.map((file) => file.path),
    );
  }

  // §8.6 step 2 continued — the mandatory audit append, then the overlay.
  const audit = adapter.recordSuggestionUndone(repoRoot, {
    fingerprint: card.fingerprint,
    restored: restoredProjection,
  });
  if (!audit.ok) {
    return auditWriteFailed('Undo', compensateUndo(preUndo), audit.errors);
  }

  const updatedAt = now.toISOString();
  writeSuggestionRecord(repoRoot, card.fingerprint, { status: 'open', updatedAt });
  return { ok: true, suggestion: { ...card, status: 'open', updatedAt } };
}
