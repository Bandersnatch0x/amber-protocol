import { applySuggestion, undoSuggestion } from './apply';
import { admitSuggestionCard } from './admission';
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
  FrictionSignal,
  ImprovementSuggestion,
  SuggestionHomes,
  SuggestionListResult,
  SuggestionMutationResult,
} from './types';
import type { WebAdapter } from '../../../../../scripts/lib/web-adapter';
import { createRequire } from 'module';

// The §8.6 precheck and dismissal audit seam — core ledger ops through the
// web-adapter bridge only (seam guard).
const requireCli = createRequire(import.meta.url);
const adapter = requireCli('../../../../../scripts/lib/web-adapter.js') as WebAdapter;

// The operator Dismiss review record (§8.2 `rejected`): the current Dismiss
// action carries no free-text reason, so the reason is the fixed operator
// marker; the summary is fixed text — redacted by construction.
const DISMISS_REASON = 'dismissed-by-operator';
const DISMISS_SUMMARY = 'Operator dismissed the suggestion card from the review surface.';

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
  const { signals, scanned, transcriptsScanned } = collectHostSignals(opts.repoRoot, homes);
  const state = readSuggestionState(opts.repoRoot);

  // The cluster's own signals, keyed by fingerprint, so admission can build
  // per-home transcript citations for the V1 evidence references.
  const signalsByFingerprint = new Map<string, FrictionSignal[]>();
  for (const signal of signals) {
    const list = signalsByFingerprint.get(signal.fingerprint) ?? [];
    list.push(signal);
    signalsByFingerprint.set(signal.fingerprint, list);
  }

  const suggestions: ImprovementSuggestion[] = [];
  for (const card of clusterSignals(signals, opts.repoRoot, now, transcriptsScanned)) {
    const overlaid = overlayStatus(card, state.records[card.fingerprint], now);
    // Promotion and the rejection-history hint run for every promoted card;
    // the V1–V3 admission gate applies to ACTIONABLE (open) cards only —
    // applied, dismissed, and snoozed cards are past their admission
    // decision, and an invalid card is never exposed as actionable.
    const admitted = admitSuggestionCard({
      repoRoot: opts.repoRoot,
      card,
      signals: signalsByFingerprint.get(card.fingerprint) ?? [],
      homes,
      actionable: overlaid.status === 'open',
    });
    if (admitted.exposed) {
      suggestions.push(overlayStatus(admitted.card, state.records[card.fingerprint], now));
    }
    // Not exposed: the open card failed admission and its rejection is
    // already durable in the review ledger.
  }
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

// The §8.6 refusal for a ledger that cannot carry the audit event: nothing is
// mutated and the underlying stable code rides the result verbatim.
function ledgerRefusal(
  action: string,
  result: { code: string; errors: string[] },
): {
  ok: false;
  code: string;
  message: string;
} {
  return {
    ok: false,
    code: result.code,
    message: `Refused before any change: the ${action} could not be recorded durably (${result.errors.join('; ')}).`,
  };
}

export function dismissSuggestion(
  id: string,
  opts: SuggestionServiceOptions,
): SuggestionMutationResult {
  return mutate(id, opts, (card, now) => {
    // §8.6 ordering for Dismiss: the overlay write IS the target mutation, so
    // the precheck runs first and the audit event precedes the overlay — a
    // dismissed status can never appear without its `rejected` event.
    const precheck = adapter.precheckSuggestionReviewAppend(opts.repoRoot, {
      kind: 'rejected',
      fingerprint: card.fingerprint,
      reason: DISMISS_REASON,
      summary: DISMISS_SUMMARY,
    });
    if (!precheck.ok) return ledgerRefusal('dismissal audit', precheck);

    const audit = adapter.recordSuggestionDismissal(opts.repoRoot, {
      fingerprint: card.fingerprint,
      reason: DISMISS_REASON,
      summary: DISMISS_SUMMARY,
    });
    if (!audit.ok) return ledgerRefusal('dismissal audit', audit);

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
    // Snooze stays overlay-only (§8.1): a wall-clock projection, not a review
    // decision — no ledger event, no precheck.
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
