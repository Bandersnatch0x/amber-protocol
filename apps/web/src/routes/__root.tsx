import { createRootRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TRPCProvider } from '@/lib/trpc-provider';
import { ThemeProvider } from '@/lib/theme-provider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { I18nProvider, useI18n, type I18nKey } from '@/lib/i18n';

export const Route = createRootRoute({ component: RootLayout });

const navItems = [
  { to: '/sessions', labelKey: 'nav.sessions' },
  { to: '/transcripts', labelKey: 'nav.transcripts' },
  { to: '/routes', labelKey: 'nav.routes' },
  { to: '/gates', labelKey: 'nav.gates' },
  { to: '/settings', labelKey: 'nav.settings' },
] as const;

function NavLink({ to, labelKey, compact = false }: { to: string; labelKey: I18nKey; compact?: boolean }) {
  const routerState = useRouterState();
  const { t } = useI18n();
  const isActive = routerState.location.pathname === to ||
    routerState.location.pathname.startsWith(to);

  return (
    <Link
      to={to}
      className={`
        inline-flex shrink-0 items-center ${compact ? 'px-2.5' : 'px-3'} py-2 border-b-2 text-sm font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-sm min-h-[44px]
        ${isActive
          ? 'border-blue-500 text-slate-900 dark:text-white'
          : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600'
        }
      `}
    >
      {t(labelKey)}
    </Link>
  );
}

function RootLayout() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <TRPCProvider>
          <AppShell />
        </TRPCProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

function AppShell() {
  const routerState = useRouterState();
  const { t } = useI18n();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.activeElement) {
        (document.activeElement as HTMLElement).blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
          <nav className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-40">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex justify-between h-14">
                <div className="flex items-center gap-8">
                  <Link to="/" className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-md bg-blue-600 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">A</span>
                    </div>
                    <span className="text-base font-semibold text-slate-900 dark:text-white">
                      Amber
                    </span>
                  </Link>
                  <div className="hidden sm:flex items-center gap-1">
                    {navItems.map((item) => (
                      <NavLink key={item.to} {...item} />
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <a
                    href="https://github.com/Bandersnatch0x/amber-protocol/tree/master/docs"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                  >
                    {t('nav.docs')}
                  </a>
                  <LanguageToggle />
                  <ThemeToggle />
                </div>
              </div>
            </div>
          </nav>

          {/* Mobile nav */}
          <nav aria-label={t('nav.mobile')} className="sm:hidden bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
            <div className="flex max-w-full gap-0.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {navItems.map((item) => (
                <NavLink key={item.to} {...item} compact />
              ))}
            </div>
          </nav>

          <ErrorBoundary key={routerState.location.pathname}>
            <main className="animate-fade-in">
              <Outlet />
            </main>
          </ErrorBoundary>
        </div>
  );
}
