import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { useI18n } from '@/lib/i18n';
import type { SessionEvent } from '@/lib/types/session-events';
import { mergeActivityEvents, parseTimestamp } from '@/components/timeline/timeline-utils';
import { buildTimelineView } from '@/components/timeline/timeline-view-model';
import { TimelineEvent } from '@/components/timeline/TimelineEvent';

const MAX_VISIBLE = 30;

const HEALTH_WARNING_TYPES = new Set(['budget_warning']);
const HEALTH_FAILURE_TYPES = new Set(['budget_exceeded', 'stage_failed', 'verification_failed']);

export type LiveActivityState =
  | { kind: 'loading' }
  | { kind: 'empty-normal'; isLive: boolean }
  | { kind: 'empty-runner-timeout'; isLive: boolean }
  | { kind: 'has-events'; isLive: boolean };

export interface LiveActivityCardProps {
  timelineEvents: SessionEvent[];
  sseEvents: SessionEvent[];
  state: LiveActivityState;
  transcriptId?: string;
  sessionId: string;
}

export function LiveActivityCard({
  timelineEvents,
  sseEvents,
  state,
  transcriptId,
  sessionId,
}: LiveActivityCardProps) {
  const { t } = useI18n();

  const merged = useMemo(
    () => mergeActivityEvents(timelineEvents, sseEvents),
    [timelineEvents, sseEvents],
  );

  // Take last MAX_VISIBLE and reverse for newest-first display.
  const feedEvents = useMemo(() => {
    const tail = merged.slice(-MAX_VISIBLE);
    return tail.reverse();
  }, [merged]);

  const timelineEntries = useMemo(
    () => buildTimelineView(feedEvents, { selectedType: '', searchQuery: '' }),
    [feedEvents],
  );

  const startTime = useMemo(() => {
    if (merged.length === 0) return null;
    return parseTimestamp(merged[0]!.timestamp);
  }, [merged]);

  const isLive = state.kind !== 'loading' && state.isLive;

  const isEmpty = feedEvents.length === 0;

  function healthBorderClass(event: SessionEvent): string {
    if (HEALTH_FAILURE_TYPES.has(event.type)) return 'border-l-2 border-l-red-500';
    if (HEALTH_WARNING_TYPES.has(event.type)) return 'border-l-2 border-l-amber-500';
    return '';
  }

  return (
    <section className="card p-5" data-testid="live-activity-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="section-title">{t('sessions.live.title')}</h2>
            {isLive && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {t('sessions.live.badge')}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('sessions.live.detail')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {transcriptId && (
            <Link
              to="/transcripts/$id"
              params={{ id: transcriptId }}
              className="btn-secondary text-sm"
            >
              {t('sessions.live.viewTranscript')}
            </Link>
          )}
          <Link
            to="/sessions/$id/timeline"
            params={{ id: sessionId }}
            className="btn-primary text-sm"
          >
            {t('sessions.detail.viewTimeline')}
          </Link>
        </div>
      </div>

      {state.kind === 'loading' ? (
        <div className="mt-4 animate-pulse space-y-3" aria-hidden="true">
          <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
        </div>
      ) : isEmpty ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center dark:border-slate-700 dark:bg-slate-900">
          {state.kind === 'empty-runner-timeout' ? (
            <>
              <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                {t('sessions.live.runnerTimeout')}
              </span>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                {t('sessions.live.emptyNoRunner')}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('sessions.live.empty')}</p>
          )}
        </div>
      ) : (
        <>
          {merged.length > MAX_VISIBLE && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {t('sessions.live.recent', { count: MAX_VISIBLE })}
            </p>
          )}
          <div className="mt-3 space-y-3" data-testid="live-activity-feed">
            {timelineEntries.map((entry, index) => {
              if (entry.kind === 'gap') return null;
              const key =
                'id' in entry.event && entry.event.id
                  ? (entry.event.id as string)
                  : `${entry.event.type}-${entry.event.timestamp}-${entry.globalIndex}`;
              const borderClass = healthBorderClass(entry.event);
              return (
                <div key={key} className={borderClass}>
                  <TimelineEvent
                    event={entry.event}
                    displayIndex={entry.globalIndex}
                    previousTimestamp={entry.previousTimestamp}
                    startTime={startTime}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
