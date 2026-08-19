// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import {
  LiveActivityCard,
  type LiveActivityCardProps,
} from '@/components/session/LiveActivityCard';
import { I18nProvider } from '@/lib/i18n';
import type { SessionEvent } from '@/lib/types/session-events';
import { mergeActivityEvents } from '@/components/timeline/timeline-utils';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  createLazyFileRoute: () => ({ component: () => null }),
}));

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider initialLanguage={'en'}>{ui}</I18nProvider>);
}

function makeEvent(type: SessionEvent['type'], timestamp: number): SessionEvent {
  return { type, timestamp } as SessionEvent;
}

function renderCard(overrides: Partial<LiveActivityCardProps> = {}) {
  const defaults: LiveActivityCardProps = {
    timelineEvents: [],
    sseEvents: [],
    state: { kind: 'empty-normal', isLive: false },
    sessionId: 's1',
  };
  return renderWithI18n(<LiveActivityCard {...defaults} {...overrides} />);
}

describe('LiveActivityCard', () => {
  it('renders events newest-first', () => {
    const events: SessionEvent[] = [
      makeEvent('session_started', 1000),
      makeEvent('session_paused', 2000),
      makeEvent('session_resumed', 3000),
    ];
    renderCard({ timelineEvents: events, state: { kind: 'has-events', isLive: false } });

    // Events should be present — the newest (session_resumed) should appear
    // before the oldest (session_started) in the document.
    const labels = screen.getAllByText(/Session (Started|Paused|Resumed)/);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    // Newest first: "Session Resumed" appears before "Session Started"
    const resumedIndex = labels.findIndex((el) => el.textContent === 'Session Resumed');
    const startedIndex = labels.findIndex((el) => el.textContent === 'Session Started');
    expect(resumedIndex).toBeLessThan(startedIndex);
  });

  it('shows Live badge when isLive=true', () => {
    renderCard({ state: { kind: 'empty-normal', isLive: true } });
    expect(screen.getByText('Live')).toBeDefined();
  });

  it('does not show Live badge when isLive=false', () => {
    renderCard({ state: { kind: 'empty-normal', isLive: false } });
    expect(screen.queryByText('Live')).toBeNull();
  });

  it('shows empty state with normal message', () => {
    renderCard({ state: { kind: 'empty-normal', isLive: false } });
    expect(screen.getByText('No activity recorded yet.')).toBeDefined();
  });

  it('shows runner-timeout empty state when hasRunnerTimeout=true', () => {
    renderCard({ state: { kind: 'empty-runner-timeout', isLive: false } });
    expect(screen.getByText('Runner timed out')).toBeDefined();
    expect(
      screen.getByText(
        'No runner attached — activity will not be generated until an agent session starts the runner.',
      ),
    ).toBeDefined();
  });

  it('applies colored left border for health failure events', () => {
    const events: SessionEvent[] = [makeEvent('stage_failed', 1000)];
    const { container } = renderCard({
      timelineEvents: events,
      state: { kind: 'has-events', isLive: false },
    });
    const failureEl = container.querySelector('.border-l-red-500');
    expect(failureEl).not.toBeNull();
  });

  it('applies amber left border for budget warning events', () => {
    const events: SessionEvent[] = [makeEvent('budget_warning', 1000)];
    const { container } = renderCard({
      timelineEvents: events,
      state: { kind: 'has-events', isLive: false },
    });
    const warningEl = container.querySelector('.border-l-amber-500');
    expect(warningEl).not.toBeNull();
  });

  it('shows loading skeleton when isLoading=true', () => {
    const { container } = renderCard({ state: { kind: 'loading' } });
    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).not.toBeNull();
  });
});

describe('mergeActivityEvents', () => {
  it('deduplicates by type+timestamp', () => {
    const timeline: SessionEvent[] = [makeEvent('session_started', 1000)];
    const sse: SessionEvent[] = [makeEvent('session_started', 1000)];
    const result = mergeActivityEvents(timeline, sse);
    expect(result).toHaveLength(1);
  });

  it('filters heartbeats from SSE events', () => {
    const timeline: SessionEvent[] = [];
    const sse: SessionEvent[] = [makeEvent('heartbeat', 1000), makeEvent('session_started', 2000)];
    const result = mergeActivityEvents(timeline, sse);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('session_started');
  });

  it('returns events sorted ascending by timestamp', () => {
    const timeline: SessionEvent[] = [
      makeEvent('session_paused', 3000),
      makeEvent('session_started', 1000),
    ];
    const sse: SessionEvent[] = [makeEvent('session_resumed', 2000)];
    const result = mergeActivityEvents(timeline, sse);
    expect(result).toHaveLength(3);
    expect(result[0]!.type).toBe('session_started');
    expect(result[1]!.type).toBe('session_resumed');
    expect(result[2]!.type).toBe('session_paused');
  });

  it('merges unique SSE events not in timeline', () => {
    const timeline: SessionEvent[] = [makeEvent('session_started', 1000)];
    const sse: SessionEvent[] = [makeEvent('session_paused', 2000)];
    const result = mergeActivityEvents(timeline, sse);
    expect(result).toHaveLength(2);
  });
});
