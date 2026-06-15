import { useState } from 'react';
import { EventIcon } from './EventIcon';
import { getTimelineEventConfig } from './timeline-config';
import { formatEventTimestamp, formatDuration, getEventSummary, parseTimestamp } from './timeline-utils';
import type { SessionEvent } from '@/lib/types/session-events';

interface TimelineEventProps {
  event: SessionEvent;
  index: number;
  previousTimestamp: number | null;
  startTime: number | null;
}

export function TimelineEvent({ event, index, previousTimestamp, startTime }: TimelineEventProps) {
  const [expanded, setExpanded] = useState(false);
  const config = getTimelineEventConfig(event.type);
  const summary = getEventSummary(event);
  const timestamp = parseTimestamp(event.timestamp);

  const offset = startTime !== null && timestamp !== null ? timestamp - startTime : null;
  const interval = previousTimestamp !== null && timestamp !== null ? timestamp - previousTimestamp : null;

  return (
    <div className="flex gap-4 group">
      <div className="relative flex flex-col items-center">
        <EventIcon type={event.type} />
        <div className="flex-1 w-px bg-slate-200 dark:bg-slate-700 mt-2 group-last:hidden" />
      </div>

      <div className="flex-1 pb-8">
        <div className="card-hover p-4">
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                #{index + 1}
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                {config.label}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {formatEventTimestamp(event.timestamp)}
              </span>
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-controls={`event-detail-${index}`}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded flex-shrink-0"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {offset !== null && (
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                +{formatDuration(offset)} from start
              </span>
            )}
            {interval !== null && (
              <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                +{formatDuration(interval)} since previous
              </span>
            )}
          </div>

          {summary.title && (
            <p className="text-sm font-medium text-slate-900 dark:text-white mb-2">{summary.title}</p>
          )}

          {summary.details.length > 0 && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 mb-3">
              {summary.details.map((detail, i) => (
                <div key={i}>
                  <dt className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">{detail.label}</dt>
                  <dd className="mt-0.5 text-sm text-slate-700 dark:text-slate-300 break-words">{detail.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {expanded && (
            <div id={`event-detail-${index}`} className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Raw event</p>
              <pre className="text-xs bg-slate-50 dark:bg-slate-900 p-3 rounded-md overflow-auto text-slate-900 dark:text-white leading-relaxed">
                {JSON.stringify(event, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
