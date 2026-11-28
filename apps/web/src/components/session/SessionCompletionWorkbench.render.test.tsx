// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/lib/i18n';
import { SessionCompletionWorkbench } from './SessionCompletionWorkbench';

// Primary/secondary layering render coverage. The primary closing flow
// (badge, next actions, verification form, outcome) is visible by default;
// the raw evidence lists (missing/reasons/lifecycle/report) live in a
// collapsed secondary region toggled via an aria-expanded control.

function renderWorkbench(
  props: Partial<ComponentProps<typeof SessionCompletionWorkbench>> = {},
  language: 'en' | 'zh-CN' = 'en',
) {
  return render(
    <I18nProvider initialLanguage={language}>
      <SessionCompletionWorkbench
        completion={{
          status: 'fail',
          strict: true,
          reasons: ['goal present'],
          missing: ['verification'],
          text: 'Completion check status: fail\nReasons: goal present\nMissing: verification',
        }}
        lifecycle={[
          { id: 'verify', label: 'Record session verification', done: true },
          { id: 'approve', label: 'Approve the session', done: false },
        ]}
        nextActions={{
          status: 'fail',
          actions: [
            { item: 'verification', action: 'in-page', hint: 'Run verification from the console.' },
          ],
        }}
        onRunVerification={() => undefined}
        {...props}
      />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('SessionCompletionWorkbench primary/secondary layering', () => {
  it.each([
    ['en', 'This session is already completed. No further closing command is needed.'],
    ['zh-CN', '该会话已完成，无需再次执行收尾命令。'],
  ] as const)('shows completed guidance without a closing command in %s', (language, message) => {
    renderWorkbench(
      {
        completion: { status: 'pass', strict: true, missing: [] },
        nextActions: { status: 'pass', sessionCompleted: true, actions: [] },
      },
      language,
    );
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.queryByText('Ready to close')).toBeNull();
    expect(screen.queryByText('可以收尾')).toBeNull();
    expect(screen.queryByText(/amber session complete/)).toBeNull();
  });

  it('hides a residual closing command when the Session is already completed', () => {
    renderWorkbench({
      completion: { status: 'pass', strict: true, missing: [] },
      nextActions: {
        status: 'pass',
        sessionCompleted: true,
        actions: [
          {
            item: 'session-complete',
            action: 'cli-command',
            command: 'amber session complete --session completed-session',
            hint: 'Close the session.',
          },
        ],
      },
    });
    expect(
      screen.getByText('This session is already completed. No further closing command is needed.'),
    ).toBeTruthy();
    expect(screen.queryByText(/amber session complete/)).toBeNull();
  });

  it('retains missing-evidence guidance for a completed Session', () => {
    renderWorkbench({
      nextActions: {
        status: 'fail',
        sessionCompleted: true,
        actions: [
          { item: 'verification', action: 'in-page', hint: 'Run verification from the console.' },
        ],
      },
    });
    expect(screen.getByRole('button', { name: 'Go to verification form' })).toBeTruthy();
    expect(
      screen.queryByText(
        'This session is already completed. No further closing command is needed.',
      ),
    ).toBeNull();
  });

  it('shows the primary flow and keeps evidence details collapsed by default', () => {
    renderWorkbench();

    // Primary region is immediately visible.
    expect(screen.getByText('Next Actions').textContent).toBe('Next Actions');
    expect(screen.getByLabelText('Verification Command')).toBeTruthy();

    // Secondary evidence region is collapsed by default.
    const toggle = screen.getByRole('button', { name: 'Show evidence details' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Missing Evidence')).toBeNull();
    expect(screen.queryByText('Reasons')).toBeNull();
    expect(screen.queryByText('Lifecycle Checklist')).toBeNull();
  });

  it('expands the secondary region and renders localized backend evidence', () => {
    renderWorkbench();

    fireEvent.click(screen.getByRole('button', { name: 'Show evidence details' }));

    const toggle = screen.getByRole('button', { name: 'Hide evidence details' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    expect(screen.getByText('Missing Evidence')).toBeTruthy();
    expect(screen.getByText('Reasons')).toBeTruthy();
    expect(screen.getByText('Lifecycle Checklist')).toBeTruthy();
    // Backend enum strings are localized through the sessions namespace.
    expect(screen.getAllByText('Goal present').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Record session verification').length).toBeGreaterThan(0);
    expect(screen.getAllByText('complete').length).toBeGreaterThan(0);
    expect(screen.getAllByText('pending').length).toBeGreaterThan(0);
    // The "Completion check status: ..." report is re-rendered localized.
    expect(screen.getByText(/Completion check status: fail/)).toBeTruthy();
  });

  it('retains the closing command without an approval-missing banner for an unfinished passing Session', () => {
    renderWorkbench({
      completion: {
        status: 'pass',
        strict: true,
        reasons: [
          'goal present',
          'timeline present',
          'verification present',
          'approval present',
          'work present',
          'handoff present',
          'no open blockers',
        ],
        missing: [],
        text: 'Completion check status: pass',
      },
      nextActions: {
        status: 'pass',
        actions: [
          {
            item: 'session-complete',
            action: 'cli-command',
            command: 'amber session complete --session s1',
          },
        ],
      },
    });

    expect(screen.queryByText('Approval missing')).toBeNull();
    expect(screen.getByText('Ready to close')).toBeTruthy();
    expect(screen.getByText('amber session complete --session s1')).toBeTruthy();
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
  });
});
