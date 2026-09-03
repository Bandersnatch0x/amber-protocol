import fs from 'fs';
import path from 'path';
import { AMBER_STATE_DIR } from '../state-dir';
import { SNOOZE_MS } from './paths';
import type { ImprovementSuggestion, SuggestionStatus } from './types';

export interface AppliedFileRecord {
  path: string;
  beforeHash: string | null;
  /** Hash of what Apply left on disk; null when Apply removed the file. */
  afterHash: string | null;
  previousContents: string | null;
}

export interface SuggestionRecord {
  status: SuggestionStatus;
  updatedAt: string;
  snoozeUntil?: string;
  applied?: AppliedFileRecord[];
}

interface SuggestionState {
  schemaVersion: 1;
  records: Record<string, SuggestionRecord>;
}

function stateDir(repoRoot: string): string {
  return path.join(repoRoot, AMBER_STATE_DIR, 'suggestions');
}

function statePath(repoRoot: string): string {
  return path.join(stateDir(repoRoot), 'state.json');
}

function emptyState(): SuggestionState {
  return { schemaVersion: 1, records: {} };
}

function ensureDir(repoRoot: string): string {
  const dir = stateDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '# Amber Improvement Suggestions overlay — never commit.\n*\n');
  }
  return dir;
}

export function readSuggestionState(repoRoot: string): SuggestionState {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(repoRoot), 'utf8')) as SuggestionState;
    if (!raw || raw.schemaVersion !== 1 || typeof raw.records !== 'object' || !raw.records) {
      return emptyState();
    }
    return raw;
  } catch {
    return emptyState();
  }
}

export function writeSuggestionRecord(
  repoRoot: string,
  fingerprint: string,
  record: SuggestionRecord,
): void {
  ensureDir(repoRoot);
  const state = readSuggestionState(repoRoot);
  state.records[fingerprint] = record;
  fs.writeFileSync(statePath(repoRoot), `${JSON.stringify(state, null, 2)}\n`);
}

export function overlayStatus(
  card: ImprovementSuggestion,
  record: SuggestionRecord | undefined,
  now: Date,
): ImprovementSuggestion {
  if (!record) return card;
  if (
    record.status === 'snoozed' &&
    record.snoozeUntil &&
    Date.parse(record.snoozeUntil) <= now.getTime()
  ) {
    return { ...card, status: 'open', updatedAt: record.updatedAt };
  }
  return {
    ...card,
    status: record.status,
    snoozeUntil: record.snoozeUntil,
    updatedAt: record.updatedAt,
  };
}

export function snoozeUntilFrom(now: Date): string {
  return new Date(now.getTime() + SNOOZE_MS).toISOString();
}
