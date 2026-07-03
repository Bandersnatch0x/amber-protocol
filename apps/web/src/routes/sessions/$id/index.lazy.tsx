import { useState } from 'react';
import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { StatusBadge } from '@/components/session/StatusBadge';
import { SessionControls } from '@/components/session/SessionControls';
import { SessionStatus } from '@/components/session/SessionStatus';
import { useSessionEvents } from '@/lib/hooks/useSessionEvents';

export const Route = createLazyFileRoute('/sessions/$id/')({ component: SessionDetailPage });

function SessionDetailPage() {
  const { id } = Route.useParams();
  const { data: session, isLoading, error, refetch } = trpc.session.byId.useQuery({ id });
  const { status, connectionState, lastEvent } = useSessionEvents(id);
  const [manifestExpanded, setManifestExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24"></div>
          <div className="h-7 bg-slate-200 dark:bg-slate-700 rounded w-2/3"></div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="card p-6 h-48"></div>
              <div className="card p-6 h-32"></div>
            </div>
            <div className="card p-6 h-64"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="page-container">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 max-w-md">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Session not found</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error?.message || 'This session may have been deleted or the link is incorrect.'}</p>
          <div className="flex gap-3 mt-4">
            <Link to="/sessions" className="btn-secondary text-sm">
              Back to sessions
            </Link>
            <button onClick={() => refetch()} className="btn-secondary text-xs">Retry</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="mb-6">
        <Link to="/sessions" className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 mb-3 inline-flex items-center gap-1">
          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Sessions
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <StatusBadge status={session.status} />
              {session.status === 'completed' && (
                <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Session completed successfully
                </span>
              )}
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{session.id}</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white line-clamp-3 break-words">{session.goal}</h1>
          </div>
        </div>
      </div>

      <div className="card p-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SessionStatus status={status} connectionState={connectionState} lastEvent={lastEvent} />
          <SessionControls sessionId={id} status={status} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5">
            <h2 className="section-title mb-4">Details</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              <div>
                <dt className="label">Status</dt>
                <dd className="value">{session.status}</dd>
              </div>
              <div>
                <dt className="label">Route</dt>
                <dd className="value font-mono text-xs">{session.route.id}</dd>
              </div>
              <div>
                <dt className="label">Created</dt>
                <dd className="value">{new Date(session.createdAt).toLocaleString()}</dd>
              </div>
              {session.updatedAt && (
                <div>
                  <dt className="label">Updated</dt>
                  <dd className="value">{new Date(session.updatedAt).toLocaleString()}</dd>
                </div>
              )}
              <div>
                <dt className="label">Timeline Events</dt>
                <dd className="value">{session.timelineEvents}</dd>
              </div>
              {session.worktree && (
                <div>
                  <dt className="label">Worktree</dt>
                  <dd className="value">
                    <span className={session.worktree.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}>
                      {session.worktree.active ? 'Active' : 'Inactive'}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {session.budget && (
            <div className="card p-5">
              <h2 className="section-title mb-4">Budget</h2>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Used</span>
                  <span className="font-medium text-slate-900 dark:text-white">
                    {session.budget.tokensUsed?.toLocaleString() || 0}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Max</span>
                  <span className="font-medium text-slate-900 dark:text-white">
                    {session.budget.maxTokens.toLocaleString()}
                  </span>
                </div>
                {session.budget.tokensUsed !== undefined && (
                  <>
                    <div
                      role="progressbar"
                      aria-valuenow={session.budget.tokensUsed}
                      aria-valuemin={0}
                      aria-valuemax={session.budget.maxTokens}
                      aria-label="Token budget usage"
                      className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5"
                    >
                      <div
                        className="bg-blue-600 dark:bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, (session.budget.tokensUsed / session.budget.maxTokens) * 100)}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>{((session.budget.tokensUsed / session.budget.maxTokens) * 100).toFixed(1)}% used</span>
                      <span>{(session.budget.maxTokens - session.budget.tokensUsed).toLocaleString()} remaining</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="mt-2">
            <Link
              to="/sessions/$id/timeline"
              params={{ id: session.id }}
              className="btn-primary"
            >
              View Timeline
            </Link>
          </div>
        </div>

        <div className="card p-5 lg:col-span-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Manifest</h2>
            <button
              type="button"
              aria-expanded={manifestExpanded}
              onClick={() => setManifestExpanded(!manifestExpanded)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded flex-shrink-0"
            >
              {manifestExpanded ? 'Hide' : 'Show'}
            </button>
          </div>
          {manifestExpanded ? (
            <pre className="text-xs font-mono text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 p-3 rounded-md overflow-auto max-h-96 whitespace-pre-wrap leading-relaxed">
              {JSON.stringify(session.manifest, null, 2)}
            </pre>
          ) : (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Session configuration and metadata snapshot</p>
              <p className="font-mono text-xs text-slate-500 dark:text-slate-400 truncate">
                {JSON.stringify(session.manifest, null, 2).slice(0, 120)}...
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
