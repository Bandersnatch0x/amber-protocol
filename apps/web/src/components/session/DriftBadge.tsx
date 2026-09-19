import { useI18n } from '@/lib/i18n';

// Trusted-control governance contract §9.4 — the read-only drift badge. The
// four-state fold is computed server-side (replayPolicyDecisions / the drift
// fold) and rendered here as a semantic chip: EXACT → emerald (state matches),
// COMPATIBLE → blue (version-domain compatible), DRIFTED → amber (a testable
// dimension differs — attention), NON_REPLAYABLE → slate (dependencies
// missing — never an error claim). Read-only by contract: no interactive
// replay control may exist on this surface (the Governance Console is not an
// execution surface); the R1 report link is a navigation, never a trigger.

export type DriftState = 'EXACT' | 'COMPATIBLE' | 'DRIFTED' | 'NON_REPLAYABLE';

interface DriftBadgeProps {
  state: DriftState | null;
  /** Optional R1 report link target (a read-only report route or file). */
  reportHref?: string | null;
}

const driftConfig: Record<DriftState, { className: string; labelKey: Parameters<ReturnType<typeof useI18n>['t']>[0] }> = {
  EXACT: {
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    labelKey: 'sessions.drift.exact',
  },
  COMPATIBLE: {
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    labelKey: 'sessions.drift.compatible',
  },
  DRIFTED: {
    className: 'bg-amber-50 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
    labelKey: 'sessions.drift.drifted',
  },
  NON_REPLAYABLE: {
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
    labelKey: 'sessions.drift.nonReplayable',
  },
};

export function DriftBadge({ state, reportHref }: DriftBadgeProps) {
  const { t } = useI18n();
  if (!state) {
    return null;
  }
  const config = driftConfig[state];
  const badge = (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md ${config.className}`}
      data-drift-state={state}
    >
      {t(config.labelKey)}
    </span>
  );
  if (reportHref) {
    return (
      <a href={reportHref} className="hover:opacity-80" data-testid="drift-report-link">
        {badge}
      </a>
    );
  }
  return badge;
}
