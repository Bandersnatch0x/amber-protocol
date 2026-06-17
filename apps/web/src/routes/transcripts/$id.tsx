import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/transcripts/$id')({ component: TranscriptDetailPage });

const TYPE_STYLES: Record<string, string> = {
  user: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  assistant: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  system: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
};

function TranscriptDetailPage() {
  const { id } = Route.useParams();
  const { data: detail, isLoading, error } = trpc.transcript.read.useQuery({ id });
  const saveDigest = trpc.transcript.save.useMutation();
  const proposeRegressions = trpc.transcript.proposeRegressions.useMutation();

  return (
    <div className="page-container">
      <div className="mb-6">
        <Link to="/transcripts" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          ← Transcripts
        </Link>
        <h1 className="mt-2 text-xl font-bold text-slate-900 dark:text-white font-mono">
          {id.slice(0, 8)}
        </h1>
        {detail && (
          <div className="mt-1 flex items-center gap-3">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {detail.turnCount} turns · secrets redacted
            </p>
            <button
              type="button"
              onClick={() => saveDigest.mutate({ id })}
              disabled={saveDigest.isLoading}
              className="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              {saveDigest.isLoading ? 'Saving…' : 'Save digest'}
            </button>
            {saveDigest.isSuccess && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                Saved to .amber/lens/ (git-ignored)
              </span>
            )}
            {saveDigest.isError && (
              <span className="text-xs text-red-600 dark:text-red-400">Save failed</span>
            )}
            <button
              type="button"
              onClick={() => proposeRegressions.mutate({ id })}
              disabled={proposeRegressions.isLoading}
              className="text-xs px-2.5 py-1 rounded border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              {proposeRegressions.isLoading ? 'Scanning…' : 'Propose regressions'}
            </button>
            {proposeRegressions.isSuccess && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                {proposeRegressions.data.proposedCount} proposal(s) → .amber/executions/
              </span>
            )}
          </div>
        )}
      </div>

      {isLoading && <div className="card p-5 animate-pulse h-24" />}

      {error && (
        <div className="card p-5 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <p className="text-sm text-red-700 dark:text-red-300">{error.message}</p>
        </div>
      )}

      {detail && (
        <div className="space-y-3">
          {detail.turns.map((turn, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${TYPE_STYLES[turn.type] ?? TYPE_STYLES.system}`}>
                  {turn.type}
                </span>
                {turn.tools.map((tool) => (
                  <span key={tool} className="text-xs px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-mono">
                    {tool}
                  </span>
                ))}
                {turn.timestamp && (
                  <span className="ml-auto text-xs text-slate-400 dark:text-slate-500">
                    {new Date(turn.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
              {turn.text && (
                <pre className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words font-sans">
                  {turn.text}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
