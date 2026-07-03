import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useState, useMemo, useRef, useEffect } from 'react';
import { StatusBadge } from '@/components/session/StatusBadge';

export const Route = createFileRoute('/sessions/')({ component: SessionsPage });

const statusOptions = [
  { value: '', label: 'All Statuses' },
  { value: 'idle', label: 'Idle' },
  { value: 'running', label: 'Running' },
  { value: 'executing', label: 'Executing' },
  { value: 'paused', label: 'Paused' },
  { value: 'completed', label: 'Completed' },
  { value: 'aborted', label: 'Aborted' },
  { value: 'failed', label: 'Failed' },
] as const;

function SessionsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { data: sessions, isLoading, error, refetch } = trpc.session.list.useQuery();
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

  const filteredSessions = useMemo(() => {
    if (!Array.isArray(sessions)) return sessions;
    return sessions.filter((session) => {
      const matchesSearch = !searchQuery || session.goal.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = !statusFilter || session.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [sessions, searchQuery, statusFilter]);

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Sessions</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {Array.isArray(sessions) ? `${sessions.length} session${sessions.length !== 1 ? 's' : ''}` : 'Loading...'}
        </p>
      </div>

      <div className="flex gap-4 mb-6">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search sessions..."
          aria-label="Search sessions"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="w-full sm:w-auto px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="flex items-start gap-4">
                <div className="w-16 h-5 bg-slate-200 dark:bg-slate-700 rounded"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
                  <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card p-5 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <div className="flex items-center gap-3">
            <svg aria-hidden="true" className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Failed to load sessions</h3>
              <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error.message}</p>
              <button onClick={() => refetch()} className="btn-secondary text-xs mt-2">Retry</button>
            </div>
          </div>
        </div>
      )}

      {filteredSessions && filteredSessions.length === 0 && (
        <div className="card p-12 text-center">
          <svg aria-hidden="true" className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25-2.25M12 13.875V7.5" />
          </svg>
          <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-1">No sessions found</h3>
          {searchQuery || statusFilter ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No sessions match the current filters
            </p>
          ) : (
            <div className="mt-2 space-y-3">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Sessions are autonomous coding tasks managed by Amber Protocol.
              </p>
              <div className="inline-block bg-slate-50 dark:bg-slate-900 px-3 py-2 rounded-md text-left">
                <code className="font-mono text-xs text-slate-700 dark:text-slate-300">
                  amber session start --goal &quot;describe your task&quot;
                </code>
              </div>
            </div>
          )}
        </div>
      )}

      {filteredSessions && filteredSessions.length > 0 && (
        <div className="space-y-3">
          {filteredSessions.map((session) => (
            <Link
              key={session.id}
              to="/sessions/$id"
              params={{ id: session.id }}
              className="block card-hover p-5"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <StatusBadge status={session.status} />
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {session.id.slice(0, 8)}
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                    {session.goal}
                  </h3>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>{session.route.id}</span>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span>{new Date(session.createdAt).toLocaleDateString()}</span>
                    {session.budget && (
                      <>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <span>
                          {session.budget.tokensUsed?.toLocaleString() || 0} / {session.budget.maxTokens.toLocaleString()} tokens
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <svg aria-hidden="true" className="w-4 h-4 text-slate-300 dark:text-slate-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
