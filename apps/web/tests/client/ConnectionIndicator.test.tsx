// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ConnectionIndicator } from '@/components/session/ConnectionIndicator';
import { I18nProvider } from '@/lib/i18n';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider initialLanguage={'en'}>{ui}</I18nProvider>);
}

// Regression guard for status-label drift: the connection-state -> label mapping
// in ConnectionIndicator.stateConfig must stay stable. If any label text is changed,
// the matching it.each case below turns red.
describe('ConnectionIndicator state -> label mapping', () => {
  const cases: ReadonlyArray<[state: ConnectionState, label: string]> = [
    ['open', 'Live'],
    ['connecting', 'Connecting'],
    ['closed', 'Disconnected'],
    ['error', 'Error'],
  ];

  it.each(cases)('renders %s state as the %s label', (state, label) => {
    renderWithI18n(<ConnectionIndicator state={state} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});
