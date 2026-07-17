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
  return firstString(value, ['label', 'name', 'title', 'id', 'sessionId', 'session', 'feature']) || fallback;
}

function rowText(value: unknown, keys: string[], fallback = '-'): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!isRecord(value)) return fallback;
  return firstString(value, keys) || fallback;
}

function buildNextActionView(data: unknown, repositoryFallback: string, noActionFallback: string): NextActionView {
  const record = isRecord(data) ? data : {};
  const focus = record.focus;
  const nextStep = record.nextStep;
  const completion = record.completion;
  const sessionId = sessionIdFromFocus(focus) ?? (isRecord(nextStep) ? sessionIdFromFocus(nextStep) : null);

  return {
    focusLabel: labelFromFocus(focus, repositoryFallback),
    sessionId,
    nextStep: rowText(nextStep, ['title', 'label', 'name', 'action', 'command', 'id'], noActionFallback),
    reason: rowText(nextStep, ['reason', 'why', 'detail', 'message'], rowText(record, ['reason', 'why', 'detail', 'message'])),
    remedy: rowText(
      nextStep,
      ['remedy', 'recommendation', 'nextCommand', 'command', 'fix'],
      rowText(record, ['remedy', 'recommendation', 'nextCommand', 'command', 'fix'], rowText(completion, ['reason', 'message', 'text'])),
    ),
  };
}

