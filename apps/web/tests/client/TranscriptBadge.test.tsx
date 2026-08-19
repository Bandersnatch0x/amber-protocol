// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { TranscriptBadge } from '@/components/transcript/TranscriptBadge';
import { I18nProvider } from '@/lib/i18n';

function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider initialLanguage={'en'}>{ui}</I18nProvider>);
}

const TOOL_SLATE_TOKEN = 'bg-slate-100 text-slate-600';
const ASSISTANT_TOKEN = 'bg-emerald-50';

// Regression guard for #30/P3b: tool-only turns carry role "assistant" in the
// raw transcript, which used to leak the assistant emerald palette into the
// badge. The toolOnly flag must force the neutral slate tool palette.
describe('TranscriptBadge palette', () => {
  it('renders tool-only turns with the slate tool badge, not assistant green', () => {
    renderWithI18n(<TranscriptBadge role="assistant" toolOnly={true} />);
    const badge = screen.getByText('Tool call');
    expect(badge.className).toContain(TOOL_SLATE_TOKEN);
    expect(badge.className).not.toContain(ASSISTANT_TOKEN);
  });

  it('keeps the emerald palette for assistant turns with text', () => {
    renderWithI18n(<TranscriptBadge role="assistant" toolOnly={false} />);
    const badge = screen.getByText('Assistant');
    expect(badge.className).toContain(ASSISTANT_TOKEN);
  });

  it('keeps the blue palette for user turns', () => {
    renderWithI18n(<TranscriptBadge role="user" toolOnly={false} />);
    const badge = screen.getByText('User');
    expect(badge.className).toContain('bg-blue-50');
  });
});
