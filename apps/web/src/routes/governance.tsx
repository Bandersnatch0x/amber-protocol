import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { CommandCopyBlock } from '@/components/code/CommandCopyBlock';
import { localizeLifecycleCopy } from '@/features/backend-copy/backend-copy';

type UnknownRecord = Record<string, unknown>;

export const Route = createFileRoute('/governance')({
  validateSearch: (search: Record<string, unknown>): { featureId?: string } => ({
    featureId:
      typeof search.featureId === 'string' && search.featureId.trim()
        ? search.featureId.trim()
        : undefined,
  }),
  component: GovernancePage,
});

type GovernanceDecision = 'ready' | 'warn' | 'block' | 'unknown';

const decisionLabelKeys: Record<GovernanceDecision, I18nKey> = {
  ready: 'governance.decision.ready',
  warn: 'governance.decision.warn',
  block: 'governance.decision.block',
  unknown: 'governance.decision',
};

const decisionToneClasses: Record<GovernanceDecision, string> = {
  ready:
    'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
  warn: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
  block:
    'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
  unknown:
    'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300',
};

const severityToneClasses: Record<string, string> = {
  high: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
  medium: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizeDecision(value: unknown): GovernanceDecision {
  const decision = typeof value === 'string' ? value.toLowerCase() : '';
  return decision === 'ready' || decision === 'warn' || decision === 'block' ? decision : 'unknown';
}

function normalizeScores(value: unknown): Array<{ key: string; score: number }> {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter(([, score]) => typeof score === 'number' && Number.isFinite(score))
    .map(([key, score]) => ({ key, score: score as number }));
}

function toStringRows(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((row) => {
      if (typeof row === 'string') return row.trim();
      if (isRecord(row)) return asString(row.message) || asString(row.id) || asString(row.label);
      return '';
    })
    .filter(Boolean);
}

interface FindingView {
  key: string;
  severity: string;
  message: string;
}

function normalizeFindings(value: unknown): FindingView[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.reduce<FindingView[]>((items, row, index) => {
    if (typeof row === 'string') {
      const message = row.trim();
      if (message) items.push({ key: `finding-${index}`, severity: '', message });
      return items;
    }
    if (!isRecord(row)) return items;
    const message = asString(row.message) || asString(row.id);
    if (!message) return items;
    items.push({
      key: `${asString(row.id) || `finding`}-${index}`,
      severity: asString(row.severity).toLowerCase(),
      message,
    });
    return items;
  }, []);
}

interface NextActionView {
  key: string;
  id: string;
  severity: string;
  why: string;
  command: string;
  expectedOutcome: string;
}

function normalizeNextActions(value: unknown): NextActionView[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.reduce<NextActionView[]>((items, row, index) => {
    if (!isRecord(row)) return items;
    const id = asString(row.id) || `action-${index + 1}`;
    const why = asString(row.why) || asString(row.message);
    const command = asString(row.command);
    if (!why && !command) return items;
    items.push({
      key: `${id}-${index}`,
      id,
      severity: asString(row.severity).toLowerCase(),
      why,
      command,
      expectedOutcome: asString(row.expectedOutcome),
    });
    return items;
  }, []);
}

function severityLabelKey(severity: string): I18nKey | null {
  if (severity === 'high') return 'governance.severity.high';
  if (severity === 'medium') return 'governance.severity.medium';
  if (severity === 'low') return 'governance.severity.low';
  return null;
}

// Summary/score buckets arrive as camelCase record keys (featureEvidence,
// readinessFindings, ...) and were rendered raw inside an uppercase .label —
// hence "FEATUREEVIDENCE". Map known keys to localized, human-readable
// labels; unknown keys still get a readable camelCase split.
const METRIC_LABEL_KEYS: Record<string, I18nKey> = {
  features: 'governance.summaryKey.features',
  featureEvidence: 'governance.summaryKey.featureEvidence',
  readinessFindings: 'governance.summaryKey.readinessFindings',
  staleDocs: 'governance.summaryKey.staleDocs',
  maintenanceErrors: 'governance.summaryKey.maintenanceErrors',
  overall: 'governance.summaryKey.overall',
  governance: 'governance.summaryKey.governance',
  evidence: 'governance.summaryKey.evidence',
  continuity: 'governance.summaryKey.continuity',
  safety: 'governance.summaryKey.safety',
  maintenance: 'governance.summaryKey.maintenance',
};

function humanizeMetricKey(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

// Known backend-authored prose (governance-readiness ACTION_LIBRARY
// why/expectedOutcome and fixed finding messages) mapped to i18n keys.
// Anything unknown degrades to monospaced original text rather than being
// machine-mangled.
const BACKEND_STRING_KEYS: Record<string, I18nKey> = {
  'Governance policy errors make the repository unsafe to route through governed workflows.':
    'governance.backend.policyError.why',
  'Policy errors are fixed or recorded as explicit owner-approved exceptions.':
    'governance.backend.policyError.outcome',
  'A leftover policy claiming user-approval=approve contradicts the removed autonomous executor and confuses operators.':
    'governance.backend.unsafeUserApproval.why',
  'Leftover policy is fixed, removed, or documented as non-executing config only.':
    'governance.backend.unsafeUserApproval.outcome',
  'Policy warnings reduce trust in governed automation boundaries.':
    'governance.backend.policyWarning.why',
  'Warnings are resolved or consciously accepted.': 'governance.backend.policyWarning.outcome',
  'Invalid routes cannot be used as repeatable delivery workflows.':
    'governance.backend.routeError.why',
  'Route definitions validate cleanly.': 'governance.backend.routeError.outcome',
  'Unreadable workflow packs cannot provide trustworthy execution constraints.':
    'governance.backend.workflowPackReadError.why',
  'Workflow pack JSON can be parsed and inspected.':
    'governance.backend.workflowPackReadError.outcome',
  'Missing governance documents leave policy, boundary, or audit context invisible.':
    'governance.backend.missingGovernanceDoc.why',
  'Required governance documents exist under .amber/governance.':
    'governance.backend.missingGovernanceDoc.outcome',
  'Routes without gates do not enforce review or approval checkpoints.':
    'governance.backend.routeWithoutGates.why',
  'Routes include gates around planning, implementation, review, or merge stages.':
    'governance.backend.routeWithoutGates.outcome',
  'Loop contracts without review gates cannot prove independent review.':
    'governance.backend.packMissingReviewGates.why',
  'Each loop contract defines review gates.': 'governance.backend.packMissingReviewGates.outcome',
  'Mutating loops need worktree isolation to avoid accidental main checkout changes.':
    'governance.backend.packMissingWorktreeIsolation.why',
  'Mutating loop contracts require isolated worktrees and forbid main checkout mutation.':
    'governance.backend.packMissingWorktreeIsolation.outcome',
  'Security pack claims need an auditable standard to map controls and gaps.':
    'governance.backend.missingSecurityStandard.why',
  'Creates standards/security-governance.json (declarative security-governance standard), clearing this finding. Re-run `governance standards` to map coverage.':
    'governance.backend.missingSecurityStandard.outcome',
  'Security-named workflow packs should link to the security governance standard.':
    'governance.backend.securityPackNotLinked.why',
  'Security workflow packs reference security-governance.':
    'governance.backend.securityPackNotLinked.outcome',
  'A complete product loop needs verification evidence before handoff is trustworthy.':
    'governance.backend.noAuditEvidence.why',
  'A governed session or execution records verification evidence that can be exported.':
    'governance.backend.noAuditEvidence.outcome',
  'Built-in defaults are safe, but a repository-local policy is easier to inspect and hand off.':
    'governance.backend.missingGovernanceRules.why',
  '.amber/governance/rules.json exists with defaultAction=deny.':
    'governance.backend.missingGovernanceRules.outcome',
  'defaultAction=allow permits unlisted commands and breaks deny-by-default governance.':
    'governance.backend.unsafeDefaultAllow.why',
  'rules.json uses defaultAction=deny and deny-wins command policy.':
    'governance.backend.unsafeDefaultAllow.outcome',
  'A tampered ledger means evidence continuity cannot be trusted.':
    'governance.backend.ledgerTampered.why',
  'Tampered ledger records are investigated and restored from version control if appropriate.':
    'governance.backend.ledgerTampered.outcome',
  'No session or execution evidence found for audit review.':
    'governance.backend.finding.noAuditEvidence',
  'No .amber/governance/rules.json found; governed execution will use built-in defaults.':
    'governance.backend.finding.missingGovernanceRules',
  'rules.json defaultAction=allow is unsafe \u2014 unlisted commands would be permitted.':
    'governance.backend.finding.unsafeDefaultAllow',
  'Security governance standard is missing: standards/security-governance.json':
    'governance.backend.finding.missingSecurityStandard',
};

function BackendText({ value }: { value: string }) {
  const { t } = useI18n();
  const key = BACKEND_STRING_KEYS[value];
  if (key) return <>{t(key)}</>;
  // Lifecycle next-action prose (why + "Lifecycle advances past: ...") is
  // mapped through the shared backend-copy layer; unknown strings still
  // degrade to their mono original text below.
  const localized = localizeLifecycleCopy(value, t);
  if (localized !== value.trim()) return <>{localized}</>;
  return <span className="font-mono">{value}</span>;
}

// Plain-language scoring explanations for the five readiness scores plus the
// weighted overall score; the copy follows the real penalty model in
// scripts/lib/core/governance-report.js (scoreSections). Unknown score keys
// render without a subtitle instead of guessing.
const SCORE_EXPLAIN_KEYS: Record<string, I18nKey> = {
  governance: 'ux.governance.score.governance',
  evidence: 'ux.governance.score.evidence',
  continuity: 'ux.governance.score.continuity',
  safety: 'ux.governance.score.safety',
  maintenance: 'ux.governance.score.maintenance',
  overall: 'ux.governance.score.overall',
};

function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useI18n();
  const labelKey = severityLabelKey(severity);
  if (!labelKey && !severity) return null;
  const tone = severityToneClasses[severity] ?? severityToneClasses.low;
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>
      {labelKey ? t(labelKey) : severity}
    </span>
  );
}

