import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AmberField } from '@/components/experience/AmberField';
import { StatusBadge } from '@/components/session/StatusBadge';
import { isActiveStatus } from '@/features/sessions/sessions-view-model';
import { trpc } from '@/lib/trpc';
import { useI18n, type I18nKey } from '@/lib/i18n';
import '../experience.css';

export const Route = createFileRoute('/')({ component: HomePage });

const primarySurfaces = [
  { labelKey: 'nav.sessions', detailKey: 'home.surface.sessions.detail', to: '/sessions' },
  { labelKey: 'nav.gates', detailKey: 'home.surface.gates.detail', to: '/gates' },
] as const;

const secondarySurfaces = [
  { labelKey: 'nav.routes', detailKey: 'home.surface.routes.detail', to: '/routes' },
  { labelKey: 'nav.transcripts', detailKey: 'home.surface.transcripts.detail', to: '/transcripts' },
  { labelKey: 'nav.settings', detailKey: 'home.surface.settings.detail', to: '/settings' },
] as const;

const lifecycle = [
  { stageKey: 'home.lifecycle.audit.stage', detailKey: 'home.lifecycle.audit.detail' },
  { stageKey: 'home.lifecycle.init.stage', detailKey: 'home.lifecycle.init.detail' },
  { stageKey: 'home.lifecycle.plan.stage', detailKey: 'home.lifecycle.plan.detail' },
  { stageKey: 'home.lifecycle.gate.stage', detailKey: 'home.lifecycle.gate.detail' },
  { stageKey: 'home.lifecycle.verify.stage', detailKey: 'home.lifecycle.verify.detail' },
  { stageKey: 'home.lifecycle.handoff.stage', detailKey: 'home.lifecycle.handoff.detail' },
] as const;

const artifacts = [
  'AGENTS.md',
  'feature_list.json',
  'PROGRESS.md',
  'session-handoff.md',
  'docs/wiki/',
  '.workflow/continuous-improvement/state.json',
] as const;

/** Lifecycle step ids emitted by scripts/lib/core/lifecycle.js (STEPS). */
const LIFECYCLE_STEP_IDS = [
  'audit',
  'init',
  'feature',
  'plan',
  'gate',
  'feature-evidence',
  'verify',
  'approve',
  'handoff',
  'complete-check',
  'session-complete',
  'accept',
  'learnings',
] as const;

type LifecycleStepId = (typeof LIFECYCLE_STEP_IDS)[number];

function knownLifecycleStep(stepId: string): LifecycleStepId | null {
  return (LIFECYCLE_STEP_IDS as readonly string[]).includes(stepId)
    ? (stepId as LifecycleStepId)
    : null;
}

function formatRefresh(value: number, fallback: string): string {
  if (!value) return fallback;
  return new Date(value).toLocaleString();
}

