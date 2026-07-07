import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBadge } from '@/components/session/StatusBadge';
import { filterAndSortSessions } from '@/features/sessions/sessions-view-model';
import { useI18n, type I18nKey } from '@/lib/i18n';

export const Route = createFileRoute('/sessions/')({ component: SessionsPage });

const statusOptions = [
  { value: '', labelKey: 'sessions.status.all' },
  { value: 'idle', labelKey: 'sessions.status.idle' },
  { value: 'running', labelKey: 'sessions.status.running' },
  { value: 'executing', labelKey: 'sessions.status.executing' },
  { value: 'paused', labelKey: 'sessions.status.paused' },
  { value: 'completed', labelKey: 'sessions.status.completed' },
  { value: 'aborted', labelKey: 'sessions.status.aborted' },
  { value: 'failed', labelKey: 'sessions.status.failed' },
] as const;

function formatLatestActivity(value: string | undefined, unknownLabel: string): string {
  if (!value) return unknownLabel;
  return new Date(value).toLocaleString();
}

function budgetText(session: {
  budget?: { maxTokens: number; tokensUsed?: number };
}, t: (key: I18nKey, params?: Record<string, string | number>) => string): string | null {
  if (!session.budget) return null;
  return t('sessions.tokens', {
    used: (session.budget.tokensUsed ?? 0).toLocaleString(),
    max: session.budget.maxTokens.toLocaleString(),
  });
}

function SessionsPage() {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { data: sessions, isLoading, error, refetch } = trpc.session.list.useQuery();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.key === '/'
        && !(event.target instanceof HTMLInputElement)
        && !(event.target instanceof HTMLTextAreaElement)
        && !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const filteredSessions = useMemo(
    () => filterAndSortSessions(Array.isArray(sessions) ? sessions : [], searchQuery, statusFilter),
    [sessions, searchQuery, statusFilter],
  );

  const hasActiveFilters = Boolean(searchQuery.trim() || statusFilter);

  return (
    <div className="page-container space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">{t('sessions.title')}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {Array.isArray(sessions)
            ? t(filteredSessions.length === 1 ? 'sessions.countOne' : 'sessions.count', { count: filteredSessions.length })
            : t('sessions.loading')}
        </p>
      </header>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <input
            ref={searchRef}
            type="text"
            placeholder={t('sessions.searchPlaceholder')}
            aria-label={t('sessions.searchAria')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder-slate-400"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 dark:text-slate-500">/</span>
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label={t('sessions.filterAria')}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white sm:max-w-[220px]"
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((index) => (
            <div key={index} className="card p-5 animate-pulse">
              <div className="space-y-3">
                <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-5 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card p-5">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">{t('sessions.failed')}</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{error.message}</p>
          <button onClick={() => refetch()} className="btn-secondary mt-4 text-sm">
            {t('common.retry')}
          </button>
        </div>
      )}

      {!isLoading && !error && filteredSessions.length === 0 && (
        <div className="card p-12 text-center">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            {hasActiveFilters ? t('sessions.empty.filtered.title') : t('sessions.empty.all.title')}
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {hasActiveFilters
              ? t('sessions.empty.filtered.detail')
              : t('sessions.empty.all.detail')}
          </p>
        </div>
      )}

      {!isLoading && !error && filteredSessions.length > 0 && (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
          {filteredSessions.map((session) => {
            const latestActivity = session.updatedAt ?? session.createdAt;
            const budget = budgetText(session, t);

            return (
              <Link
                key={session.id}
                to="/sessions/$id"
                params={{ id: session.id }}
                className="block px-5 py-4 transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <StatusBadge status={session.status} />
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{session.id.slice(0, 8)}</span>
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{session.route.id}</span>
                    </div>
                    <h2 className="truncate text-sm font-medium text-slate-900 dark:text-white sm:text-base">{session.goal}</h2>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span>{t('sessions.lastActivity', { time: formatLatestActivity(latestActivity, t('sessions.unknown')) })}</span>
                      {budget && <span>{budget}</span>}
                    </div>
                  </div>
                  <svg aria-hidden="true" className="mt-1 h-4 w-4 flex-shrink-0 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
