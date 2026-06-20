// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ThemeProvider } from '@/lib/theme-provider';

// theme-provider reads matchMedia for the "system" preference; happy-dom may
// not implement it, so stub a deterministic light-preference matcher.
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ThemeToggle', () => {
  it('renders a button with an accessible "Toggle theme" label', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    // This is exactly what the e2e selector getByRole('button',{name:/toggle theme/i})
    // resolves; before the fix the button had only a title, so it matched nothing.
    const button = screen.getByRole('button', { name: /toggle theme/i });
    expect(button).toBeTruthy();
  });

  it('toggles the documentElement dark class when clicked', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const button = screen.getByRole('button', { name: /toggle theme/i });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    fireEvent.click(button);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
