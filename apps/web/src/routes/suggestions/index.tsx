import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useI18n, type I18nKey } from '@/lib/i18n';

export const Route = createFileRoute('/suggestions/')({ component: SuggestionsPage });

type Filter = 'open' | 'resolved';

function SuggestionsPage() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>('open');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const listQuery = trpc.suggestions.list.useQuery();
  const utils = trpc.useUtils();

  const applyMut = trpc.suggestions.applyCard.useMutation({
    onSuccess: async () => {
      setMessage(t('suggestions.applyOk'));
      await utils.suggestions.list.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });
  const dismissMut = trpc.suggestions.dismiss.useMutation({
    onSuccess: async () => {
      await utils.suggestions.list.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });
  const snoozeMut = trpc.suggestions.snooze.useMutation({
    onSuccess: async () => {
      await utils.suggestions.list.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });
  const undoMut = trpc.suggestions.undo.useMutation({
    onSuccess: async () => {
      setMessage(t('suggestions.undoOk'));
      await utils.suggestions.list.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });

  const cards = useMemo(() => {
    const all = listQuery.data?.suggestions ?? [];
    if (filter === 'open') {
      return all.filter((card) => card.status === 'open');
    }
    return all.filter((card) => card.status !== 'open');
  }, [filter, listQuery.data]);

  return (
    <div className="page-container space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">
          {t('suggestions.title')}
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
          {t('suggestions.description')}
        </p>
        {listQuery.isLoading ? (
          <div
            className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700"
            aria-hidden="true"
          />
        ) : (
          !listQuery.error && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t(cards.length === 1 ? 'suggestions.countOne' : 'suggestions.count', {
                count: cards.length,
              })}
            </p>
          )
        )}
      </header>

      <div className="flex gap-2">
        {(['open', 'resolved'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              filter === value
                ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            {t(`suggestions.filter.${value}` as I18nKey)}
          </button>
        ))}
      </div>

      {message && (
        <p className="text-sm text-slate-700 dark:text-slate-200" data-testid="suggestions-message">
          {message}
        </p>
      )}

      {listQuery.isLoading && (
        <div className="space-y-3">
          {[1, 2].map((index) => (
            <div
              key={index}
              className="h-24 animate-pulse rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
            />
          ))}
        </div>
      )}

      {listQuery.error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
          <p className="text-sm font-medium text-red-800 dark:text-red-200">
            {t('suggestions.failed')}
          </p>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">
            {t('suggestions.failedDetail')}
          </p>
          <button
            type="button"
            className="btn-secondary mt-3 text-xs"
            onClick={() => listQuery.refetch()}
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {!listQuery.isLoading && !listQuery.error && cards.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('suggestions.empty')}</p>
      )}

      <ul className="space-y-3" data-testid="suggestions-list">
        {cards.map((card) => {
          const previewOpen = expanded === card.id;
          const showEvidence = evidenceOpen === card.id;
          return (
            <li
              key={card.id}
              data-testid="suggestion-card"
              className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2">
                  <Link
                    to="/suggestions/$id"
                    params={{ id: card.id }}
                    className="text-sm font-medium text-slate-900 hover:text-amber-700 dark:text-white"
                  >
                    {card.title}
                  </Link>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {t(
                      card.evidenceCount === 1
                        ? 'suggestions.evidenceBadgeOne'
                        : 'suggestions.evidenceBadge',
                      { count: card.evidenceCount, hosts: card.hosts.join(', ') },
                    )}
                  </p>
                  <p className="text-xs font-mono text-slate-500">
                    {t(`suggestions.status.${card.status}` as I18nKey)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => setExpanded(previewOpen ? null : card.id)}
                  >
                    {t(previewOpen ? 'suggestions.hidePreview' : 'suggestions.preview')}
                  </button>
                  {card.status === 'applied' ? (
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => undoMut.mutate({ id: card.id })}
                    >
                      {t('suggestions.undo')}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn-primary text-xs"
                        data-testid="suggestion-apply"
                        onClick={() => applyMut.mutate({ id: card.id })}
                      >
                        {t('suggestions.apply')}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => snoozeMut.mutate({ id: card.id })}
                      >
                        {t('suggestions.snooze')}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => dismissMut.mutate({ id: card.id })}
                      >
                        {t('suggestions.dismiss')}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {previewOpen && (
                <div className="mt-4 space-y-3" data-testid="suggestion-preview">
                  {card.operations.map((operation) => (
                    <div
                      key={`${operation.verb}:${operation.path}`}
                      className="rounded-md border border-slate-200 p-3 dark:border-slate-700"
                    >
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                        {t(`suggestions.operation.${operation.verb}` as I18nKey)} ·{' '}
                        {t(`suggestions.artifact.${operation.artifactKind}` as I18nKey)} ·{' '}
                        <span className="font-mono">{operation.path}</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{operation.summary}</p>
                      {operation.contents && (
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          {operation.contents}
                        </pre>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-xs text-blue-600 dark:text-blue-400"
                    onClick={() => setEvidenceOpen(showEvidence ? null : card.id)}
                  >
                    {t(showEvidence ? 'suggestions.hideEvidence' : 'suggestions.seeEvidence')}
                  </button>
                  {showEvidence && (
                    <ul className="space-y-2" data-testid="suggestion-evidence">
                      {card.evidence.map((item, index) => (
                        <li
                          key={`${item.host}:${item.transcriptId}:${index}`}
                          className="text-xs text-slate-600 dark:text-slate-300"
                        >
                          <span className="font-mono">{item.host}</span> / {item.transcriptId}:{' '}
                          {item.excerpt}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
