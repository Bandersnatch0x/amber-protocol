import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n, type I18nKey } from '@/lib/i18n';

export const Route = createFileRoute('/routes/')({ component: RoutesPage });

const categoryOrder = ['simple', 'medium', 'complex', 'uncategorized'] as const;
const categoryLabelKeys: Record<string, I18nKey> = {
  simple: 'routes.category.simple',
  medium: 'routes.category.medium',
  complex: 'routes.category.complex',
  uncategorized: 'routes.category.uncategorized',
};

function RoutesPage() {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const { data: grouped, isLoading, error, refetch } = trpc.route.grouped.useQuery();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) &&
        !(event.target instanceof HTMLSelectElement)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const filteredSections = useMemo(() => {
    if (!grouped)
      return [] as Array<{ key: string; labelKey: I18nKey; routes: (typeof grouped)[string] }>;
    const query = searchQuery.trim().toLowerCase();

    return categoryOrder
      .map((key) => {
        const routes = (grouped[key] ?? []).filter((route) => {
          if (!query) return true;
          return (
            route.name.toLowerCase().includes(query) ||
            route.id.toLowerCase().includes(query) ||
            route.description.toLowerCase().includes(query)
          );
        });

        return {
          key,
          labelKey: categoryLabelKeys[key],
          routes,
        };
      })
      .filter((section) => section.routes.length > 0);
  }, [grouped, searchQuery]);

  const totalRoutes = filteredSections.reduce((sum, section) => sum + section.routes.length, 0);

  return (
    <div className="page-container space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">
          {t('routes.title')}
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t(totalRoutes === 1 ? 'routes.countOne' : 'routes.count', { count: totalRoutes })}
        </p>
      </header>

      <div className="relative max-w-xl rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <input
          ref={searchRef}
          type="text"
          placeholder={t('routes.searchPlaceholder')}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          aria-label={t('routes.searchAria')}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder-slate-400"
        />
        <span className="pointer-events-none absolute right-7 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 dark:text-slate-500">
          /
        </span>
      </div>

      {isLoading && (
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2, 3, 4, 5, 6].map((index) => (
            <div key={index} className="card p-5 animate-pulse">
              <div className="space-y-3">
                <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-4 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-4 w-full rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card p-5">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            {t('routes.failed')}
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{error.message}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={() => refetch()} className="btn-secondary text-sm">
              {t('common.retry')}
            </button>
            <Link to="/" className="btn-secondary text-sm">
              {t('error.backHome')}
            </Link>
          </div>
        </div>
      )}

      {!isLoading && !error && totalRoutes === 0 && (
        <div className="card p-12 text-center">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            {searchQuery ? t('routes.empty.filtered.title') : t('routes.empty.all.title')}
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {searchQuery ? t('routes.empty.filtered.detail') : t('routes.empty.all.detail')}
          </p>
        </div>
      )}

      {!isLoading && !error && totalRoutes > 0 && (
        <div className="space-y-8">
          {filteredSections.map((section) => (
            <section key={section.key} className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <h2 className="label">{t(section.labelKey)}</h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {section.routes.length}
                </span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {section.routes.map((route) => (
                  <Link
                    key={route.id}
                    to="/routes/$id"
                    params={{ id: route.id }}
                    className="card-hover block p-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-medium text-slate-900 dark:text-white">
                            {route.name}
                          </h3>
                          <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                            {route.id}
                          </p>
                        </div>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {t(
                            (route.stages?.length ?? 0) === 1
                              ? 'routes.stagesOne'
                              : 'routes.stages',
                            { count: route.stages?.length ?? 0 },
                          )}
                        </span>
                      </div>
                      <p className="line-clamp-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                        {route.description}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
