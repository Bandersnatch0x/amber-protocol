'use client';

import { useRef, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { SessionEvent } from '@/lib/types/session-events';
import { TimelineRow } from './TimelineRow';

interface VirtualTimelineProps {
  events: SessionEvent[];
  onEventClick?: (event: SessionEvent) => void;
  autoScroll?: boolean;
}

export function VirtualTimeline({ events, onEventClick, autoScroll = true }: VirtualTimelineProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 5,
  });

  useEffect(() => {
    if (autoScroll && events.length > 0 && parentRef.current) {
      const isNearBottom = parentRef.current.scrollHeight - parentRef.current.scrollTop - parentRef.current.clientHeight < 200;

      if (isNearBottom) {
        virtualizer.scrollToIndex(events.length - 1, { align: 'end' });
      }
    }
  }, [events.length, autoScroll, virtualizer]);

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 dark:text-gray-400">
        No events yet
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-[600px] overflow-auto border rounded dark:border-gray-700">
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
            <TimelineRow
              event={events[virtualItem.index]}
              onClick={onEventClick}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