function formatTime(value: string | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

/** Map live operator pressure to the lifecycle diagram stage index. */
function deriveLoopStage(activeSessionCount: number, pendingGateCount: number): number {
  if (pendingGateCount > 0) return 3;
  if (activeSessionCount > 0) return 2;
  return 0;
}

interface NextActionView {
  focusLabel: string;
  sessionId: string | null;
  stepId: string;
  nextStep: string;
  reason: string;
  remedy: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function sessionIdFromFocus(value: unknown): string | null {
  if (typeof value === 'string') {
    if (/^session[-_.A-Za-z0-9]+$/i.test(value.trim())) return value.trim();
    const match = value.match(/session[:/ ]([A-Za-z0-9._-]+)/i);
    return match?.[1] ?? null;
  }
  if (!isRecord(value)) return null;
  const type = firstString(value, ['type', 'kind', 'scope']).toLowerCase();
  const id = firstString(value, ['sessionId', 'session', 'id']);
  return type === 'session' && id ? id : firstString(value, ['sessionId', 'session']) || null;
}

function labelFromFocus(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return fallback;
  return (
    firstString(value, ['label', 'name', 'title', 'id', 'sessionId', 'session', 'feature']) ||
    fallback
  );
}

function rowText(value: unknown, keys: string[], fallback = '-'): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return fallback;
  return firstString(value, keys) || fallback;
}

function buildNextActionView(
  data: unknown,
  repositoryFallback: string,
  noActionFallback: string,
): NextActionView {
  const record = isRecord(data) ? data : {};
  const focus = record.focus;
  const nextStep = record.nextStep;
  const completion = record.completion;
  const sessionId =
    sessionIdFromFocus(focus) ?? (isRecord(nextStep) ? sessionIdFromFocus(nextStep) : null);

  return {
    focusLabel: labelFromFocus(focus, repositoryFallback),
    sessionId,
    stepId: rowText(nextStep, ['id', 'stepId'], ''),
    nextStep: rowText(
      nextStep,
      ['title', 'label', 'name', 'action', 'command', 'id'],
      noActionFallback,
    ),
    reason: rowText(
      nextStep,
      ['reason', 'why', 'detail', 'message'],
      rowText(record, ['reason', 'why', 'detail', 'message']),
    ),
    remedy: rowText(
      nextStep,
      ['remedy', 'recommendation', 'nextCommand', 'command', 'fix'],
      rowText(
        record,
        ['remedy', 'recommendation', 'nextCommand', 'command', 'fix'],
        rowText(completion, ['reason', 'message', 'text']),
      ),
    ),
  };
}

/** Skeleton row matching the session/gate list item layout (title + meta + trailing control). */
function ListSkeleton({ trailing = 'badge' }: { trailing?: 'badge' | 'link' }) {
  return (
    <ul className="mt-4 space-y-3" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <li key={index} className="flex animate-pulse items-start justify-between gap-3 py-1">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          {trailing === 'badge' ? (
            <div className="h-5 w-16 shrink-0 rounded-full bg-slate-200 dark:bg-slate-700" />
          ) : (
            <div className="mt-0.5 h-4 w-16 shrink-0 rounded bg-slate-200 dark:bg-slate-700" />
          )}
        </li>
      ))}
    </ul>
  );
}

/** Friendly failure card: localized title + explanation + retry (mirrors sessions/gates list pages). */
function QueryFailure({
  title,
  detail,
  onRetry,
  retryLabel,
}: {
  title: string;
  detail: string;
  onRetry: () => void;
  retryLabel: string;
}) {
  return (
    <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
      <p className="text-sm font-medium text-red-800 dark:text-red-200">{title}</p>
      <p className="mt-1 text-sm leading-6 text-red-700 dark:text-red-300">{detail}</p>
      <button type="button" onClick={onRetry} className="btn-secondary mt-3 text-xs">
        {retryLabel}
      </button>
    </div>
  );
}

