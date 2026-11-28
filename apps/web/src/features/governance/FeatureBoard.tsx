import { useEffect, useState, type ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { StatusBadge } from '@/components/session/StatusBadge';
import type {
  FeatureBoardItem,
  FeatureBoardResult,
  FeatureBoardSession,
} from '../../../../../scripts/lib/web-adapter';

interface FeatureBoardProps {
  snapshot?: FeatureBoardResult;
  isLoading: boolean;
  isFetching: boolean;
  error?: string;
  featureId?: string;
  onRefresh: () => void;
  onFocus: (featureId?: string) => void;
}

const statusLabels: Record<string, I18nKey> = {
  not_started: 'board.status.notStarted',
  in_progress: 'board.status.inProgress',
  blocked: 'board.status.blocked',
  passing: 'board.status.passing',
  accepted: 'board.status.accepted',
};
const neutral = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
const statusTones: Record<string, string> = {
  in_progress: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  blocked: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  accepted: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
};

function FeatureStatus({ status }: { status: string }) {
  const { t } = useI18n();
  return (
    <span
      data-status={status}
      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${statusTones[status] ?? neutral}`}
    >
      {statusLabels[status] ? t(statusLabels[status]) : status}
    </span>
  );
}

function SessionRows({
  sessions,
  showReference = false,
}: {
  sessions: FeatureBoardSession[];
  showReference?: boolean;
}) {
  const { t } = useI18n();
  return (
    <ul className="divide-y divide-slate-200 dark:divide-slate-700">
      {sessions.map((session) => (
        <li
          key={session.sessionId}
          className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        >
          <div className="min-w-0 space-y-1">
            <p className="break-words text-sm text-slate-800 dark:text-slate-200">{session.goal}</p>
            <p className="break-all font-mono text-xs text-slate-500 dark:text-slate-400">
              {session.sessionId}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <StatusBadge status={session.status} />
              <span>
                {t('board.stage')}:{' '}
                <span className="break-all font-mono">
                  {session.currentStage?.trim() || t('board.unknownStage')}
                </span>
              </span>
              {showReference && (
                <span>
                  {t('board.reference')}:{' '}
                  <code className="break-all">
                    {session.feature === '' ? JSON.stringify('') : session.feature}
                  </code>
                </span>
              )}
            </div>
          </div>
          <Link
            to="/sessions/$id"
            params={{ id: session.sessionId }}
            className="inline-flex min-h-11 items-center text-sm text-blue-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-blue-300"
          >
            {t('board.openSession')}{' '}
            <span aria-hidden="true" className="ml-1">
              →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FeatureRow({
  feature,
  sessions,
  onFocus,
  sessionsUnavailable,
}: {
  feature: FeatureBoardItem;
  sessions: FeatureBoardSession[];
  onFocus: (id?: string) => void;
  sessionsUnavailable: boolean;
}) {
  const { t } = useI18n();
  return (
    <details
      data-feature={feature.id}
      className="group border-b border-slate-200 last:border-b-0 dark:border-slate-700"
    >
      <summary className="grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)] items-center gap-2 px-4 py-4 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:-outline-offset-2 dark:hover:bg-slate-800/50 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{feature.id}</span>
        <span className="min-w-0 break-words font-medium text-slate-900 dark:text-slate-100">
          {feature.title}
        </span>
        <span className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-1">
          <FeatureStatus status={feature.status} />
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('board.sessionCount', { count: sessions.length })}
          </span>
          <span aria-hidden="true" className="ml-auto text-slate-500 group-open:rotate-90">
            ›
          </span>
        </span>
      </summary>
      <div className="min-w-0 space-y-3 px-4 pb-4 sm:pl-16">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>
            {t('board.priority')}: {feature.priority} · <code>{feature.status}</code>
          </span>
          <button
            type="button"
            className="btn-secondary min-h-11 text-xs focus-visible:ring-blue-500"
            onClick={() => onFocus(feature.id)}
          >
            {t('board.focus')}
          </button>
        </div>
        {feature.notes.map((note, index) => (
          <p
            key={index}
            className="whitespace-pre-wrap break-words border-l-2 border-slate-200 pl-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            {note}
          </p>
        ))}
        {sessions.length > 0 ? (
          <SessionRows sessions={sessions} />
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t(sessionsUnavailable ? 'board.sessionsUncertain' : 'board.noLinkedSessions')}
          </p>
        )}
        <details className="border-t border-slate-200 pt-1 dark:border-slate-700">
          <summary className="min-h-11 cursor-pointer py-3 text-xs text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-slate-300">
            {t('board.evidence', { count: feature.evidence.length })}
          </summary>
          {feature.evidence.length ? (
            <ul className="space-y-2">
              {feature.evidence.map((record, index) => (
                <li
                  key={index}
                  className="whitespace-pre-wrap break-all rounded bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  {record}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('board.noEvidence')}</p>
          )}
        </details>
      </div>
    </details>
  );
}

function SourceErrors({ title, errors }: { title: string; errors: string[] }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <p className="font-medium">{title}</p>
      <ul className="mt-1 space-y-1">
        {errors.map((error, index) => (
          <li className="whitespace-pre-wrap break-all text-xs" key={index}>
            {error}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadFeedback(): ReactElement | null {
  const { t } = useI18n();
  const [phase, setPhase] = useState<'none' | 'placeholder' | 'detail'>('none');
  useEffect(() => {
    const placeholder = window.setTimeout(() => setPhase('placeholder'), 300);
    const detail = window.setTimeout(() => setPhase('detail'), 2_000);
    return () => {
      window.clearTimeout(placeholder);
      window.clearTimeout(detail);
    };
  }, []);
  if (phase === 'none') return null;
  return (
    <div
      role="status"
      aria-label={t('board.loading')}
      className="min-h-5 text-sm text-slate-500 dark:text-slate-400"
    >
      {phase === 'detail' ? (
        t('board.loading')
      ) : (
        <div
          aria-hidden="true"
          className="h-5 w-48 max-w-full rounded bg-slate-200 dark:bg-slate-700"
        />
      )}
    </div>
  );
}

export function FeatureBoard({
  snapshot,
  isLoading,
  isFetching,
  error,
  featureId,
  onRefresh,
  onFocus,
}: FeatureBoardProps): ReactElement {
  const { t } = useI18n();
  const [status, setStatus] = useState('all');
  const [focusedFeature, setFocusedFeature] = useState(featureId);
  if (focusedFeature !== featureId) {
    setFocusedFeature(featureId);
    setStatus('all');
  }
  const healthyAt =
    snapshot?.features.state === 'ok' && snapshot.sessions.state === 'ok'
      ? snapshot.generatedAt
      : undefined;
  const [lastHealthyAt, setLastHealthyAt] = useState(healthyAt);
  if (healthyAt && healthyAt !== lastHealthyAt) setLastHealthyAt(healthyAt);
  const successfulAt = healthyAt ?? lastHealthyAt;
  const failed = !!error || (!!snapshot && !healthyAt);
  const featureSource = snapshot?.features;
  const sessionSource = snapshot?.sessions;
  const features = featureSource?.items ?? [];
  const sessions = sessionSource?.items ?? [];
  const knownFeatures = new Set(features.map((feature) => feature.id));
  const unbound = sessions.filter((session) => session.feature === null);
  const unresolved = sessions.filter(
    (session) =>
      session.feature !== null &&
      (featureSource?.state !== 'ok' || !knownFeatures.has(session.feature)),
  );
  const visible = features.filter(
    (feature) =>
      (!featureId || feature.id === featureId) && (status === 'all' || feature.status === status),
  );
  const sessionsUnavailable = sessionSource?.state !== 'ok';
  const filterStatuses = ['all', ...(snapshot?.statuses ?? [])];

  return (
    <section aria-labelledby="feature-board-title" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="feature-board-title" className="section-title">
            {t('board.title')}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('board.description')}
          </p>
        </div>
        <button
          type="button"
          aria-label={t('board.refreshAria')}
          disabled={isFetching || isLoading}
          onClick={onRefresh}
          className="btn-secondary min-h-11 text-sm focus-visible:ring-blue-500"
        >
          {t(isFetching ? 'governance.refreshing' : 'board.refresh')}
        </button>
      </div>
      {(error || (failed && successfulAt)) && (
        <SourceErrors
          title={t(successfulAt ? 'board.stale' : 'board.unavailable')}
          errors={error ? [error] : []}
        />
      )}
      {snapshot && (
        <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>
            {t('board.featureSource')}:{' '}
            {t(featureSource?.state === 'ok' ? 'board.read' : 'board.readFailed')} ·{' '}
            {t('board.sessionSource')}:{' '}
            {t(
              sessionSource?.state === 'ok'
                ? 'board.read'
                : sessionSource?.state === 'partial'
                  ? 'board.partial'
                  : 'board.readFailed',
            )}
          </span>
          <span>
            {t(failed ? 'board.lastSuccess' : 'board.snapshotTime')}:{' '}
            {successfulAt ? (
              <time dateTime={successfulAt}>{successfulAt}</time>
            ) : (
              t('board.noHealthySnapshot')
            )}
          </span>
        </div>
      )}
      {featureSource?.state === 'error' && (
        <SourceErrors title={t('board.featureError')} errors={featureSource.errors} />
      )}
      {sessionSource && sessionSource.state !== 'ok' && (
        <SourceErrors
          title={t(
            sessionSource.state === 'partial' ? 'board.sessionPartial' : 'board.sessionError',
          )}
          errors={sessionSource.errors}
        />
      )}
      {(isLoading || isFetching) && <ReadFeedback />}
      {snapshot && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div
            role="group"
            aria-label={t('board.statusFilter')}
            className="flex flex-wrap gap-2 border-b border-slate-200 p-3 dark:border-slate-700"
          >
            {filterStatuses.map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={status === value}
                disabled={featureSource?.state !== 'ok'}
                onClick={() => setStatus(value)}
                className={`min-h-11 rounded-md px-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${status === value ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {value === 'all'
                  ? t('board.all')
                  : statusLabels[value]
                    ? t(statusLabels[value])
                    : value}{' '}
                <span className="ml-1 font-mono">
                  {featureSource?.state === 'ok'
                    ? features.filter((feature) => value === 'all' || feature.status === value)
                        .length
                    : '—'}
                </span>
              </button>
            ))}
            {featureId && (
              <button
                type="button"
                className="btn-secondary min-h-11 text-xs focus-visible:ring-blue-500"
                onClick={() => {
                  setStatus('all');
                  onFocus();
                }}
              >
                {t('board.clearFocus')}
              </button>
            )}
          </div>
          {featureSource?.state === 'ok' &&
            (visible.length ? (
              visible.map((feature) => (
                <FeatureRow
                  key={feature.id}
                  feature={feature}
                  sessions={sessions.filter((session) => session.feature === feature.id)}
                  sessionsUnavailable={sessionsUnavailable}
                  onFocus={onFocus}
                />
              ))
            ) : (
              <p className="p-6 text-sm text-slate-500 dark:text-slate-400">
                {t(features.length ? 'board.noMatch' : 'board.empty')}
              </p>
            ))}
          <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {t('board.passingNote')}
          </p>
        </div>
      )}
      {snapshot && (
        <section aria-labelledby="independent-sessions-title" className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3
              id="independent-sessions-title"
              className="text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              {t('board.independent')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('board.independentNote')}
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { label: t('board.unbound'), items: unbound, references: false },
              {
                label: t(featureSource?.state === 'ok' ? 'board.unresolved' : 'board.unverifiable'),
                items: unresolved,
                references: true,
              },
            ].map((group) => (
              <section
                key={group.label}
                aria-label={group.label}
                className="min-w-0 border-t border-slate-200 pt-3 dark:border-slate-700"
              >
                <h4 className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {group.label}
                </h4>
                {group.items.length ? (
                  <SessionRows sessions={group.items} showReference={group.references} />
                ) : (
                  <p className="py-3 text-sm text-slate-500 dark:text-slate-400">
                    {t(sessionsUnavailable ? 'board.sessionsUncertain' : 'board.noSessions')}
                  </p>
                )}
              </section>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