function HomePage() {
  const { t } = useI18n();
  const sessionsQuery = trpc.session.list.useQuery();
  const gatesQuery = trpc.gate.list.useQuery();
  const nextActionQuery = trpc.lifecycle.next.useQuery({});
  const [lifecycleExpanded, setLifecycleExpanded] = useState(true);

  const sessions = Array.isArray(sessionsQuery.data) ? sessionsQuery.data : [];
  const gates = Array.isArray(gatesQuery.data) ? gatesQuery.data : [];

  const activeSessions = useMemo(
    () => sessions.filter((session) => isActiveStatus(session.status)),
    [sessions],
  );

  const pendingGates = useMemo(
    () => gates.filter((gate) => gate.status === 'pending'),
    [gates],
  );

  const loopStage = deriveLoopStage(activeSessions.length, pendingGates.length);
  const loopProgress = Math.min(
    1,
    (loopStage + (pendingGates.length > 0 ? 0.35 : activeSessions.length > 0 ? 0.2 : 0)) / 5,
  );

  const nextAction = useMemo(
    () => buildNextActionView(nextActionQuery.data, t('home.nextAction.repositoryFocus'), t('home.nextAction.noAction')),
    [nextActionQuery.data, t],
  );

  return (
    <div className="page-container space-y-8">
      <header className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">{t('home.title')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
            {t('home.description')}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link to="/sessions" className="btn-primary text-sm">{t('home.openSessions')}</Link>
          <Link to="/gates" className="btn-secondary text-sm">{t('home.reviewGates')}</Link>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="card p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="label">{t('home.repository')}</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{t('home.repositoryName')}</h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{t('home.repositoryDetail')}</p>
            </div>
            <dl className="grid gap-4 sm:grid-cols-3 md:min-w-[420px]">
              <div>
                <dt className="label">{t('home.lastRefresh')}</dt>
                <dd className="value">{formatRefresh(sessionsQuery.dataUpdatedAt, t('home.notRefreshed'))}</dd>
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

        <div className="amber-loop-card card overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div>
              <h2 className="text-sm font-medium text-slate-900 dark:text-white">{t('home.governanceReference')}</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('home.governanceReferenceDetail')}</p>
            </div>
            <span className="label shrink-0">{t(lifecycle[loopStage].stageKey as I18nKey)}</span>
          </div>
          <div className="amber-loop-card__field">
            <AmberField stage={loopStage} progress={loopProgress} />
          </div>
          <ol className="grid grid-cols-3 gap-px border-t border-slate-200 bg-slate-200 dark:border-slate-700 dark:bg-slate-700 sm:grid-cols-6">
            {lifecycle.map((item, index) => (
              <li
                key={item.stageKey}
                className={`bg-white px-2 py-2 text-center dark:bg-slate-800 ${
                  index === loopStage ? 'bg-blue-50 dark:bg-blue-950/40' : ''
                }`}
              >
                <span
                  className={`block text-[10px] font-medium uppercase tracking-wide ${
                    index === loopStage ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {t(item.stageKey as I18nKey)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="section-title">{t('home.nextAction.title')}</h2>
            <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">
              {nextActionQuery.isLoading ? t('home.nextAction.loading') : nextAction.nextStep}
            </p>
          </div>
          {nextAction.sessionId && (
            <Link to="/sessions/$id" params={{ id: nextAction.sessionId }} className="btn-primary text-sm">
              {t('home.nextAction.openSession')}
            </Link>
          )}
        </div>

        {nextActionQuery.error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            <p className="font-medium">{t('home.nextAction.unavailable')}</p>
            {nextActionQuery.error.message && <p className="mt-1 break-words">{nextActionQuery.error.message}</p>}
          </div>
        ) : (
          <dl className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <dt className="label">{t('home.nextAction.focus')}</dt>
              <dd className="value break-words">{nextAction.focusLabel}</dd>
            </div>
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <dt className="label">{t('home.nextAction.reason')}</dt>
              <dd className="value break-words">{nextAction.reason}</dd>
            </div>
            <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
              <dt className="label">{t('home.nextAction.remedy')}</dt>
              <dd className="value break-words">{nextAction.remedy}</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="section-title">{t('home.activeSessions')}</h2>
            <Link to="/sessions" className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400">
              {t('home.openSessions')}
            </Link>
          </div>
          {sessionsQuery.isLoading ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{t('sessions.loading')}</p>
          ) : sessionsQuery.error ? (
            <p className="mt-4 text-sm text-red-700 dark:text-red-300">{sessionsQuery.error.message}</p>
          ) : activeSessions.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{t('home.nextAction.noAction')}</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-700">
              {activeSessions.slice(0, 4).map((session) => (
                <li key={session.id}>
                  <Link
                    to="/sessions/$id"
                    params={{ id: session.id }}
                    className="-mx-2 flex items-start justify-between gap-3 rounded-md px-2 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{session.goal || session.id}</p>
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
            <Link to="/gates" className="text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400">
              {t('home.reviewGates')}
            </Link>
          </div>
          {gatesQuery.isLoading ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{t('gates.loading')}</p>
          ) : gatesQuery.error ? (
            <p className="mt-4 text-sm text-red-700 dark:text-red-300">{gatesQuery.error.message}</p>
          ) : pendingGates.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{t('home.nextAction.noAction')}</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-200 dark:divide-slate-700">
              {pendingGates.slice(0, 4).map((gate) => (
                <li key={`${gate.sessionId}:${gate.gateId}`} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                        {gate.description || gate.gateId}
                      </p>
                      <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                        {gate.sessionId} · {formatTime(gate.triggeredAt)}
                      </p>
                    </div>
                    <Link
                      to="/sessions/$id"
                      params={{ id: gate.sessionId }}
                      className="shrink-0 text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
                    >
                      {t('home.nextAction.openSession')}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <div>
            <h2 className="section-title">{t('home.primaryWorkflows')}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('home.primaryWorkflowsDetail')}</p>
          </div>
          <div className="grid gap-3">
            {primarySurfaces.map((surface) => (
              <Link key={surface.to} to={surface.to} className="card-hover block p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-slate-900 dark:text-white">{t(surface.labelKey)}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{t(surface.detailKey)}</p>
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
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('home.secondarySurfacesDetail')}</p>
          </div>
          <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
            {secondarySurfaces.map((surface) => (
              <Link key={surface.to} to={surface.to} className="block px-4 py-4 transition-colors duration-150 hover:bg-slate-50 dark:hover:bg-slate-900">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-slate-900 dark:text-white">{t(surface.labelKey)}</h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t(surface.detailKey)}</p>
                  </div>
                  <span className="mt-1 text-sm text-slate-300 dark:text-slate-600">/</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="card p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="section-title">{t('home.governanceReference')}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('home.governanceReferenceDetail')}</p>
            </div>
            <button
              type="button"
              onClick={() => setLifecycleExpanded((current) => !current)}
              className="text-sm text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-400 rounded"
            >
              {lifecycleExpanded ? t('common.hide') : t('common.show')}
            </button>
          </div>
          {lifecycleExpanded && (
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {lifecycle.map((item) => (
                <div key={item.stageKey} className="rounded-md border border-slate-200 px-4 py-3 dark:border-slate-700">
                  <dt className="label">{t(item.stageKey as I18nKey)}</dt>
                  <dd className="mt-1 text-sm text-slate-900 dark:text-white">{t(item.detailKey as I18nKey)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="card p-5">
          <h2 className="section-title">{t('home.evidenceReferences')}</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('home.evidenceReferencesDetail')}</p>
          <ul className="mt-4 space-y-2">
            {artifacts.map((artifact) => (
              <li key={artifact} className="rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                {artifact}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