function HomePage() {
  const { t } = useI18n();
  const sessionsQuery = trpc.session.list.useQuery();
  const gatesQuery = trpc.gate.list.useQuery();
  const nextActionQuery = trpc.lifecycle.next.useQuery({});
  const [fieldOpen, setFieldOpen] = useState(false);

  const sessions = useMemo(
    () => (Array.isArray(sessionsQuery.data) ? sessionsQuery.data : []),
    [sessionsQuery.data],
  );
  const gates = useMemo(
    () => (Array.isArray(gatesQuery.data) ? gatesQuery.data : []),
    [gatesQuery.data],
  );

  const activeSessions = useMemo(
    () => sessions.filter((session) => isActiveStatus(session.status)),
    [sessions],
  );

  const pendingGates = useMemo(() => gates.filter((gate) => gate.status === 'pending'), [gates]);

  const loopStage = deriveLoopStage(activeSessions.length, pendingGates.length);
  const loopProgress = Math.min(
    1,
    (loopStage + (pendingGates.length > 0 ? 0.35 : activeSessions.length > 0 ? 0.2 : 0)) / 5,
  );

  const nextAction = useMemo(
    () =>
      buildNextActionView(
        nextActionQuery.data,
        t('home.nextAction.repositoryFocus'),
        t('home.nextAction.noAction'),
      ),
    [nextActionQuery.data, t],
  );

  // Known lifecycle steps render localized copy; unknown backend strings
  // degrade to their mono original text instead of raw error noise.
  const knownStep = knownLifecycleStep(nextAction.stepId);
  const stepTitleKey = knownStep ? (`home.step.${knownStep}.title` as I18nKey) : null;
  const stepReasonKey = knownStep ? (`home.step.${knownStep}.reason` as I18nKey) : null;
  const hasRawStep = Boolean(!knownStep && nextAction.stepId);

  return (
    <div className="page-container space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">
          {t('home.title')}
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
          {t('home.description')}
        </p>
      </header>

      {/* Block 1: overview */}
      <section>
        <div className="card min-w-0 p-5">
          <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="label">{t('home.repository')}</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                {t('home.repositoryName')}
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {t('home.repositoryDetail')}
              </p>
            </div>
            <dl className="grid min-w-0 gap-4 sm:grid-cols-3">
              <div>
                <dt className="label">{t('home.lastRefresh')}</dt>
                <dd className="value">
                  {formatRefresh(sessionsQuery.dataUpdatedAt, t('home.notRefreshed'))}
                </dd>
              </div>
              <div>
                <dt className="label">{t('home.activeSessions')}</dt>
                <dd className="value">{activeSessions.length}</dd>
              </div>
              <div>
                <dt className="label">{t('home.pendingGates')}</dt>
                <dd className="value">{pendingGates.length}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* Block 2: next action */}
      <section className="card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">{t('home.nextAction.title')}</h2>
            {nextActionQuery.isLoading ? (
              <div
                className="mt-2 h-4 w-48 animate-pulse rounded bg-slate-200 dark:bg-slate-700"
                aria-hidden="true"
              />
            ) : (
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
                {stepTitleKey ? (
                  t(stepTitleKey)
                ) : hasRawStep ? (
                  <span className="font-mono text-xs">{nextAction.nextStep}</span>
                ) : (
                  nextAction.nextStep
                )}
              </p>
            )}
          </div>
          {nextAction.sessionId && (
            <Link
              to="/sessions/$id"
              params={{ id: nextAction.sessionId }}
              className="btn-primary text-sm"
            >
              {t('home.nextAction.openSession')}
            </Link>
          )}
        </div>

        {nextActionQuery.isLoading ? (
          <div className="mt-4 animate-pulse space-y-3" aria-hidden="true">
            <div className="grid gap-3 md:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div
                  key={index}
                  className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
                >
                  <div className="h-3 w-16 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="mt-2 h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
              ))}
            </div>
          </div>
        ) : nextActionQuery.error ? (
          <QueryFailure
            title={t('home.nextAction.unavailable')}
            detail={t('home.nextActionFailedDetail')}
            onRetry={() => nextActionQuery.refetch()}
            retryLabel={t('common.retry')}
          />
        ) : (
          <dl className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <dt className="label">{t('home.nextAction.focus')}</dt>
              <dd className="value break-words">{nextAction.focusLabel}</dd>
            </div>
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <dt className="label">{t('home.nextAction.reason')}</dt>
              <dd className="value break-words">
                {stepReasonKey ? (
                  t(stepReasonKey)
                ) : (
                  <span className="font-mono text-xs leading-5">{nextAction.reason}</span>
                )}
              </dd>
            </div>
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <dt className="label">{t('home.nextAction.remedy')}</dt>
              <dd className="break-all font-mono text-xs leading-5 text-slate-900 dark:text-white">
                {nextAction.remedy}
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* Block 3 + 4: active sessions and pending gates */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="section-title">{t('home.activeSessions')}</h2>
            <Link
              to="/sessions"
              className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
            >
              {t('home.openSessions')}
            </Link>
          </div>
          {sessionsQuery.isLoading ? (
            <ListSkeleton trailing="badge" />
          ) : sessionsQuery.error ? (
            <QueryFailure
              title={t('home.sessionsFailed')}
              detail={t('home.sessionsFailedDetail')}
              onRetry={() => sessionsQuery.refetch()}
              retryLabel={t('common.retry')}
            />
          ) : activeSessions.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              {t('home.nextAction.noAction')}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-700">
              {activeSessions.slice(0, 4).map((session) => (
                <li key={session.id}>
                  <Link
                    to="/sessions/$id"
                    params={{ id: session.id }}
                    className="-mx-2 flex min-w-0 items-start justify-between gap-3 rounded-md px-2 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                        {session.goal || session.id}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                        {session.route.name} · {formatTime(session.updatedAt ?? session.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={session.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="section-title">{t('home.pendingGates')}</h2>
            <Link
              to="/gates"
              className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
            >
              {t('home.reviewGates')}
            </Link>
          </div>
          {gatesQuery.isLoading ? (
            <ListSkeleton trailing="link" />
          ) : gatesQuery.error ? (
            <QueryFailure
              title={t('home.gatesFailed')}
              detail={t('home.gatesFailedDetail')}
              onRetry={() => gatesQuery.refetch()}
              retryLabel={t('common.retry')}
            />
          ) : pendingGates.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              {t('home.nextAction.noAction')}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-700">
              {pendingGates.slice(0, 4).map((gate) => (
                <li key={`${gate.sessionId}:${gate.gateId}`} className="py-3">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                        {gate.description || gate.gateId}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                        {gate.sessionId} · {formatTime(gate.triggeredAt)}
                      </p>
                    </div>
                    <Link
                      to="/gates"
                      className="shrink-0 text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
                    >
                      {t('home.reviewGate')}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Block 5: entries */}
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <div>
            <h2 className="section-title">{t('home.primaryWorkflows')}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t('home.primaryWorkflowsDetail')}
            </p>
          </div>
          <div className="grid gap-3">
            {primarySurfaces.map((surface) => (
              <Link key={surface.to} to={surface.to} className="card-hover block p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-slate-900 dark:text-white">
                      {t(surface.labelKey)}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                      {t(surface.detailKey)}
                    </p>
                  </div>
                  <span className="mt-1 text-sm text-slate-300 dark:text-slate-600">/</span>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="section-title">{t('home.secondarySurfaces')}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t('home.secondarySurfacesDetail')}
            </p>
          </div>
          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
            {secondarySurfaces.map((surface) => (
              <Link
                key={surface.to}
                to={surface.to}
                className="block px-4 py-4 transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-slate-900 dark:text-white">
                      {t(surface.labelKey)}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                      {t(surface.detailKey)}
                    </p>
                  </div>
                  <span className="mt-1 text-sm text-slate-300 dark:text-slate-600">/</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Collapsed reference zone: lifecycle explainer, artifacts, and the
          opt-in decorative WebGL showcase. Data above stays authoritative. */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="section-title">{t('home.moreTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t('home.moreDetail')}
            </p>
          </div>
          <Link
            to="/governance"
            className="rounded text-sm font-medium text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-400"
          >
            {t('home.governanceOpen')}
          </Link>
        </div>

        <details className="card p-5">
          <summary className="cursor-pointer scroll-mt-20 select-none text-sm font-medium text-slate-900 dark:text-white">
            {t('home.governanceReference')}
            <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
              {t('home.governanceReferenceDetail')}
            </span>
          </summary>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {lifecycle.map((item) => (
              <div
                key={item.stageKey}
                className="rounded-md border border-slate-200 px-4 py-3 dark:border-slate-700"
              >
                <dt className="label">{t(item.stageKey as I18nKey)}</dt>
                <dd className="mt-1 text-sm text-slate-900 dark:text-white">
                  {t(item.detailKey as I18nKey)}
                </dd>
              </div>
            ))}
          </dl>
        </details>

        <details className="card p-5">
          <summary className="cursor-pointer scroll-mt-20 select-none text-sm font-medium text-slate-900 dark:text-white">
            {t('home.evidenceReferences')}
            <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
              {t('home.evidenceReferencesDetail')}
            </span>
          </summary>
          <ul className="mt-4 space-y-2">
            {artifacts.map((artifact) => (
              <li
                key={artifact}
                className="rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300"
              >
                {artifact}
              </li>
            ))}
          </ul>
        </details>

        <details
          className="card overflow-hidden"
          onToggle={(event) => setFieldOpen(event.currentTarget.open)}
        >
          <summary className="cursor-pointer scroll-mt-20 select-none p-5 text-sm font-medium text-slate-900 dark:text-white">
            {t('home.field.title')}
            <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
              {t('home.field.detail')}
            </span>
          </summary>
          {fieldOpen && (
            <div className="px-5 pb-5">
              <div className="amber-loop-card__field overflow-hidden rounded-md">
                <AmberField stage={loopStage} progress={loopProgress} />
              </div>
              <ol className="mt-3 grid grid-cols-3 gap-px rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-6 dark:border-slate-700 dark:bg-slate-700">
                {lifecycle.map((item, index) => (
                  <li
                    key={item.stageKey}
                    className={`bg-white px-2 py-2 text-center dark:bg-slate-800 ${
                      index === loopStage ? 'bg-blue-50 dark:bg-blue-950/40' : ''
                    }`}
                  >
                    <span
                      className={`block text-[10px] font-medium uppercase tracking-wide ${
                        index === loopStage
                          ? 'text-blue-700 dark:text-blue-300'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {t(item.stageKey as I18nKey)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </details>
      </section>
    </div>
  );
}
