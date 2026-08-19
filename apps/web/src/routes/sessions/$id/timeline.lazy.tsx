import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { isActiveStatus } from '@/features/sessions/sessions-view-model';
import { TimelineEvent } from '@/components/timeline/TimelineEvent';
import { TimelineFilter } from '@/components/timeline/TimelineFilter';
import { computeTimelineMetrics, formatDuration } from '@/components/timeline/timeline-utils';
import { buildTimelineView } from '@/components/timeline/timeline-view-model';
import { useI18n, type I18nKey } from '@/lib/i18n';

export const Route = createLazyFileRoute('/sessions/$id/timeline')({ component: TimelinePage });

function TimelinePage() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const [selectedType, setSelectedType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: session } = trpc.session.byId.useQuery({ id });
  const {
    data: events,
    isLoading,
    error,
    refetch,
  } = trpc.session.timeline.useQuery(
    { sessionId: id },
    { refetchInterval: isActiveStatus(session?.status ?? '') ? 10000 : false },
  );

  const metrics = useMemo(() => computeTimelineMetrics(events), [events]);
  const timelineEntries = useMemo(
    () => buildTimelineView(events, { selectedType, searchQuery }),
    [events, selectedType, searchQuery],
  );
  const visibleEventCount = timelineEntries.filter((entry) => entry.kind === 'event').length;
  const totalEventCount = events?.length ?? 0;
  const hasActiveFilters = Boolean(selectedType || searchQuery.trim());
  const eventTypeSummary = useMemo(() => {
    const entries = Object.entries(metrics.typeCounts);
    if (entries.length === 0) return null;
    return entries
      .slice(0, 4)
      .map(([type, count]) => `${t(`timeline.event.${type}` as I18nKey)}: ${count}`)
      .join(', ');
  }, [metrics.typeCounts, t]);

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-7 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-32 rounded bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="card max-w-xl p-5">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">
            {t('timeline.failed')}
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{error.message}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={() => refetch()} className="btn-secondary text-sm">
              {t('common.retry')}
            </button>
            <Link to="/" className="btn-secondary text-sm">
              {t('error.backHome')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container space-y-6">
      <header className="space-y-3">
        <Link
          to="/sessions/$id"
          params={{ id }}
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
          {t('timeline.backToSession')}
        </Link>
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">
          {t('timeline.title')}
        </h1>
        {session && <p className="text-sm text-slate-600 dark:text-slate-400">{session.goal}</p>}
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {hasActiveFilters
            ? t('timeline.showing', { visible: visibleEventCount, total: totalEventCount })
            : t(totalEventCount === 1 ? 'timeline.countOne' : 'timeline.count', {
                count: totalEventCount,
              })}
        </p>
      </header>

      {events && events.length > 1 && metrics.duration !== null && metrics.duration > 0 && (
        <dl className="card grid gap-4 p-5 sm:grid-cols-3">
          <div>
            <dt className="label">{t('timeline.totalDuration')}</dt>
            <dd className="value">{formatDuration(metrics.duration)}</dd>
          </div>
          <div>
            <dt className="label">{t('timeline.startedAt')}</dt>
            <dd className="value">
              {metrics.startTime !== null ? new Date(metrics.startTime).toLocaleString() : '-'}
            </dd>
          </div>
          {eventTypeSummary && (
            <div>
              <dt className="label">{t('timeline.eventTypes')}</dt>
              <dd className="value">{eventTypeSummary}</dd>
            </div>
          )}
        </dl>
      )}

      <TimelineFilter
        selectedType={selectedType}
        onTypeChange={setSelectedType}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {totalEventCount === 0 ? (
        <div className="card p-12 text-center" role="status">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            {t('timeline.empty.title')}
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t('timeline.empty.detail')}
          </p>
        </div>
      ) : visibleEventCount === 0 ? (
        <div className="card p-12 text-center" role="status">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            {t('timeline.noMatches.title')}
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {t('timeline.noMatches.detail')}
          </p>
          <button
            onClick={() => {
              setSelectedType('');
              setSearchQuery('');
            }}
            className="btn-secondary mt-4 text-sm"
          >
            {t('timeline.clearFilters')}
          </button>
        </div>
      ) : (
        <div className="space-y-3" data-testid="timeline">
          {timelineEntries.map((entry, index) => {
            if (entry.kind === 'gap') {
              return (
                <div
                  key={`gap-${index}`}
                  className="ml-14 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                >
                  {t(
                    entry.hiddenCount === 1
                      ? 'timeline.hiddenByFiltersOne'
                      : 'timeline.hiddenByFilters',
                    { count: entry.hiddenCount },
                  )}
                </div>
              );
            }

            const key =
              'id' in entry.event && entry.event.id
                ? (entry.event.id as string)
                : `${entry.event.type}-${entry.event.timestamp}-${entry.globalIndex}`;
            return (
              <TimelineEvent
                key={key}
                event={entry.event}
                displayIndex={entry.globalIndex}
                previousTimestamp={entry.previousTimestamp}
                startTime={metrics.startTime}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
