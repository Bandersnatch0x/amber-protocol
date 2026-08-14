import { useMemo, useState } from 'react';
import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { StatusBadge } from '@/components/session/StatusBadge';
import { SessionControls } from '@/components/session/SessionControls';
import { SessionStatus } from '@/components/session/SessionStatus';
import { CodeBlock } from '@/components/code/CodeBlock';
import { AuditEvidenceCard } from '@/components/session/AuditEvidenceCard';
import { SessionCompletionWorkbench } from '@/components/session/SessionCompletionWorkbench';
import { useSessionEvents } from '@/lib/hooks/useSessionEvents';
import { useI18n, type I18nKey } from '@/lib/i18n';
import type { SessionEvent, SessionStatus as SessionStatusType } from '@/lib/types/session-events';

export const Route = createLazyFileRoute('/sessions/$id/')({ component: SessionDetailPage });

function formatDateTime(value: string | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function formatBudget(session: {
  budget?: {
    maxTokens: number;
    tokensUsed?: number;
  };
}, t: (key: I18nKey, params?: Record<string, string | number>) => string): string | null {
  if (!session.budget) return null;
  const used = session.budget.tokensUsed ?? 0;
  const max = session.budget.maxTokens;
  if (max <= 0) return t('sessions.detail.tokensUsed', { used: used.toLocaleString() });
  const percent = ((used / max) * 100).toFixed(1);
  return t('sessions.detail.tokensUsedOfMax', { used: used.toLocaleString(), max: max.toLocaleString(), percent });
}

function notFoundMessage(message: string | undefined): boolean {
  return !message || /not found/i.test(message);
}

function lifecycleFromNext(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined;
  return (data as { lifecycle?: unknown }).lifecycle;
}

function SessionDetailPage() {
  const { t } = useI18n();
  const { id } = Route.useParams();
  const search = Route.useSearch() as { from?: string } | undefined;
  const fromGates = search?.from === 'gates';
  const { data: session, isLoading, error, refetch } = trpc.session.byId.useQuery({ id });
  const timelineQuery = trpc.session.timeline.useQuery({ sessionId: id });
  const auditSummary = trpc.session.auditSummary.useQuery({ sessionId: id });
  const lifecycleNext = trpc.lifecycle.next.useQuery({ session: id, strict: true });
  const completionCheck = trpc.lifecycle.completionCheck.useQuery({ sessionId: id, strict: true });
  const runVerification = trpc.lifecycle.runVerification.useMutation();
  const { status: liveStatus, connectionState, lastEvent, reconnect, reconnectAttempt } = useSessionEvents(id);
  const [manifestExpanded, setManifestExpanded] = useState(false);

  const effectiveStatus = (liveStatus ?? session?.status ?? null) as SessionStatusType | null;
  const latestEvent = useMemo<SessionEvent | null>(() => {
    if (lastEvent) return lastEvent;
    const timeline = timelineQuery.data;
    if (!timeline || timeline.length === 0) return null;
    return timeline[timeline.length - 1] ?? null;
  }, [lastEvent, timelineQuery.data]);
  const manifestJson = useMemo(() => (session ? JSON.stringify(session.manifest, null, 2) : ''), [session]);
  const manifestPreview = useMemo(() => manifestJson.replace(/\s+/g, ' ').slice(0, 140), [manifestJson]);
  const budgetText = session ? formatBudget(session, t) : null;
  const eventCount = timelineQuery.data?.length ?? session?.timelineEvents ?? 0;

  async function handleRunVerification(input: { command?: string }) {
    try {
      await runVerification.mutateAsync({ sessionId: id, command: input.command });
    } catch {
      // React Query keeps the mutation error for display; still refresh evidence.
    } finally {
      await Promise.all([
        refetch(),
        timelineQuery.refetch(),
        auditSummary.refetch(),
        lifecycleNext.refetch(),
        completionCheck.refetch(),
      ]);
    }
  }

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-7 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-28 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <div className="card h-64 p-6" />
              <div className="card h-16 p-6" />
            </div>
            <div className="card h-56 p-6" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !session) {
    const isNotFound = notFoundMessage(error?.message);

    return (
      <div className="page-container">
        <div className="card max-w-xl p-6">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
            {isNotFound ? t('sessions.detail.notFound') : t('sessions.detail.failed')}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
            {isNotFound
              ? t('sessions.detail.notFoundDetail')
              : error?.message}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to={fromGates ? '/gates' : '/sessions'} className="btn-secondary text-sm">
              {fromGates ? t('gates.backToGates') : t('sessions.detail.back')}
            </Link>
            {!isNotFound && (
              <button onClick={() => refetch()} className="btn-secondary text-sm">
                {t('common.retry')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container space-y-6">
      <header className="space-y-3">
        <Link to={fromGates ? '/gates' : '/sessions'} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
          <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {fromGates ? t('gates.backToGates') : t('nav.sessions')}
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={effectiveStatus ?? session.status} />
          <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{session.id}</span>
          {effectiveStatus === 'completed' && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">{t('sessions.detail.completedSuccessfully')}</span>
          )}
        </div>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">{session.goal}</h1>
          </div>
        </div>
      </header>

      <section className="card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex-1">
            <SessionStatus
              status={effectiveStatus}
              connectionState={connectionState}
              lastEvent={latestEvent}
              onRetry={reconnect}
              reconnectAttempt={reconnectAttempt}
            />
          </div>
          <div className="lg:pl-6">
            <SessionControls
              sessionId={id}
              status={effectiveStatus}
              onActionSettled={async () => {
                await Promise.all([auditSummary.refetch(), refetch()]);
              }}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="section-title">{t('sessions.detail.details')}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('sessions.detail.metadataDetail')}</p>
              </div>
              <Link to="/sessions/$id/timeline" params={{ id: session.id }} className="btn-primary text-sm">
                {t('sessions.detail.viewTimeline')}
              </Link>
            </div>

            <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="label">{t('sessions.detail.route')}</dt>
                <dd className="mt-1 text-sm text-slate-900 dark:text-white">{session.route.name}</dd>
                <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">{session.route.id}</p>
              </div>
              <div>
                <dt className="label">{t('sessions.detail.timelineEvents')}</dt>
                <dd className="value">{eventCount}</dd>
              </div>
              <div>
                <dt className="label">{t('sessions.detail.created')}</dt>
                <dd className="value">{formatDateTime(session.createdAt)}</dd>
              </div>
              <div>
                <dt className="label">{t('sessions.detail.updated')}</dt>
                <dd className="value">{formatDateTime(session.updatedAt)}</dd>
              </div>
              <div>
                <dt className="label">{t('sessions.detail.worktree')}</dt>
                <dd className="value">{session.worktree?.active ? t('sessions.detail.worktreeActive') : t('sessions.detail.worktreeInactive')}</dd>
                {session.worktree?.path && (
                  <p className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">{session.worktree.path}</p>
                )}
              </div>
              {budgetText && (
                <div>
                  <dt className="label">{t('sessions.detail.budget')}</dt>
                  <dd className="value">{budgetText}</dd>
                </div>
              )}
            </dl>
          </section>

          <SessionCompletionWorkbench
            completion={completionCheck.data}
            lifecycle={lifecycleFromNext(lifecycleNext.data)}
            isLoading={completionCheck.isLoading || lifecycleNext.isLoading}
            error={completionCheck.error ?? lifecycleNext.error}
            isVerifying={runVerification.isLoading}
            verificationError={runVerification.error?.message ?? null}
            verificationResult={runVerification.data}
            onRunVerification={handleRunVerification}
          />
        </div>

        <aside className="space-y-6">
          <section className="card p-5">
            <AuditEvidenceCard
              summary={auditSummary.data}
              isLoading={auditSummary.isLoading}
              error={auditSummary.error}
              className="mt-4"
              labels={{
                loading: t('sessions.audit.loading'),
                failed: t('sessions.audit.failed'),
                title: t('sessions.audit.title'),
                detail: t('sessions.audit.detail'),
                ledgerMissing: t('sessions.audit.ledgerMissing'),
                ledgerVerified: t('sessions.audit.ledgerVerified'),
                ledgerBroken: t('sessions.audit.ledgerBroken'),
                latestLedger: t('sessions.audit.latestLedger'),
                emptyLedger: t('sessions.audit.noLedgerRecord'),
                latestTimeline: t('sessions.audit.latestTimeline'),
                emptyTimeline: t('sessions.audit.noTimelineEvent'),
                hash: t('sessions.audit.hash'),
                counts: t('sessions.audit.counts'),
                countValue: t('sessions.audit.countValues', { ledger: '{ledger}', timeline: '{timeline}' }),
              }}
            />
          </section>

          <section className="card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="section-title">{t('sessions.detail.manifest')}</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('sessions.detail.manifestDetail')}</p>
              </div>
              <button
                type="button"
                aria-expanded={manifestExpanded}
                onClick={() => setManifestExpanded((current) => !current)}
                className="text-sm text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-400 rounded"
              >
                {manifestExpanded ? t('common.hide') : t('common.show')}
              </button>
            </div>

            {manifestExpanded ? (
              <CodeBlock code={manifestJson} language="json" title="manifest.json" collapseAfterLines={24} />
            ) : (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-slate-600 dark:text-slate-400">{t('sessions.detail.manifestCollapsed')}</p>
                <p className="rounded-md bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  {manifestPreview}...
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
