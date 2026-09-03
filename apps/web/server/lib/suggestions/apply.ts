import fs from 'fs';
import path from 'path';
import { fileHash, resolveRepoFile, sha256Utf8 } from './paths';
import {
  overlayStatus,
  readSuggestionState,
  writeSuggestionRecord,
  type AppliedFileRecord,
} from './store';
import type { ImprovementSuggestion, SuggestionMutationResult, SuggestionOperation } from './types';

function currentHash(absPath: string): string | null {
  return fs.existsSync(absPath) ? fileHash(absPath) : null;
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

  const applied: AppliedFileRecord[] = [];
  for (const operation of card.operations) {
    const result = applyOne(repoRoot, operation);
    if (typeof result === 'string') {
      rollback(repoRoot, applied);
      return { ok: false, code: 'stale', message: result };
    }
    applied.push(result);
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

  // Validate every target before touching any of them, so a stale second file
  // cannot leave the first one already rolled back.
  const planned: { abs: string; previousContents: string | null; path: string }[] = [];
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
  }

  for (const file of planned) {
    if (file.previousContents === null) {
      fs.unlinkSync(file.abs);
      continue;
    }
    fs.mkdirSync(path.dirname(file.abs), { recursive: true });
    fs.writeFileSync(file.abs, file.previousContents);
  }

  const updatedAt = now.toISOString();
  writeSuggestionRecord(repoRoot, card.fingerprint, { status: 'open', updatedAt });
  return { ok: true, suggestion: { ...card, status: 'open', updatedAt } };
}
