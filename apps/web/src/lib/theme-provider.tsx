import { createContext, useCallback, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light' | 'system';
type ResolvedTheme = 'dark' | 'light';

interface ThemeContextValue {
  theme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'theme';
const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function resolveTheme(stored: Theme): ResolvedTheme {
  if (stored === 'dark' || stored === 'light') return stored;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia(COLOR_SCHEME_QUERY).matches ? 'dark' : 'light';
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system';
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
  return 'system';
}

function applyDOMTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
}

function suppressTransitions(): void {
  const root = document.documentElement;
  root.classList.add('[&_*]:!transition-none');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('[&_*]:!transition-none');
    });
  });
}

interface ThemeProviderProps {
  children: React.ReactNode;
  attribute?: string;
  defaultTheme?: Theme;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
}

export function ThemeProvider({
  children,
  attribute = 'class',
  defaultTheme: _defaultTheme = 'system',
  disableTransitionOnChange = true,
}: ThemeProviderProps) {
  // Client-only SPA (no SSR): resolve once during the first render instead of
  // hydrating through a mount effect.
  const [theme, setThemeState] = useState<ResolvedTheme>(() => resolveTheme(readStoredTheme()));

  // Keep the DOM class token in sync with the resolved theme.
  useEffect(() => {
    if (attribute === 'class') {
      applyDOMTheme(theme);
    }
  }, [theme, attribute]);

  // Listen for system preference changes when stored theme is "system"
  useEffect(() => {
    const stored = readStoredTheme();
    if (stored !== 'system') return;

    const mql = window.matchMedia(COLOR_SCHEME_QUERY);
    const handler = (e: MediaQueryListEvent) => {
      const resolved: ResolvedTheme = e.matches ? 'dark' : 'light';
      setThemeState(resolved);
      if (attribute === 'class') {
        suppressTransitions();
        applyDOMTheme(resolved);
      }
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [attribute]);

  const setTheme = useCallback(
    (next: Theme) => {
      const resolved = resolveTheme(next);
      setThemeState(resolved);
      localStorage.setItem(STORAGE_KEY, next);
      if (attribute === 'class') {
        if (disableTransitionOnChange) suppressTransitions();
        applyDOMTheme(resolved);
      }
    },
    [attribute, disableTransitionOnChange],
  );

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
