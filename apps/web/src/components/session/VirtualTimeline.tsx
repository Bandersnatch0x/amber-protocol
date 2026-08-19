import { useRef, useEffect, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SessionEvent } from '@/lib/types/session-events';
import { useI18n } from '@/lib/i18n';
import { TimelineRow } from './TimelineRow';

interface VirtualTimelineProps {
  events: SessionEvent[];
  onEventClick?: (event: SessionEvent) => void;
  autoScroll?: boolean;
}

export function VirtualTimeline({ events, onEventClick, autoScroll = true }: VirtualTimelineProps) {
  const { t } = useI18n();
  const parentRef = useRef<HTMLDivElement>(null);
  const [showScrollControls, setShowScrollControls] = useState(false);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  useEffect(() => {
    if (autoScroll && events.length > 0 && parentRef.current) {
      const isNearBottom =
        parentRef.current.scrollHeight -
          parentRef.current.scrollTop -
          parentRef.current.clientHeight <
        200;

      if (isNearBottom) {
        virtualizer.scrollToIndex(events.length - 1, { align: 'end' });
      }
    }
  }, [events.length, autoScroll, virtualizer]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    const handleScroll = () => {
      if (el.scrollHeight > el.clientHeight + 100) {
        setShowScrollControls(true);
      } else {
        setShowScrollControls(false);
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [events.length]);

  if (events.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-slate-500 dark:text-slate-400">
        {t('sessions.timeline.empty')}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={parentRef}
        className="h-[600px] overflow-auto rounded border border-slate-200 dark:border-slate-700"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => (
            <div
              key={virtualItem.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <TimelineRow event={events[virtualItem.index]} onClick={onEventClick} />
            </div>
          ))}
        </div>
      </div>

      {showScrollControls && events.length > 10 && (
        <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 z-10">
          <button
            type="button"
            onClick={() => virtualizer.scrollToIndex(0, { align: 'start' })}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <svg
              aria-hidden="true"
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
            {t('sessions.timeline.jumpToTop')}
          </button>
          <button
            type="button"
            onClick={() => virtualizer.scrollToIndex(events.length - 1, { align: 'end' })}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <svg
              aria-hidden="true"
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
            {t('sessions.timeline.jumpToLatest')}
          </button>
        </div>
      )}
    </div>
  );
}
