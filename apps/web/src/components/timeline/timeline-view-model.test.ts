import { describe, expect, it } from 'vitest';
import {
  buildTimelineView,
  getTimelineSearchText,
  type TimelineViewEntry,
} from './timeline-view-model';
import type { SessionEvent } from '@/lib/types/session-events';

function taskProgressEvent(
  timestamp: string,
  overrides: Partial<SessionEvent> = {},
): SessionEvent {
  return {
    type: 'task_progress',
    sessionId: 'session-1',
    timestamp,
    task: 'Implement feature',
    progress: 50,
    ...overrides,
  };
}

describe('getTimelineSearchText', () => {
  it('searches curated event fields instead of raw json payload keys', () => {
    const event = taskProgressEvent('2026-06-20T00:00:00.000Z', {
      data: { hiddenNeedle: 'secret-token' },
    });

    expect(getTimelineSearchText(event)).toContain('implement feature');
    expect(getTimelineSearchText(event)).not.toContain('hiddenneedle');
    expect(getTimelineSearchText(event)).not.toContain('secret-token');
  });
});

describe('buildTimelineView', () => {
  const events: SessionEvent[] = [
    { type: 'session_created', sessionId: 'session-1', timestamp: '2026-06-20T00:00:00.000Z', goal: 'Refactor auth middleware' },
    { type: 'session_started', sessionId: 'session-1', timestamp: '2026-06-20T00:00:10.000Z' },
    taskProgressEvent('2026-06-20T00:00:20.000Z'),
    { type: 'heartbeat', timestamp: '2026-06-20T00:00:30.000Z' },
    { type: 'error', sessionId: 'session-1', timestamp: '2026-06-20T00:00:40.000Z', error: 'command failed' },
  ];

  function getVisible(entries: TimelineViewEntry[]): TimelineViewEntry[] {
    return entries.filter((entry) => entry.kind === 'event');
  }

  it('preserves global numbering after filtering', () => {
    const visible = getVisible(buildTimelineView(events, { selectedType: 'task_progress', searchQuery: '' }));

    expect(visible).toHaveLength(1);
    expect(visible[0].globalIndex).toBe(2);
  });

  it('computes since previous from the real previous event in the full stream', () => {
    const visible = getVisible(buildTimelineView(events, { selectedType: '', searchQuery: 'command failed' }));

    expect(visible).toHaveLength(1);
    expect(visible[0].previousTimestamp).toBe(Date.parse('2026-06-20T00:00:30.000Z'));
  });

  it('inserts a gap indicator when filters hide events between visible items', () => {
    const gappedEvents: SessionEvent[] = [
      { type: 'session_created', sessionId: 'session-1', timestamp: '2026-06-20T00:00:00.000Z', goal: 'Refactor auth middleware' },
      taskProgressEvent('2026-06-20T00:00:10.000Z', { task: 'Capture requirements' }),
      { type: 'heartbeat', timestamp: '2026-06-20T00:00:20.000Z' },
      taskProgressEvent('2026-06-20T00:00:30.000Z', { task: 'Implement feature' }),
    ];

    const visibleAndGap = buildTimelineView(gappedEvents, { selectedType: 'task_progress', searchQuery: '' });

    expect(visibleAndGap).toHaveLength(3);
    expect(visibleAndGap[0]).toMatchObject({ kind: 'event', globalIndex: 1 });
    expect(visibleAndGap[1]).toMatchObject({ kind: 'gap', hiddenCount: 1 });
    expect(visibleAndGap[2]).toMatchObject({ kind: 'event', globalIndex: 3 });
  });

  it('matches search against curated visible details', () => {
    const visible = getVisible(buildTimelineView(events, { selectedType: '', searchQuery: 'implement feature' }));

    expect(visible).toHaveLength(1);
    expect(visible[0].event.type).toBe('task_progress');
  });

  it('does not match search terms that only appear in raw payload keys', () => {
    const withHiddenData: SessionEvent[] = [
      taskProgressEvent('2026-06-20T00:00:20.000Z', {
        data: { hiddenNeedle: 'secret-token' },
      }),
    ];

    const visible = getVisible(buildTimelineView(withHiddenData, { selectedType: '', searchQuery: 'secret-token' }));

    expect(visible).toHaveLength(0);
  });
});
