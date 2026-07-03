import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useState, useMemo, useRef, useEffect } from 'react';

export const Route = createFileRoute('/routes/')({ component: RoutesPage });

function RoutesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const { data: grouped, isLoading, error, refetch } = trpc.route.grouped.useQuery();
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const filteredGrouped = useMemo(() => {
    if (!grouped || typeof grouped !== 'object') return {};
    const q = searchQuery.toLowerCase();
    return Object.fromEntries(
      Object.entries(grouped)
        .filter(([, routes]) => Array.isArray(routes))
        .map(([category, routes]) => [
          category,
          routes.filter(
            (route: { name?: string; id?: string }) =>
              (route.name || '').toLowerCase().includes(q) ||
              (route.id || '').toLowerCase().includes(q)
          ),
        ])
        .filter(([, routes]) => routes.length > 0)
    );
  }, [grouped, searchQuery]);

  const totalRoutes = useMemo(
    () => Object.values(filteredGrouped).reduce((sum, routes) => sum + routes.length, 0),
    [filteredGrouped]
  );

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Routes</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {totalRoutes} route{totalRoutes !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="mb-6">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search routes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search routes"
          className="w-full max-w-md px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mb-3"></div>
              <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-full"></div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card p-5 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Failed to load routes</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error.message}</p>
          <button onClick={() => refetch()} className="btn-secondary text-xs mt-2">Retry</button>
        </div>
      )}

      {totalRoutes === 0 && !isLoading && (
        <div className="card p-12 text-center">
          <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-1">No routes found</h3>
          {searchQuery ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Try a different search term
            </p>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Routes define the workflow stages an agent follows during a session.
            </p>
          )}
        </div>
      )}

      {totalRoutes > 0 && (
        <div className="space-y-8">
          {Object.entries(filteredGrouped).map(([category, routes]) => (
            <div key={category}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-3">
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {routes.map((route) => (
                  <Link
                    key={route.id}
                    to="/routes/$id"
                    params={{ id: route.id }}
                    className="card-hover p-5 block"
                  >
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1 truncate">
                      {route.name}
                    </h3>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{route.id}</span>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                      {route.description}
                    </p>
                    {route.stages && route.stages.length > 0 && (
                      <div className="mt-3 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                        <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        {route.stages.length} stage{route.stages.length !== 1 ? 's' : ''}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
