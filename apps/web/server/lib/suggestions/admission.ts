import { createRequire } from 'module';
import path from 'path';
import type { WebAdapter } from '../../../../../scripts/lib/web-adapter';
import type { FrictionSignal, HostId, ImprovementSuggestion, SuggestionHomes } from './types';

// Trusted-control evolution contract §5 stage 2 / §6 / §8: the card admission
// boundary. Promotion, the V1–V3 validity invariant, and the durable review
// trail all live in core, reached only through the web-adapter seam (seam
// guard — no deep scripts/lib imports from apps/web/server).
const requireCli = createRequire(import.meta.url);
const adapter = requireCli('../../../../../scripts/lib/web-adapter.js') as WebAdapter;

export type AdmissionOutcome =
  { exposed: true; card: ImprovementSuggestion } | { exposed: false; reason: string };

function homeFor(host: HostId, homes: SuggestionHomes): string | undefined {
  if (host === 'claude') return homes.claudeHome;
  if (host === 'codex') return homes.codexHome;
  return homes.cursorHome;
}

type PathReference = { kind: 'path'; path: string };

// One invariant call per distinct host home: the shared invariant resolves
// evidence references against a single targetRoot, and the owning source of
// an F064 transcript citation is its host home — so a multi-host cluster
// validates each home's citations against that home. A signal whose
// sourceFile is not inside its home keeps its `..`-relative reference and the
// invariant refuses it (escapes-root) — a collector bug surfaces as a
// validity rejection, never as a silently dropped citation.
function evidenceReferenceGroups(
  signals: FrictionSignal[],
  homes: SuggestionHomes,
): { home: string; references: PathReference[] }[] {
  const byHome = new Map<string, PathReference[]>();
  for (const signal of signals) {
    const home = homeFor(signal.host, homes);
    if (!home || !signal.sourceFile) continue;
    const rel = path.relative(home, signal.sourceFile).split(path.sep).join('/');
    if (rel === '') continue;
    const list = byHome.get(home) ?? [];
    const reference = { kind: 'path' as const, path: rel };
    if (!list.some((entry) => entry.path === rel)) list.push(reference);
    byHome.set(home, list);
  }
  return [...byHome.entries()].map(([home, references]) => ({ home, references }));
}

function invariantVerdict(
  repoRoot: string,
  card: ImprovementSuggestion,
  signals: FrictionSignal[],
  homes: SuggestionHomes,
): { ok: true } | { ok: false; code: string; detail: string } {
  const groups = evidenceReferenceGroups(signals, homes);
  if (groups.length === 0) {
    // No citation could be built at all: run the invariant once with no
    // references so the failure carries V1's own closed reason code.
    return adapter.validateEvolutionAdmission({
      targetRoot: repoRoot,
      evidenceReferences: [],
      operations: card.operations,
      expectedEffect: card.expectedEffect,
    });
  }
  for (const group of groups) {
    const verdict = adapter.validateEvolutionAdmission({
      targetRoot: group.home,
      evidenceReferences: group.references,
      operations: card.operations,
      expectedEffect: card.expectedEffect,
    });
    if (!verdict.ok) return verdict;
  }
  return { ok: true };
}

function ledgerFailure(action: string, result: { code: string; errors: string[] }): never {
  throw new Error(
    `suggestion-review ledger refused the ${action} audit write (${result.code}): ${result.errors.join('; ')}`,
  );
}

/**
 * Admit one promoted card (contract §5 stage 2): record the promotion,
 * attach the rejection-history hint, then — for an actionable card — run the
 * shared V1–V3 invariant. A passing card is exposed carrying its hint; a
 * failing card is NOT exposed and its rejection is durable. A card that is
 * already decided (applied/dismissed/snoozed overlay status) is past its
 * admission decision: it is exposed with its hint and the invariant is not
 * re-run — a later validity flip never rewrites a made decision. Every ledger
 * write here is a mandatory governed write (§8.6/E12) — a corrupt, locked, or
 * ceiling-exhausted ledger throws rather than exposing a card without its
 * audit trail.
 */
export function admitSuggestionCard(input: {
  repoRoot: string;
  card: ImprovementSuggestion;
  signals: FrictionSignal[];
  homes: SuggestionHomes;
  actionable: boolean;
}): AdmissionOutcome {
  const { repoRoot, card, signals, homes, actionable } = input;

  // Promotion (§8.2 `proposed`) — durable once per fingerprint, written even
  // for a card that fails admission below: the proposal exists before its
  // validity outcome (§5 stage 2).
  const proposed = adapter.ensureSuggestionProposed(repoRoot, {
    fingerprint: card.fingerprint,
    evidence: card.evidence,
    hosts: card.hosts,
    operations: card.operations,
    attribution: card.findingAttribution ?? {},
  });
  if (!proposed.ok) ledgerFailure('promotion', proposed);

  // Rejection-history hint (§8.3): informative, never blocking; a
  // missing/unreadable/corrupt ledger reports unknown, never "no prior
  // rejection".
  const cardWithHistory: ImprovementSuggestion = {
    ...card,
    rejectionHistory: adapter.suggestionReviewHistory(repoRoot, card.fingerprint),
  };
  if (!actionable) return { exposed: true, card: cardWithHistory };

  const verdict = invariantVerdict(repoRoot, card, signals, homes);
  if (verdict.ok) {
    const validated = adapter.recordSuggestionValidated(repoRoot, {
      fingerprint: card.fingerprint,
    });
    if (!validated.ok) ledgerFailure('validation', validated);
    return { exposed: true, card: cardWithHistory };
  }

  // Validity failure: the rejection is durable (§8.2 `rejected` with the
  // closed `validity:*` reason code and the invariant's non-echoing summary),
  // and the card is not exposed as actionable.
  const rejected = adapter.recordSuggestionValidityRejection(repoRoot, {
    fingerprint: card.fingerprint,
    reason: verdict.code,
    summary: verdict.detail.slice(0, 500),
  });
  if (!rejected.ok) ledgerFailure('validity rejection', rejected);
  return { exposed: false, reason: verdict.code };
}
