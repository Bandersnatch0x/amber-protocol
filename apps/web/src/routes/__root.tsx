import { createRootRoute, Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { TRPCProvider } from '@/lib/trpc-provider';
import { ThemeProvider } from '@/lib/theme-provider';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { I18nProvider, useI18n, type I18nKey } from '@/lib/i18n';
import { SettingsProvider } from '@/lib/settings-provider';

export const Route = createRootRoute({ component: RootLayout });

const navItems = [
  { to: '/sessions', labelKey: 'nav.sessions' },
  { to: '/gates', labelKey: 'nav.gates' },
  { to: '/transcripts', labelKey: 'nav.transcripts' },
  { to: '/routes', labelKey: 'nav.routes' },
  { to: '/governance', labelKey: 'nav.governance' },
  { to: '/knowledge', labelKey: 'nav.knowledge' },
  { to: '/settings', labelKey: 'nav.settings' },
] as const;

function NavLink({
  to,
  labelKey,
  compact = false,
}: {
  to: string;
  labelKey: I18nKey;
  compact?: boolean;
}) {
  const routerState = useRouterState();
  const { t } = useI18n();
  const isActive =
    routerState.location.pathname === to || routerState.location.pathname.startsWith(to);

  return (
    <Link
      to={to}
      className={`
        relative inline-flex shrink-0 items-center ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2'} text-xs font-medium transition-all duration-150 rounded-md
        ${
          isActive
            ? 'text-amber-gold font-semibold bg-amber-500/10 dark:bg-amber-muted/60'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-obsidian-surface'
        }
      `}
    >
      <span>{t(labelKey)}</span>
      {isActive && !compact && (
        <span className="absolute bottom-0 left-2 right-2 h-[2px] bg-amber-gold shadow-glow-amber rounded-full" />
      )}
    </Link>
  );
}

function RootLayout() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <SettingsProvider>
          <TRPCProvider>
            <AppShell />
          </TRPCProvider>
        </SettingsProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}

function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const actions = [
    { label: '审查待决闸门 (Review Gates)', path: '/gates', shortcut: 'G' },
    { label: '查看活跃会话 (View Sessions)', path: '/sessions', shortcut: 'S' },
    { label: '时序与日志 (Transcripts)', path: '/transcripts', shortcut: 'T' },
    { label: '工作流路由 (Routes)', path: '/routes', shortcut: 'W' },
    { label: '治理评分与健康度 (Governance)', path: '/governance', shortcut: 'R' },
    { label: '知识与决策地图 (Knowledge Map)', path: '/knowledge', shortcut: 'K' },
  ];

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm z-50 flex items-start justify-center pt-24">
      <div className="bg-white dark:bg-obsidian-elevated rounded-xl border border-slate-200 dark:border-obsidian-border w-full max-w-lg shadow-floating-command dark:shadow-floating-command-dark overflow-hidden animate-fade-in">
        <div className="p-3 border-b border-slate-200 dark:border-obsidian-border flex items-center gap-2.5">
          <svg
            className="w-4 h-4 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="快速跳转页面或执行治理指令..."
            className="w-full bg-transparent border-none text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-0 font-body"
          />
          <kbd
            onClick={onClose}
            className="cursor-pointer text-[10px] font-mono bg-slate-100 dark:bg-obsidian-inset text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 dark:border-obsidian-border"
          >
            ESC
          </kbd>
        </div>
        <div className="p-2 space-y-1 text-xs">
          <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-400">
            导航快捷项
          </div>
          {filtered.map((action) => (
            <div
              key={action.path}
              onClick={() => {
                navigate({ to: action.path });
                onClose();
              }}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-obsidian-surface text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer transition-colors"
            >
              <span>{action.label}</span>
              <kbd className="font-mono text-[10px] text-slate-400 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-obsidian-inset border border-slate-200 dark:border-obsidian-border">
                {action.shortcut}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  const routerState = useRouterState();
  const { t } = useI18n();
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && document.activeElement) {
        (document.activeElement as HTMLElement).blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 dark:bg-obsidian-void text-slate-900 dark:text-slate-100 transition-colors duration-200">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-amber-gold focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
      >
        {t('nav.skipToContent')}
      </a>

      {/* Main Top Navigation Bar (Spacious Dual Theme Craft) */}
      <header className="sticky top-0 z-40 h-12 border-b border-slate-200 dark:border-obsidian-border bg-white/95 dark:bg-obsidian-void/95 backdrop-blur-xl px-4 sm:px-6 flex items-center justify-between">
        {/* Left: Minimalist Workspace Brand */}
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-6 h-6 rounded-md bg-amber-gold flex items-center justify-center text-slate-950 font-headline font-bold text-xs shadow-glow-amber">
              A
            </div>
            <span className="font-headline font-semibold text-xs text-slate-900 dark:text-white tracking-tight group-hover:text-amber-gold transition-colors">
              amber-protocol
            </span>
          </Link>
          <span className="hidden sm:inline-block text-xs font-mono text-slate-500 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-obsidian-surface border border-slate-200 dark:border-obsidian-border/60">
            main
          </span>
        </div>

        {/* Center: Clean & Airy Navigation Links */}
        <nav className="hidden md:flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => (
            <NavLink key={item.to} {...item} />
          ))}
        </nav>

        {/* Right: Search bar, Live status, Language & Theme Toggle */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setCmdOpen(true)}
            className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-obsidian-surface hover:bg-slate-200 dark:hover:bg-obsidian-elevated border border-slate-200 dark:border-obsidian-border/80 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-all"
          >
            <span className="text-[11px]">快速查找...</span>
            <kbd className="px-1 py-0.2 rounded bg-white dark:bg-obsidian-inset text-[10px] font-mono text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-obsidian-border">
              ⌘K
            </kbd>
          </button>

          <div
            className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono text-slate-500 dark:text-slate-400"
            title="实时连接正常"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-700 dark:text-slate-300 font-medium">Live</span>
          </div>

          <a
            href="https://github.com/Bandersnatch0x/amber-protocol/tree/master/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden text-xs text-slate-500 hover:text-slate-700 focus:outline-none rounded sm:inline dark:text-slate-400 dark:hover:text-slate-200"
          >
            {t('nav.docs')}
          </a>

          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>

      {/* Mobile nav */}
      <nav
        aria-label={t('nav.mobile')}
        className="overflow-x-hidden border-b border-slate-200 bg-white dark:border-obsidian-border dark:bg-obsidian-surface md:hidden"
      >
        <div className="flex w-full max-w-full gap-1 overflow-x-auto overscroll-x-contain px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map((item) => (
            <NavLink key={item.to} {...item} compact />
          ))}
        </div>
      </nav>

      <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} />

      <ErrorBoundary key={routerState.location.pathname}>
        <main id="main" className="animate-fade-in">
          <Outlet />
        </main>
      </ErrorBoundary>
    </div>
  );
}
