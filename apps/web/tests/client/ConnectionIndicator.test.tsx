// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConnectionIndicator } from '@/components/session/ConnectionIndicator';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

// Regression guard for "status-label drift": the connection-state -> label mapping
// in ConnectionIndicator.stateConfig must stay stable. If any label text is changed,
// the matching it.each case below turns red.
describe('ConnectionIndicator state -> label mapping', () => {
  const cases: ReadonlyArray<[state: ConnectionState, label: string]> = [
    ['open', 'Live'],
    ['connecting', 'Connecting'],
    ['closed', 'Disconnected'],
    ['error', 'Error'],
  ];

  it.each(cases)('renders "%s" state as the "%s" label', (state, label) => {
    render(<ConnectionIndicator state={state} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});
