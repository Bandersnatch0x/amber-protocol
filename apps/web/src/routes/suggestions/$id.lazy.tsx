import { createLazyFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useI18n, type I18nKey } from '@/lib/i18n';

export const Route = createLazyFileRoute('/suggestions/$id')({ component: SuggestionDetailPage });

function SuggestionDetailPage() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const query = trpc.suggestions.read.useQuery({ id });
  const card = query.data;

  return (
    <div className="page-container space-y-6">
      <Link to="/suggestions" className="text-sm text-blue-600 dark:text-blue-400">
        {t('nav.suggestions')}
      </Link>
      {query.isLoading && (
        <div className="h-24 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-700" />
      )}
      {query.error && (
        <p className="text-sm text-red-700 dark:text-red-300">{t('suggestions.failed')}</p>
      )}
      {card && (
        <article className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
          <h1 className="text-xl font-semibold text-slate-950 dark:text-white">{card.title}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t(
              card.evidenceCount === 1
                ? 'suggestions.evidenceBadgeOne'
                : 'suggestions.evidenceBadge',
              { count: card.evidenceCount, hosts: card.hosts.join(', ') },
            )}
          </p>
          {card.operations.map((operation) => (
            <section key={operation.path}>
              <h2 className="text-sm font-medium">
                {t(`suggestions.operation.${operation.verb}` as I18nKey)} {operation.path}
              </h2>
              {operation.contents && (
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-3 font-mono text-xs dark:bg-slate-900">
                  {operation.contents}
                </pre>
              )}
            </section>
          ))}
        </article>
      )}
    </div>
  );
}
