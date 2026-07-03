import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/')({ component: HomePage });

const lifecycle = [
  { stage: 'Audit', command: 'amber audit', output: 'Read-only readiness findings' },
  { stage: 'Init', command: 'amber init', output: 'Starter governance files' },
  { stage: 'Plan', command: 'amber plan', output: 'Feature plan and review surface' },
  { stage: 'Gate', command: 'amber next', output: 'Next safe lifecycle command' },
  { stage: 'Verify', command: 'amber doctor', output: 'Required-surface checks' },
  { stage: 'Handoff', command: 'amber handoff', output: 'Continuable session state' },
];

const workSurfaces = [
  { label: 'Sessions', detail: 'Live status, budget, and timeline', to: '/sessions' },
  { label: 'Transcripts', detail: 'Durable model and tool-call records', to: '/transcripts' },
  { label: 'Routes', detail: 'Governed workflow definitions', to: '/routes' },
  { label: 'Gates', detail: 'Pending approvals and evidence', to: '/gates' },
] as const;

const artifacts = [
  'AGENTS.md',
  'feature_list.json',
  'PROGRESS.md',
  'session-handoff.md',
  'docs/wiki/',
  '.workflow/continuous-improvement/state.json',
];

function HomePage() {
  const { data: sessions } = trpc.session.list.useQuery();
  const activeCount = Array.isArray(sessions)
    ? sessions.filter((s) => s.status === 'running' || s.status === 'executing' || s.status === 'paused').length
    : null;
  const [lifecycleExpanded, setLifecycleExpanded] = useState(false);

  return (
    <div className="page-container space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-normal text-slate-950 dark:text-white sm:text-4xl">
            Reviewable control surfaces for AI coding sessions.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 dark:text-slate-400">
            Monitor session state, inspect timelines, review gates, and keep handoff evidence close to the repository that produced it.
          </p>
          <div className="mt-6 flex flex-col gap-4 sm:flex-row">
            <Link to="/sessions" className="btn-primary px-5 py-2.5">
              Open sessions
            </Link>
            <Link to="/gates" className="btn-secondary px-5 py-2.5">
              Review gates
            </Link>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                {activeCount !== null && activeCount > 0
                  ? `${activeCount} active session${activeCount !== 1 ? 's' : ''}`
                  : 'Governed session review'}
              </h2>
            </div>
            <span
              title="All data stays in your repository. No external telemetry, no cloud dependency."
              className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 cursor-default"
            >
              local-first
            </span>
          </div>
          <dl className="mt-6 grid grid-cols-2 gap-4">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Evidence</dt>
              <dd className="mt-1 text-sm font-medium text-slate-900 dark:text-white">Files + ledgers</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Safety mode</dt>
              <dd className="mt-1 text-sm font-medium text-slate-900 dark:text-white">Dry-run first</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Control</dt>
              <dd className="mt-1 text-sm font-medium text-slate-900 dark:text-white">Human gates</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-400">Scope</dt>
              <dd className="mt-1 text-sm font-medium text-slate-900 dark:text-white">Repository-local</dd>
            </div>
          </dl>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Start from the thing you need to inspect</h2>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {workSurfaces.map((surface) => (
            <Link key={surface.label} to={surface.to} className="card-hover block p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{surface.label}</h3>
                <span className="text-sm text-slate-300 dark:text-slate-600">/</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{surface.detail}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">From read-only audit to handoff</h2>
            <button
              type="button"
              onClick={() => setLifecycleExpanded(!lifecycleExpanded)}
              className="text-sm text-blue-600 dark:text-blue-400 cursor-pointer"
            >
              {lifecycleExpanded ? 'Hide lifecycle reference' : 'Show lifecycle reference'}
            </button>
          </div>
          {lifecycleExpanded && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-700">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-4 font-medium">Stage</th>
                    <th className="py-2 pr-4 font-medium">Command</th>
                    <th className="py-2 font-medium">Output</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {lifecycle.map((item) => (
                    <tr key={item.stage}>
                      <td className="py-3 pr-4 font-medium text-slate-900 dark:text-white">{item.stage}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-slate-600 dark:text-slate-300">{item.command}</td>
                      <td className="py-3 text-slate-600 dark:text-slate-400">{item.output}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Evidence lives with the code</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Generated governance files that track session state and handoff evidence</p>
          <ul className="mt-4 space-y-2">
            {artifacts.map((artifact) => (
              <li key={artifact} className="font-mono text-xs text-slate-600 dark:text-slate-300">
                {artifact}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
