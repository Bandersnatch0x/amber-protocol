import type { SessionEvent } from '@/lib/types/session-events';
import { getTimelineEventConfig } from './timeline-config';
import { getEventSummary, parseTimestamp } from './timeline-utils';

export interface TimelineFilters {
  selectedType: string;
  searchQuery: string;
}

export interface TimelineEventEntry {
  kind: 'event';
  event: SessionEvent;
  globalIndex: number;
  previousTimestamp: number | null;
}

export interface TimelineGapEntry {
  kind: 'gap';
  hiddenCount: number;
}

export type TimelineViewEntry = TimelineEventEntry | TimelineGapEntry;

export function getTimelineSearchText(event: SessionEvent): string {
  const config = getTimelineEventConfig(event.type);
  const summary = getEventSummary(event);
  const curatedFields = [
    event.type,
    config.label,
    summary.title,
    ...summary.details.flatMap((detail) => [detail.label, detail.value]),
  ];

  return curatedFields
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

export function buildTimelineView(
  events: SessionEvent[] | undefined,
  filters: TimelineFilters,
): TimelineViewEntry[] {
  if (!events || events.length === 0) {
    return [];
  }

  const query = filters.searchQuery.trim().toLowerCase();
  const visibleIndices = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => {
      const matchesType = !filters.selectedType || event.type === filters.selectedType;
      const matchesSearch = !query || getTimelineSearchText(event).includes(query);
      return matchesType && matchesSearch;
    });

  const entries: TimelineViewEntry[] = [];
  let previousVisibleIndex: number | null = null;

  for (const { event, index } of visibleIndices) {
    if (previousVisibleIndex !== null) {
      const hiddenCount = index - previousVisibleIndex - 1;
      if (hiddenCount > 0) {
        entries.push({ kind: 'gap', hiddenCount });
      }
    }

    entries.push({
      kind: 'event',
      event,
      globalIndex: index,
      previousTimestamp: index > 0 ? parseTimestamp(events[index - 1].timestamp) : null,
    });
    previousVisibleIndex = index;
  }

  return entries;
}
