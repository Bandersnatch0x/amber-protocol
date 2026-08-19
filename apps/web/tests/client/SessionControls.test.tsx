// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { SessionControls } from '@/components/session/SessionControls';
import { I18nProvider } from '@/lib/i18n';

const startMutateAsync = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    sessionControl: {
      start: { useMutation: () => ({ mutateAsync: startMutateAsync, isPending: false }) },
      pause: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      resume: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      abort: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider initialLanguage={'en'}>{ui}</I18nProvider>);
}

describe('SessionControls', () => {
  beforeEach(() => {
    startMutateAsync.mockReset();
  });

  it('shows only Pause and Abort for a running session', () => {
    renderWithI18n(<SessionControls sessionId={'session-1'} status={'running'} />);

    expect(screen.getByText('Pause')).toBeDefined();
    expect(screen.getByText('Abort')).toBeDefined();
    expect(screen.queryByText('Start')).toBeNull();
    expect(screen.queryByText('Resume')).toBeNull();
  });

  it('shows only Pause and Abort for an executing session', () => {
    renderWithI18n(<SessionControls sessionId={'session-1'} status={'executing'} />);

    expect(screen.getByText('Pause')).toBeDefined();
    expect(screen.getByText('Abort')).toBeDefined();
    expect(screen.queryByText('Start')).toBeNull();
    expect(screen.queryByText('Resume')).toBeNull();
  });

  it('shows only Start for an idle session', () => {
    renderWithI18n(<SessionControls sessionId={'session-1'} status={'idle'} />);

    expect(screen.getByText('Start')).toBeDefined();
    expect(screen.queryByText('Pause')).toBeNull();
    expect(screen.queryByText('Resume')).toBeNull();
    expect(screen.queryByText('Abort')).toBeNull();
  });

  it('shows Resume and Abort for a paused session', () => {
    renderWithI18n(<SessionControls sessionId={'session-1'} status={'paused'} />);

    expect(screen.getByText('Resume')).toBeDefined();
    expect(screen.getByText('Abort')).toBeDefined();
    expect(screen.queryByText('Start')).toBeNull();
    expect(screen.queryByText('Pause')).toBeNull();
  });

  it('shows no actions for a completed session', () => {
    const { container } = renderWithI18n(
      <SessionControls sessionId={'session-1'} status={'completed'} />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(container.textContent?.trim()).toBe('');
  });

  it('should show abort dialog on abort click', () => {
    renderWithI18n(<SessionControls sessionId={'session-1'} status={'running'} />);
    fireEvent.click(screen.getByText('Abort'));
    expect(screen.getByText('Abort Session?')).toBeDefined();
  });

  it('should close abort dialog on cancel', () => {
    renderWithI18n(<SessionControls sessionId={'session-1'} status={'running'} />);
    fireEvent.click(screen.getByText('Abort'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Abort Session?')).toBeNull();
  });

  it('should disable controls during loading', async () => {
    startMutateAsync.mockImplementation(() => new Promise(() => {}));
    renderWithI18n(<SessionControls sessionId={'session-1'} status={'idle'} />);
    fireEvent.click(screen.getByText('Start'));
    expect(startMutateAsync).toHaveBeenCalled();
  });

  it('shows an audit warning returned by a successful action', async () => {
    startMutateAsync.mockResolvedValue({ auditWarning: 'timeline locked' });
    renderWithI18n(<SessionControls sessionId={'session-1'} status={'idle'} />);

    fireEvent.click(screen.getByText('Start'));

    expect(await screen.findByText('Audit warning: timeline locked')).toBeDefined();
  });

  it('notifies the parent after a successful action so evidence can refresh', async () => {
    startMutateAsync.mockResolvedValue({});
    const onActionSettled = vi.fn();
    renderWithI18n(
      <SessionControls sessionId={'session-1'} status={'idle'} onActionSettled={onActionSettled} />,
    );

    fireEvent.click(screen.getByText('Start'));

    await waitFor(() => expect(onActionSettled).toHaveBeenCalledOnce());
  });

  it('shows request, manifest, and runner ACK confirmation phases after an action', async () => {
    startMutateAsync.mockResolvedValue({
      persisted: true,
      confirmed: true,
      runnerAck: {
        status: 'acked',
        requestId: 'start-request-1',
        action: 'start',
        requestedStatus: 'executing',
        source: 'test-runner',
      },
    });
    renderWithI18n(<SessionControls sessionId={'session-1'} status={'idle'} />);

    fireEvent.click(screen.getByText('Start'));

    expect(await screen.findByText('Request persisted')).toBeDefined();
    expect(screen.getByText('Manifest confirmed')).toBeDefined();
    expect(screen.getByText('Runner ACK confirmed')).toBeDefined();
  });

  it('shows a runner timeout phase without hiding persisted confirmation', async () => {
    startMutateAsync.mockResolvedValue({
      persisted: true,
      confirmed: true,
      runnerAck: {
        status: 'timeout',
        requestId: 'start-request-1',
        action: 'start',
        requestedStatus: 'executing',
        source: 'runner-ack-timeout',
        message: 'No runner ACK observed before timeout; manifest status is confirmed.',
      },
    });
    renderWithI18n(<SessionControls sessionId={'session-1'} status={'idle'} />);

    fireEvent.click(screen.getByText('Start'));

    expect(await screen.findByText('Request persisted')).toBeDefined();
    expect(screen.getByText('Manifest confirmed')).toBeDefined();
    expect(screen.getByText('Runner ACK timed out')).toBeDefined();
    expect(
      screen.getByText('No runner ACK observed before timeout; manifest status is confirmed.'),
    ).toBeDefined();
  });
});
