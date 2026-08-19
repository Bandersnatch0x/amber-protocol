// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VirtualTimeline } from '@/components/session/VirtualTimeline';
import { I18nProvider } from '@/lib/i18n';
import { SessionEvent } from '@/lib/types/session-events';

const mockScrollToIndex = vi.fn();
let mockVirtualItems: Array<{ key: string; index: number; start: number; size: number }> = [];
let mockTotalSize = 0;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn((opts) => {
    // Simulate virtualization: return a subset of items based on count
    const count = opts.count || 0;
    mockTotalSize = count * (opts.estimateSize?.() || 60);

    // Simulate rendering first 3 items (overscan included)
    const visibleCount = Math.min(count, 3);
    mockVirtualItems = Array.from({ length: visibleCount }, (_, i) => ({
      key: `item-${i}`,
      index: i,
      start: i * 60,
      size: 60,
    }));

    return {
      getVirtualItems: () => mockVirtualItems,
      getTotalSize: () => mockTotalSize,
      scrollToIndex: mockScrollToIndex,
    };
  }),
}));

vi.mock('@/components/session/TimelineRow', () => ({
  TimelineRow: ({
    event,
    onClick,
  }: {
    event: SessionEvent;
    onClick?: (e: SessionEvent) => void;
  }) => (
    <div data-testid={`timeline-row-${event.type}`} onClick={() => onClick?.(event)}>
      {event.type}
    </div>
  ),
}));

function makeEvents(count: number): SessionEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'session_started' as const,
    sessionId: 'session-1',
    timestamp: Date.now() + i * 1000,
  }));
}

function renderTimeline(ui: React.ReactElement) {
  return render(<I18nProvider initialLanguage="en">{ui}</I18nProvider>);
}

describe('VirtualTimeline', () => {
  beforeEach(() => {
    mockScrollToIndex.mockClear();
    mockVirtualItems = [];
    mockTotalSize = 0;
  });

  it('should render empty state when no events', () => {
    renderTimeline(<VirtualTimeline events={[]} />);
    expect(screen.getByText('No events yet')).toBeDefined();
  });

  it('should render scroll container for events', () => {
    const { container } = renderTimeline(<VirtualTimeline events={makeEvents(3)} />);
    expect(screen.queryByText('No events yet')).toBeNull();
    expect(container.querySelector('div.overflow-auto')).not.toBeNull();
  });

  it('should render virtualized items using virtualizer data', () => {
    const events = makeEvents(5);
    renderTimeline(<VirtualTimeline events={events} />);

    // Virtualizer returns first 3 items (mock behavior)
    expect(screen.getAllByTestId(/^timeline-row-/)).toHaveLength(3);
    expect(mockTotalSize).toBe(5 * 60); // 5 events * 60px each
  });

  it('should pass correct event to TimelineRow based on virtual index', () => {
    const events: SessionEvent[] = [
      { type: 'session_started', sessionId: 's1', timestamp: 1 },
      { type: 'session_paused', sessionId: 's1', timestamp: 2 },
      { type: 'session_resumed', sessionId: 's1', timestamp: 3 },
    ];
    renderTimeline(<VirtualTimeline events={events} />);

    // First 3 virtual items map to first 3 events
    expect(screen.getByTestId('timeline-row-session_started')).toBeDefined();
    expect(screen.getByTestId('timeline-row-session_paused')).toBeDefined();
    expect(screen.getByTestId('timeline-row-session_resumed')).toBeDefined();
  });

  it('should apply absolute positioning with translateY for each virtual item', () => {
    const events = makeEvents(3);
    const { container } = renderTimeline(<VirtualTimeline events={events} />);

    const items = container.querySelectorAll('[style*="translateY"]');
    expect(items.length).toBe(3);

    // First item at top (translateY(0))
    expect(items[0].getAttribute('style')).toContain('translateY(0px)');
    // Second item offset by 60px
    expect(items[1].getAttribute('style')).toContain('translateY(60px)');
  });

  it('should invoke onClick handler when TimelineRow is clicked', () => {
    const onClick = vi.fn();
    const events: SessionEvent[] = [
      { type: 'session_started', sessionId: 's1', timestamp: 1 },
      { type: 'session_paused', sessionId: 's1', timestamp: 2 },
    ];
    renderTimeline(<VirtualTimeline events={events} onEventClick={onClick} />);

    const firstRow = screen.getByTestId('timeline-row-session_started');
    firstRow.click();

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(events[0]);
  });

  it('should auto-scroll to last item when autoScroll is true (default)', () => {
    const events = makeEvents(10);
    renderTimeline(<VirtualTimeline events={events} />);

    // autoScroll defaults to true, scrollToIndex should be called with last index
    expect(mockScrollToIndex).toHaveBeenCalledWith(9, { align: 'end' });
  });

  it('should not auto-scroll when autoScroll is false', () => {
    const events = makeEvents(10);
    renderTimeline(<VirtualTimeline events={events} autoScroll={false} />);

    expect(mockScrollToIndex).not.toHaveBeenCalled();
  });
});
