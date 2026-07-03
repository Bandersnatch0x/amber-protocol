import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useState, useMemo } from 'react';
import { TimelineEvent } from '@/components/timeline/TimelineEvent';
import { TimelineFilter } from '@/components/timeline/TimelineFilter';
import { computeTimelineMetrics, formatDuration, parseTimestamp } from '@/components/timeline/timeline-utils';
import { getTimelineEventConfig } from '@/components/timeline/timeline-config';

export const Route = createLazyFileRoute('/sessions/$id/timeline')({ component: TimelinePage });

function TimelinePage() {
  const { id } = Route.useParams();
  const [selectedType, setSelectedType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: session } = trpc.session.byId.useQuery({ id });
  const { data: events, isLoading, error } = trpc.session.timeline.useQuery({ sessionId: id });
  const metrics = useMemo(() => computeTimelineMetrics(events), [events]);

  const filteredEvents = useMemo(() => {
    if (!events) return events;
    const q = searchQuery.toLowerCase();
    return events.filter(event => {
      const eventType = event.type || '';
      const matchesType = !selectedType || eventType === selectedType;
      const matchesSearch = !q ||
        JSON.stringify(event).toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [events, selectedType, searchQuery]);

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/4"></div>
          <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="card p-5 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error loading timeline</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="mb-6">
        <Link
          to="/sessions/$id"
          params={{ id }}
          className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 mb-3 inline-flex items-center gap-1"
        >
          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Session
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Timeline</h1>
        {session && (
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{session.goal}</p>
        )}
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {filteredEvents?.length || 0} of {events?.length || 0} event{events?.length !== 1 ? 's' : ''}
        </p>
      </div>

      {events && events.length > 1 && metrics.duration !== null && metrics.duration > 0 && (
        <dl className="card p-5 grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          <div>
            <dt className="label">Total Duration</dt>
            <dd className="value">{formatDuration(metrics.duration)}</dd>
          </div>
          <div>
            <dt className="label">Started At</dt>
            <dd className="value">{metrics.startTime !== null ? new Date(metrics.startTime).toLocaleString() : '-'}</dd>
          </div>
          <div>
            <dt className="label">Event Types</dt>
            <dd className="value">
              {Object.entries(metrics.typeCounts).map(([type, count]) => `${getTimelineEventConfig(type).label}: ${count}`).join(', ')}
            </dd>
          </div>
        </dl>
      )}

      <TimelineFilter
        selectedType={selectedType}
        onTypeChange={setSelectedType}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {!filteredEvents || filteredEvents.length === 0 ? (
        <div className="card p-12 text-center" role="status">
          <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-1">
            {events?.length === 0 ? 'No events recorded yet' : 'No events match your filters'}
          </h3>
          {events && events.length > 0 && selectedType && (
            <button
              onClick={() => { setSelectedType(''); setSearchQuery(''); }}
              className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div data-testid="timeline">
          {filteredEvents.map((event, index) => {
            const key = 'id' in event && event.id ? event.id as string : `${event.type}-${event.timestamp}-${index}`;
            const prevTimestamp = index > 0 ? parseTimestamp(filteredEvents[index - 1].timestamp) : null;
            return <TimelineEvent key={key} event={event} index={index} previousTimestamp={prevTimestamp} startTime={metrics.startTime} />;
          })}
        </div>
      )}
    </div>
  );
}
