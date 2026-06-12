// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionControls } from '@/components/session/SessionControls';
import { useSessionEvents } from '@/lib/hooks/useSessionEvents';

vi.mock('@/lib/hooks/useSessionEvents', () => ({
  useSessionEvents: vi.fn(),
}));

const startMutateAsync = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sessionControl: {
      start: { useMutation: () => ({ mutateAsync: startMutateAsync }) },
      pause: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      resume: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      abort: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));

function mockStatus(status: string | null) {
  vi.mocked(useSessionEvents).mockReturnValue({
    status,
    connectionState: 'open',
    lastEvent: null,
    error: null,
    events: [],
  } as ReturnType<typeof useSessionEvents>);
}

function button(name: string): HTMLButtonElement {
  return screen.getByText(name) as HTMLButtonElement;
}

describe('SessionControls', () => {
  beforeEach(() => {
    startMutateAsync.mockReset();
    mockStatus('running');
  });

  it('should render control buttons', () => {
    render(<SessionControls sessionId="session-1" />);
    expect(screen.getByText('Pause')).toBeDefined();
    expect(screen.getByText('Abort')).toBeDefined();
  });

  it('should disable start when running', () => {
    render(<SessionControls sessionId="session-1" />);
    expect(button('Start').disabled).toBe(true);
    expect(button('Pause').disabled).toBe(false);
  });

  it('should disable pause when not running', () => {
    mockStatus('idle');
    render(<SessionControls sessionId="session-1" />);
    expect(button('Start').disabled).toBe(false);
    expect(button('Pause').disabled).toBe(true);
  });

  it('should show abort dialog on abort click', () => {
    render(<SessionControls sessionId="session-1" />);
    fireEvent.click(screen.getByText('Abort'));
    expect(screen.getByText('Abort Session?')).toBeDefined();
  });

  it('should close abort dialog on cancel', () => {
    render(<SessionControls sessionId="session-1" />);
    fireEvent.click(screen.getByText('Abort'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Abort Session?')).toBeNull();
  });

  it('should disable controls during loading', () => {
    startMutateAsync.mockImplementation(() => new Promise(() => {}));
    mockStatus('idle');

    render(<SessionControls sessionId="session-1" />);
    fireEvent.click(screen.getByText('Start'));
    expect(screen.getByText('Loading...')).toBeDefined();
  });
});
