import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useEffect, useMemo, useRef, useState } from 'react';
import { filterTranscripts } from '@/features/transcripts/transcripts-model';
import { useI18n } from '@/lib/i18n';

export const Route = createFileRoute('/transcripts/')({ component: TranscriptsPage });

function formatTimestamp(value: string | undefined, unknownLabel: string): string {
  if (!value) return unknownLabel;
  return new Date(value).toLocaleString();
}

function firstAvailableSource(transcripts: ReturnType<typeof filterTranscripts>) {
  return transcripts.find((transcript) => transcript.repoPath || transcript.sourceDirectory);
}

function fileNameFromPath(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

function TranscriptsPage() {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const { data: transcripts, isLoading, error, refetch } = trpc.transcript.list.useQuery();
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

  const filtered = useMemo(
    () => filterTranscripts(transcripts ?? [], searchQuery),
    [transcripts, searchQuery],
  );
  const source = useMemo(
    () => firstAvailableSource(transcripts ?? []),
    [transcripts],
  );

  return (
    <div className="page-container space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">{t('transcripts.title')}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('transcripts.description')}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t(filtered.length === 1 ? 'transcripts.countOne' : 'transcripts.count', { count: filtered.length })}
        </p>
      </header>

      {source && (
        <section className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('transcripts.repositoryDirectory')}</p>
            <p className="mt-1 break-all font-mono text-sm text-slate-800 dark:text-slate-100">{source.repoPath ?? t('transcripts.unknown')}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('transcripts.transcriptDirectory')}</p>
            <p className="mt-1 break-all font-mono text-sm text-slate-800 dark:text-slate-100">{source.sourceDirectory ?? t('transcripts.unknown')}</p>
          </div>
        </section>
      )}

      <div className="relative max-w-xl rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <input
          ref={searchRef}
          type="text"
          placeholder={t('transcripts.searchPlaceholder')}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          aria-label={t('transcripts.searchAria')}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 pr-10 text-sm text-slate-900 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:placeholder-slate-400"
        />
        <span className="pointer-events-none absolute right-7 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400 dark:text-slate-500">/</span>
      </div>

      {isLoading && (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
          {[1, 2, 3].map((index) => (
            <div key={index} className="p-5 animate-pulse">
              <div className="space-y-3">
                <div className="h-4 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-4 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card p-5">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">{t('transcripts.failed')}</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{error.message}</p>
          <button onClick={() => refetch()} className="btn-secondary mt-4 text-sm">{t('common.retry')}</button>
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="card p-12 text-center">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">
            {searchQuery ? t('transcripts.empty.filtered.title') : t('transcripts.empty.all.title')}
          </h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            {searchQuery
              ? t('transcripts.empty.filtered.detail')
              : t('transcripts.empty.all.detail')}
          </p>
        </div>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
          {filtered.map((transcript) => (
            <Link
              key={transcript.id}
              to="/transcripts/$id"
              params={{ id: transcript.id }}
              className="block px-5 py-4 transition-colors duration-150 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{transcript.id.slice(0, 8)}</span>
                    {transcript.gitBranch && (
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        {transcript.gitBranch}
                      </span>
                    )}
                  </div>
                  <h2 className="text-sm font-medium leading-6 text-slate-900 dark:text-white sm:text-base">
                    {transcript.outline || t('transcripts.noOutline')}
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                    <span>{t(transcript.turnCount === 1 ? 'transcripts.turnsOne' : 'transcripts.turns', { count: transcript.turnCount })}</span>
                    <span>{t('transcripts.lastUpdated', { time: formatTimestamp(transcript.lastTimestamp, t('transcripts.unknown')) })}</span>
                  </div>
                  {transcript.sourceFile && (
                    <p className="break-all font-mono text-xs text-slate-500 dark:text-slate-400">
                      {t('transcripts.file', { name: fileNameFromPath(transcript.sourceFile) })}
                    </p>
                  )}
                </div>
                <svg aria-hidden="true" className="mt-1 h-4 w-4 flex-shrink-0 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
