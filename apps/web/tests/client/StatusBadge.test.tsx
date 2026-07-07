// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { StatusBadge } from '@/components/session/StatusBadge';
import { I18nProvider } from '@/lib/i18n';

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider initialLanguage={'en'}>{ui}</I18nProvider>);
}

// Regression guard for status-label drift: the status -> display-label mapping
// in StatusBadge.statusConfig must stay stable. If any label text is changed,
// the matching it.each case below turns red. Update these assertions only when
// the product label is meant to change.
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

  it.each(cases)('renders %s status as the %s label', (status, label) => {
    renderWithI18n(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it('renders a -- placeholder when status is null', () => {
    renderWithI18n(<StatusBadge status={null} />);
    expect(screen.getByText('--')).toBeTruthy();
  });

  it('falls back to a title-cased label for an unknown status', () => {
    renderWithI18n(<StatusBadge status={'mystery'} />);
    expect(screen.getByText('Mystery')).toBeTruthy();
  });
});
