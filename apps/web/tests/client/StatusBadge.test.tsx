// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '@/components/session/StatusBadge';

// Regression guard for "status-label drift": the status -> display-label mapping
// in StatusBadge.statusConfig must stay stable. If any label text is changed,
// the matching it.each case below turns red. Do NOT relax these assertions to
// make a label edit pass — update them only when the product label is meant to change.
describe('StatusBadge status -> label mapping', () => {
  const cases: ReadonlyArray<[status: string, label: string]> = [
    ['idle', 'Idle'],
    ['running', 'Running'],
    ['paused', 'Paused'],
    ['completed', 'Completed'],
    ['aborted', 'Aborted'],
    ['created', 'Created'],
    ['failed', 'Failed'],
  ];

  it.each(cases)('renders "%s" status as the "%s" label', (status, label) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('renders a "--" placeholder when status is null', () => {
    render(<StatusBadge status={null} />);
    expect(screen.getByText('--')).toBeTruthy();
  });

  it('falls back to the raw status text for an unknown status', () => {
    render(<StatusBadge status="mystery" />);
    expect(screen.getByText('mystery')).toBeTruthy();
  });
});
