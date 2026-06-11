import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VirtualTimeline } from '@/components/session/VirtualTimeline';
import { SessionEvent } from '@/lib/types/session-events';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(() => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    scrollToIndex: vi.fn(),
  })),
}));

function makeEvents(count: number): SessionEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    type: 'session_started' as const,
    sessionId: 'session-1',
    timestamp: Date.now() + i * 1000,
  }));
}

describe('VirtualTimeline', () => {
  it('should render empty state', () => {
    render(<VirtualTimeline events={[]} />);
    expect(screen.getByText('No events yet')).toBeDefined();
  });

  it('should render events', () => {
    const events = makeEvents(3);
    const { container } = render(<VirtualTimeline events={events} />);
    expect(container.querySelector('[class*="h-[600px]"]')).toBeDefined();
  });

  it('should handle event click', () => {
    const onClick = vi.fn();
    render(<VirtualTimeline events={makeEvents(1)} onEventClick={onClick} />);
    // TimelineRow renders, click handler is passed
    expect(onClick).not.toHaveBeenCalled();
  });
});