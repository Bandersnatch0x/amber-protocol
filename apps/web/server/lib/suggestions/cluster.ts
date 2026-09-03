import { PROMOTION_TRANSCRIPT_THRESHOLD } from './paths';
import type { FrictionSignal, HostId, ImprovementSuggestion, SuggestionOperation } from './types';
import { planFrictionNote } from './planner';

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function clusterSignals(
  signals: FrictionSignal[],
  _repoRoot: string,
  now = new Date(),
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
    const operations: SuggestionOperation[] = planFrictionNote({
      fingerprint,
      tool,
      group,
      transcriptCount: transcriptIds.length,
      hosts,
      now,
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
