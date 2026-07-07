import { useState } from 'react';
import { EventIcon } from './EventIcon';
import { formatEventTimestamp, formatDuration, getEventSummary, parseTimestamp } from './timeline-utils';
import type { SessionEvent } from '@/lib/types/session-events';
import { CodeBlock } from '@/components/code/CodeBlock';
import { useI18n, type I18nKey } from '@/lib/i18n';

interface TimelineEventProps {
  event: SessionEvent;
  displayIndex: number;
  previousTimestamp: number | null;
  startTime: number | null;
}

export function TimelineEvent({ event, displayIndex, previousTimestamp, startTime }: TimelineEventProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const eventLabel = t(`timeline.event.${event.type}` as I18nKey);
  const summary = getEventSummary(event);
  const timestamp = parseTimestamp(event.timestamp);

  const offset = startTime !== null && timestamp !== null ? timestamp - startTime : null;
  const interval = previousTimestamp !== null && timestamp !== null ? timestamp - previousTimestamp : null;

  return (
    <div className="flex gap-4 group">
      <div className="relative flex flex-col items-center">
        <EventIcon type={event.type} />
        <div className="mt-2 w-px flex-1 bg-slate-200 dark:bg-slate-700 group-last:hidden" />
      </div>

      <div className="flex-1 pb-8">
        <div className="card-hover p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  #{displayIndex + 1}
                </span>
                <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {eventLabel}
                </span>
              </div>
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {summary.title || eventLabel}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{formatEventTimestamp(event.timestamp)}</p>
            </div>

            <button
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              aria-controls={`event-detail-${displayIndex}`}
              className="text-sm text-blue-600 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-blue-400 rounded"
            >
              {expanded ? t('timeline.hideRaw') : t('timeline.viewRaw')}
            </button>
          </div>

          <div className="mb-3 flex flex-wrap gap-2">
            {offset !== null && (
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {t('timeline.fromStart', { duration: formatDuration(offset) })}
              </span>
            )}
            {interval !== null && (
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                {t('timeline.sincePrevious', { duration: formatDuration(interval) })}
              </span>
            )}
          </div>

          {summary.details.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {summary.details.map((detail, index) => (
                <div key={`${detail.label}-${index}`}>
                  <dt className="label">{detail.label}</dt>
                  <dd className="value break-words">{detail.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {expanded && (
            <div id={`event-detail-${displayIndex}`} className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
              <p className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">{t('timeline.rawEvent')}</p>
              <CodeBlock code={JSON.stringify(event, null, 2)} language="json" title="event.json" collapseAfterLines={18} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
