import { applySuggestion, undoSuggestion } from './apply';
import { clusterSignals } from './cluster';
import { collectHostSignals } from './hosts';
import { defaultHomes } from './paths';
import {
  overlayStatus,
  readSuggestionState,
  snoozeUntilFrom,
  writeSuggestionRecord,
} from './store';
import type {
  ImprovementSuggestion,
  SuggestionHomes,
  SuggestionListResult,
  SuggestionMutationResult,
} from './types';

export interface SuggestionServiceOptions {
  repoRoot: string;
  homes?: SuggestionHomes;
  now?: Date;
}

function homesFor(opts: SuggestionServiceOptions): SuggestionHomes {
  return { ...defaultHomes(), ...opts.homes };
}

export function listSuggestions(opts: SuggestionServiceOptions): SuggestionListResult {
  const now = opts.now ?? new Date();
  const homes = homesFor(opts);
  const { signals, scanned } = collectHostSignals(opts.repoRoot, homes);
  const state = readSuggestionState(opts.repoRoot);
  const suggestions = clusterSignals(signals, opts.repoRoot, now).map((card) =>
    overlayStatus(card, state.records[card.fingerprint], now),
  );
  return { suggestions, scanned };
}

export function readSuggestion(
  id: string,
  opts: SuggestionServiceOptions,
): ImprovementSuggestion | null {
  return listSuggestions(opts).suggestions.find((card) => card.id === id) ?? null;
}

function mutate(
  id: string,
  opts: SuggestionServiceOptions,
  run: (card: ImprovementSuggestion, now: Date) => SuggestionMutationResult,
): SuggestionMutationResult {
  const now = opts.now ?? new Date();
  const card = readSuggestion(id, { ...opts, now });
  if (!card) {
    return { ok: false, code: 'not-found', message: 'Suggestion not found.' };
  }
  return run(card, now);
}

export function dismissSuggestion(
  id: string,
  opts: SuggestionServiceOptions,
): SuggestionMutationResult {
  return mutate(id, opts, (card, now) => {
    const updatedAt = now.toISOString();
    writeSuggestionRecord(opts.repoRoot, card.fingerprint, { status: 'dismissed', updatedAt });
    return { ok: true, suggestion: { ...card, status: 'dismissed', updatedAt } };
  });
}

export function snoozeSuggestion(
  id: string,
  opts: SuggestionServiceOptions,
): SuggestionMutationResult {
  return mutate(id, opts, (card, now) => {
    const updatedAt = now.toISOString();
    const snoozeUntil = snoozeUntilFrom(now);
    writeSuggestionRecord(opts.repoRoot, card.fingerprint, {
      status: 'snoozed',
      updatedAt,
      snoozeUntil,
    });
    return { ok: true, suggestion: { ...card, status: 'snoozed', updatedAt, snoozeUntil } };
  });
}

export function applySuggestionById(
  id: string,
  opts: SuggestionServiceOptions,
): SuggestionMutationResult {
  return mutate(id, opts, (card, now) => applySuggestion(opts.repoRoot, card, now));
}

export function undoSuggestionById(
  id: string,
  opts: SuggestionServiceOptions,
): SuggestionMutationResult {
  return mutate(id, opts, (card, now) => undoSuggestion(opts.repoRoot, card, now));
}
