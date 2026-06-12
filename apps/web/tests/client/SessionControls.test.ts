import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionControls } from '@/components/session/SessionControls';

vi.mock('@/lib/hooks/useSessionEvents', () => ({
  useSessionEvents: () => ({
    status: 'running',
    connectionState: 'open',
    lastEvent: null,
    error: null,
    events: [],
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sessionControl: {
      start: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      pause: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      resume: { useMutation: () => ({ mutateAsync: vi.fn() }) },
      abort: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));

describe('SessionControls', () => {
  it('should render control buttons', () => {
    render(<SessionControls sessionId="session-1" />);
    expect(screen.getByText('Pause')).toBeDefined();
    expect(screen.getByText('Abort')).toBeDefined();
  });

  it('should disable start when running', () => {
    render(<SessionControls sessionId="session-1" />);
    expect(screen.getByText('Start')).toBeDisabled();
    expect(screen.getByText('Pause')).not.toBeDisabled();
  });

  it('should disable pause when not running', () => {
    vi.mocked(require('@/lib/hooks/useSessionEvents').useSessionEvents).mockReturnValue({
      status: 'idle',
      connectionState: 'open',
      lastEvent: null,
      error: null,
      events: [],
    });

    render(<SessionControls sessionId="session-1" />);
    expect(screen.getByText('Start')).not.toBeDisabled();
    expect(screen.getByText('Pause')).toBeDisabled();
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
    const mutateAsync = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.mocked(require('@/lib/trpc').trpc.sessionControl.start.useMutation).mockReturnValue({ mutateAsync });

    vi.mocked(require('@/lib/hooks/useSessionEvents').useSessionEvents).mockReturnValue({
      status: 'idle',
      connectionState: 'open',
      lastEvent: null,
      error: null,
      events: [],
    });

    render(<SessionControls sessionId="session-1" />);
    fireEvent.click(screen.getByText('Start'));
    expect(screen.getByText('Loading...')).toBeDefined();
  });
});