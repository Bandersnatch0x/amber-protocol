// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider, detectInitialLanguage, interpolate, useI18n } from '@/lib/i18n';
import { LanguageToggle } from '@/components/LanguageToggle';

const zhSessions = String.fromCharCode(0x4f1a, 0x8bdd);
const zhGateCount = `3 ${String.fromCharCode(0x4e2a, 0x5173, 0x5361)}`;
const zhLanguageName = String.fromCharCode(0x4e2d, 0x6587);

function Probe() {
  const { language, t } = useI18n();
  return (
    <div>
      <p data-testid="language">{language}</p>
      <p>{t('nav.sessions')}</p>
      <p>{t('gates.count', { count: 3 })}</p>
    </div>
  );
}

describe('i18n', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = '';
  });

  it('detects Chinese browser locales and otherwise falls back to English', () => {
    expect(detectInitialLanguage({ stored: null, browserLanguage: 'zh-CN' })).toBe('zh-CN');
    expect(detectInitialLanguage({ stored: null, browserLanguage: 'zh-Hans' })).toBe('zh-CN');
    expect(detectInitialLanguage({ stored: null, browserLanguage: 'en-US' })).toBe('en');
  });

  it('prefers a stored supported language over browser language', () => {
    expect(detectInitialLanguage({ stored: 'en', browserLanguage: 'zh-CN' })).toBe('en');
    expect(detectInitialLanguage({ stored: 'zh-CN', browserLanguage: 'en-US' })).toBe('zh-CN');
    expect(detectInitialLanguage({ stored: 'fr', browserLanguage: 'en-US' })).toBe('en');
  });

  it('interpolates named values in translated strings', () => {
    expect(interpolate('Showing {visible} of {total} gates.', { visible: 12, total: 30 })).toBe(
      'Showing 12 of 30 gates.',
    );
  });

  it('provides translations and updates document language', () => {
    localStorage.setItem('amber-web-language', 'zh-CN');

    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('language').textContent).toBe('zh-CN');
    expect(screen.getByText(zhSessions)).toBeTruthy();
    expect(screen.getByText(zhGateCount)).toBeTruthy();
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('toggles language, persists it, and keeps an accessible label', () => {
    render(
      <I18nProvider initialLanguage="en">
        <LanguageToggle />
        <Probe />
      </I18nProvider>,
    );

    const button = screen.getByRole('button', { name: /switch language/i });
    expect(button.textContent).toContain(zhLanguageName);
    fireEvent.click(button);

    expect(screen.getByTestId('language').textContent).toBe('zh-CN');
    expect(localStorage.getItem('amber-web-language')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
