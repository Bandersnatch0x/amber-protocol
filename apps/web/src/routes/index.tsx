import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/')({ component: HomePage });

function HomePage() {
  return (
    <div className="page-container">
      <div className="max-w-2xl mx-auto text-center py-16">
        <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mx-auto mb-6">
          <span className="text-white text-lg font-bold">A</span>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">
          Amber Protocol
        </h1>
        <p className="text-lg text-slate-600 dark:text-slate-400 mb-8">
          Monitor and control your autonomous coding sessions
        </p>
        <div className="flex justify-center gap-3">
          <Link to="/sessions" className="btn-primary px-6 py-2.5">
            View Sessions
          </Link>
          <Link to="/routes" className="btn-secondary px-6 py-2.5">
            Browse Routes
          </Link>
        </div>
      </div>

      <div className="max-w-3xl mx-auto mt-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-5">
            <div className="w-8 h-8 rounded-md bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center mb-3">
              <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
              Real-time Monitoring
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Watch sessions execute with live SSE timeline updates
            </p>
          </div>

          <div className="card p-5">
            <div className="w-8 h-8 rounded-md bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center mb-3">
              <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
              Session Control
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Start, pause, resume, and abort sessions from the web UI
            </p>
          </div>

          <div className="card p-5">
            <div className="w-8 h-8 rounded-md bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center mb-3">
              <svg className="w-4 h-4 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
              Timeline Inspection
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Inspect every event in your session execution timeline
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
