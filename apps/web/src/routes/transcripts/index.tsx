import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/transcripts/')({ component: TranscriptsPage });

function TranscriptsPage() {
  const { data: transcripts, isLoading, error } = trpc.transcript.list.useQuery();

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Transcripts</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Claude Code sessions for this repository (read-only, secrets redacted)
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-5 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card p-5 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Failed to load transcripts</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error.message}</p>
        </div>
      )}

      {transcripts && transcripts.length === 0 && (
        <div className="card p-12 text-center">
          <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-1">No transcripts</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No Claude Code sessions found for this repository under ~/.claude/projects.
          </p>
        </div>
      )}

      {transcripts && transcripts.length > 0 && (
        <div className="space-y-3">
          {transcripts.map((t) => (
            <Link
              key={t.id}
              to="/transcripts/$id"
              params={{ id: t.id }}
              className="block card-hover p-5"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {t.id.slice(0, 8)}
                    </span>
                    {t.gitBranch && (
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono">
                        {t.gitBranch}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>{t.turnCount} turn{t.turnCount !== 1 ? 's' : ''}</span>
                    {t.lastTimestamp && (
                      <>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <span>{new Date(t.lastTimestamp).toLocaleString()}</span>
                      </>
                    )}
                  </div>
                </div>
                <svg className="w-4 h-4 text-slate-300 dark:text-slate-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