/**
 * Read-only governance overview (ADR-0007): renders continuity.governance.summary
 * on demand with a manual refresh — it never polls and never mutates.
 */
function GovernancePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { featureId } = Route.useSearch();

  const summaryQuery = trpc.continuity.governance.summary.useQuery(
    featureId ? { featureId } : {},
    // Governance reports are expensive and only meaningful on demand: opt this
    // fold out of the global auto-refresh interval entirely.
    { refetchInterval: false },
  );

  // Feature candidates come from read-only lifecycle/governance folds only
  // (ADR-0007): the lifecycle focus when it is a feature, plus whatever the
  // current report already resolved. No dedicated listing endpoint exists.
  const lifecycleQuery = trpc.lifecycle.next.useQuery({}, { refetchInterval: false });

  const data = summaryQuery.data;
  const decision = normalizeDecision(isRecord(data) ? data.decision : null);
  const scores = normalizeScores(isRecord(data) ? data.scores : null);
  const findings = normalizeFindings(isRecord(data) ? data.findings : null);
  const nextActions = normalizeNextActions(isRecord(data) ? data.nextActions : null);
  const errors = toStringRows(isRecord(data) ? data.errors : null);
  const warnings = toStringRows(isRecord(data) ? data.warnings : null);
  const learnings = isRecord(data) && isRecord(data.learnings) ? data.learnings : null;
  // The report's summary is a Record<string, number> of headline counts, not a
  // prose string — normalize it like scores so the block actually renders.
  const summaryCounts = normalizeScores(isRecord(data) ? data.summary : null);
  const target = isRecord(data) ? asString(data.target) : '';
  const generatedAt = isRecord(data) ? asString(data.generatedAt) : '';

  const featureCandidates = useMemo(() => {
    const candidates: string[] = [];
    const push = (value: unknown) => {
      if (typeof value === 'string' && value.trim() && !candidates.includes(value.trim())) {
        candidates.push(value.trim());
      }
    };
    const lifecycleData = lifecycleQuery.data;
    const focus = isRecord(lifecycleData) ? lifecycleData.focus : null;
    if (isRecord(focus) && focus.type === 'feature') push(focus.id);
    push(featureId);
    if (learnings) push(learnings.featureId);
    return candidates;
  }, [lifecycleQuery.data, featureId, learnings]);

  const metricLabel = (key: string) => {
    const labelKey = METRIC_LABEL_KEYS[key];
    return labelKey ? t(labelKey) : humanizeMetricKey(key);
  };

  const learningsFeatureTarget =
    (learnings && typeof learnings.featureId === 'string' && learnings.featureId) ||
    featureId ||
    '<feature-id>';

  return (
    <div className="page-container max-w-4xl space-y-6">
      <header className="space-y-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('governance.backHome')}
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">
              {t('governance.title')}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
              {t('governance.description')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('governance.refreshAria')}
            onClick={() => void summaryQuery.refetch()}
            disabled={summaryQuery.isFetching}
            className="btn-secondary text-sm"
          >
            {summaryQuery.isFetching ? t('governance.refreshing') : t('governance.refresh')}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="governance-feature-selector" className="label">
            {t('governance.featureSelector.label')}
          </label>
          {featureCandidates.length > 0 ? (
            <select
              id="governance-feature-selector"
              aria-label={t('governance.featureSelector.aria')}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              value={featureId ?? ''}
              onChange={(event) => {
                const next = event.target.value;
                void navigate({ to: '/governance', search: next ? { featureId: next } : {} });
              }}
            >
              <option value="">{t('governance.featureSelector.all')}</option>
              {featureCandidates.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('governance.featureSelector.empty')}
            </p>
          )}
        </div>
      </header>

      {summaryQuery.isLoading && (
        <section aria-busy="true" className="space-y-6">
          <span className="sr-only">{t('governance.loading')}</span>
          <div className="card space-y-4 p-5">
            <div className="h-5 w-40 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-3 w-64 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            <div className="grid gap-3 sm:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="h-16 animate-pulse rounded-md bg-slate-200 dark:bg-slate-700"
                />
              ))}
            </div>
          </div>
          <div className="card space-y-3 p-5">
            <div className="h-4 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-3 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="card space-y-3 p-5">
            <div className="h-4 w-32 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-3 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          </div>
        </section>
      )}

      {summaryQuery.error && (
        <section className="card border-red-200 p-5 dark:border-red-900/60">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            {t('governance.failed')}
          </p>
          <p className="mt-1 break-words text-xs text-red-700 dark:text-red-300">
            {summaryQuery.error.message}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void summaryQuery.refetch()}
              disabled={summaryQuery.isFetching}
              className="btn-secondary text-sm"
            >
              {t('common.retry')}
            </button>
            <Link to="/" className="btn-secondary text-sm">
              {t('error.backHome')}
            </Link>
          </div>
        </section>
      )}

      {!summaryQuery.isLoading && !summaryQuery.error && data && (
        <>
          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="section-title">{t('governance.decision')}</h2>
                {target && (
                  <p className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">
                    {t('governance.target')}: {target}
                  </p>
                )}
                {generatedAt && (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {t('governance.generatedAt')}: {generatedAt}
                  </p>
                )}
                {featureId && (
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {t('governance.featureId')}: {featureId}
                  </p>
                )}
              </div>
              <span
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${decisionToneClasses[decision]}`}
              >
                {t(decisionLabelKeys[decision])}
              </span>
            </div>

            {summaryCounts.length > 0 && (
              <div className="mt-4">
                <h3 className="label">{t('governance.summary')}</h3>
                <dl className="mt-2 grid gap-3 sm:grid-cols-3">
                  {summaryCounts.map(({ key, score }) => (
                    <div
                      key={key}
                      className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
                    >
                      <dt className="label">{metricLabel(key)}</dt>
                      <dd className="value">{score}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {scores.length > 0 && (
              <div className="mt-4">
                <h3 className="label">{t('governance.scores')}</h3>
                <dl className="mt-2 grid gap-3 sm:grid-cols-3">
                  {scores.map(({ key, score }) => {
                    const explainKey = SCORE_EXPLAIN_KEYS[key];
                    return (
                      <div
                        key={key}
                        className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
                      >
                        <dt className="label">{metricLabel(key)}</dt>
                        <dd className="value">{score}</dd>
                        {explainKey && (
                          <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {t(explainKey)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </dl>
              </div>
            )}
          </section>

          {errors.length > 0 && (
            <section className="card border-red-200 p-5 dark:border-red-900/60">
              <h2 className="section-title text-red-800 dark:text-red-200">
                {t('governance.errors')}
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700 dark:text-red-300">
                {errors.map((row) => (
                  <li key={row} className="break-words">
                    {row}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {warnings.length > 0 && (
            <section className="card border-amber-200 p-5 dark:border-amber-900/60">
              <h2 className="section-title text-amber-900 dark:text-amber-200">
                {t('governance.warnings')}
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-300">
                {warnings.map((row) => (
                  <li key={row} className="break-words">
                    {row}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card p-5">
            <h2 className="section-title">{t('governance.findings')}</h2>
            {findings.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {findings.map((finding) => (
                  <li
                    key={finding.key}
                    className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700"
                  >
                    <SeverityBadge severity={finding.severity} />
                    <span className="min-w-0 break-words text-sm text-slate-700 dark:text-slate-300">
                      <BackendText value={finding.message} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t('governance.noFindings')}
              </p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="section-title">{t('governance.nextActions')}</h2>
            {nextActions.length > 0 ? (
              <ul className="mt-3 space-y-3">
                {nextActions.map((action) => (
                  <li
                    key={action.key}
                    className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-mono text-sm font-medium text-slate-900 dark:text-white">
                        {action.id}
                      </span>
                      <SeverityBadge severity={action.severity} />
                    </div>
                    {action.why && (
                      <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                        <BackendText value={action.why} />
                      </p>
                    )}
                    {action.expectedOutcome && (
                      <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                        <BackendText value={action.expectedOutcome} />
                      </p>
                    )}
                    {action.command && (
                      <CommandCopyBlock command={action.command} className="mt-2" />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t('governance.noNextActions')}
              </p>
            )}
          </section>

          <section className="card p-5">
            <h2 className="section-title">{t('governance.learnings')}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {t('ux.terms.learnings')}
            </p>
            {learnings ? (
              <div className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-300">
                <p>
                  {learnings.status === 'unavailable'
                    ? t('governance.learnings.unavailable')
                    : learnings.hasTriggers === true
                      ? t('governance.learnings.triggers')
                      : t('governance.learnings.noTriggers')}
                  {' · '}
                  {learnings.reviewBooked === true
                    ? t('governance.learnings.reviewBooked')
                    : t('governance.learnings.reviewPending')}
                </p>
                {Array.isArray(learnings.matchedCategories) &&
                  learnings.matchedCategories.length > 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t('governance.learnings.categories')}:{' '}
                      {learnings.matchedCategories
                        .filter((row): row is string => typeof row === 'string')
                        .join(', ')}
                    </p>
                  )}
                {typeof learnings.featureId === 'string' && learnings.featureId && (
                  <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                    {t('governance.featureId')}: {learnings.featureId}
                  </p>
                )}
                {learnings.status !== 'unavailable' && learnings.reviewBooked !== true && (
                  <CommandCopyBlock
                    className="mt-3"
                    hint={t('governance.learnings.reviewHint')}
                    command={`amber learnings --reviewed --feature ${learningsFeatureTarget} --target .`}
                  />
                )}
              </div>
            ) : (
              <p className="mt-3 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t('governance.learnings.unavailable')}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
