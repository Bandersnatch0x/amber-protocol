import { createRequire } from 'module';
import { HOST_FILE_CEILING, PROMOTION_TRANSCRIPT_THRESHOLD } from './paths';
import type { FrictionSignal, HostId, ImprovementSuggestion, SuggestionOperation } from './types';
import {
  deriveExpectedEffect,
  deriveFindingAttribution,
  planFrictionCardOperations,
} from './planner';
import type { WebAdapter } from '../../../../../scripts/lib/web-adapter';

// Trusted-control evolution contract §3: the closed-set validation authority is
// the core module, reached only through the web-adapter seam (seam guard — no
// deep scripts/lib imports from apps/web/server). The bridge is typed by the
// adapter's .d.ts declaration (the typed SSOT), not an ad hoc asserted shape.
const requireCli = createRequire(import.meta.url);
const adapter = requireCli('../../../../../scripts/lib/web-adapter.js') as WebAdapter;

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function clusterSignals(
  signals: FrictionSignal[],
  repoRoot: string,
  now = new Date(),
  transcriptsScanned?: number,
): ImprovementSuggestion[] {
  const groups = new Map<string, FrictionSignal[]>();
  for (const signal of signals) {
    const list = groups.get(signal.fingerprint) ?? [];
    list.push(signal);
    groups.set(signal.fingerprint, list);
  }

  const cards: ImprovementSuggestion[] = [];
  for (const [fingerprint, group] of groups) {
    const transcriptIds = unique(group.map((item) => item.transcriptId));
    if (transcriptIds.length < PROMOTION_TRANSCRIPT_THRESHOLD) continue;

    const hosts = unique(group.map((item) => item.host)).sort() as HostId[];
    const tool = group[0].tool;
    const operations: SuggestionOperation[] = planFrictionCardOperations({
      repoRoot,
      fingerprint,
      tool,
      group,
      transcriptCount: transcriptIds.length,
      hosts,
      now,
    });

    // Structured attribution (evolution contract §3): derived deterministically
    // from the real signal and the planned wiki destination, then validated
    // through the core seam before the card is emitted. An invalid derived
    // block is an explicit error at this boundary — a new card is NEVER
    // silently emitted without its attribution (Debug-First; the derivation
    // uses closed constants, so a validation failure means core/derivation
    // drift and must surface, not downgrade). Attribution is a claim, never a
    // permission: it changes nothing about Apply routing or allowlists.
    const derivedAttribution = deriveFindingAttribution({ tool, group });
    const attributionProblem = adapter.attributionProblem(derivedAttribution);
    if (attributionProblem !== null) {
      throw new Error(
        `findingAttribution: the derived card attribution failed core validation — refusing to emit an unattributed card (${attributionProblem})`,
      );
    }

    // Dual-axis expected effect (evolution contract §6 V3): derived
    // deterministically beside the planned operations; admission validates it
    // through the shared core invariant.
    const expectedEffect = deriveExpectedEffect({ tool, transcriptCount: transcriptIds.length });

    // Recurrence evidence (evolution contract §9, E8): occurrences over the
    // exposure denominator of the SAME declared window — the transcripts this
    // scan actually read, which the caller passes in. A caller that cannot
    // state the denominator leaves it undefined, and the derivation reports
    // `unknown` rather than fabricating a rate. No before/after improvement
    // claim is computed here or anywhere: the numbers are carried, not scored.
    const recurrence = adapter.deriveRecurrence({
      occurrences: group.length,
      transcriptsScanned,
      window: adapter.transcriptWindowLabel(HOST_FILE_CEILING),
    });

    cards.push({
      id: fingerprint.slice(0, 16),
      fingerprint,
      title: `${tool} failed the same way across ${transcriptIds.length} sessions`,
      tool,
      evidenceCount: group.length,
      transcriptCount: transcriptIds.length,
      hosts,
      evidence: group.slice(0, 8).map((item) => ({
        host: item.host,
        transcriptId: item.transcriptId,
        excerpt: item.excerpt,
        timestamp: item.timestamp,
      })),
      operations,
      findingAttribution: derivedAttribution,
      expectedEffect,
      recurrence,
      status: 'open',
    });
  }

  cards.sort((left, right) => {
    if (right.transcriptCount !== left.transcriptCount) {
      return right.transcriptCount - left.transcriptCount;
    }
    return left.fingerprint.localeCompare(right.fingerprint);
  });
  return cards;
}
