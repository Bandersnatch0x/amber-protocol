import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { buildRouteMetadata, buildStageDetailLine } from '@/features/routes/route-detail-view-model';
import { useI18n, type I18nKey } from '@/lib/i18n';

export const Route = createFileRoute('/routes/$id/')({ component: RouteDetailPage });

function RouteDetailPage() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const { data: route, isLoading, error, refetch } = trpc.route.byId.useQuery({ id });

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-7 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="card h-32 p-6" />
          <div className="card h-48 p-6" />
        </div>
      </div>
    );
  }

  if (error || !route) {
    return (
      <div className="page-container">
        <div className="card max-w-xl p-6">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-white">{t('routes.detail.notFound')}</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            {error?.message || t('routes.detail.notFoundDetail')}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to="/routes" className="btn-secondary text-sm">
              {t('routes.detail.back')}
            </Link>
            {error && (
              <button onClick={() => refetch()} className="btn-secondary text-sm">
                {t('routes.detail.retry')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const stageCount = route.stages?.length ?? 0;
  const metadata = buildRouteMetadata(route);

  return (
    <div className="page-container space-y-6">
      <header className="space-y-3">
        <Link to="/routes" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
          <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('nav.routes')}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-950 dark:text-white sm:text-3xl">{route.name}</h1>
          {route.trigger?.complexity && (
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300">
              {route.trigger.complexity}
            </span>
          )}
        </div>
        <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{route.id}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="section-title">{t('routes.detail.description')}</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">{route.description}</p>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between gap-4">
              <h2 className="section-title">{t('routes.detail.stages')}</h2>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {t(stageCount === 1 ? 'routes.stagesOne' : 'routes.stages', { count: stageCount })}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {route.stages?.map((stage, index) => (
                <div key={stage.name} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{stage.displayName}</p>
                        <p className="mt-1 break-all font-mono text-xs text-slate-500 dark:text-slate-400">{buildStageDetailLine(stage)}</p>
                      </div>
                      {stage.gateAfter && (
                        <p className="text-xs text-slate-600 dark:text-slate-400">{t('routes.detail.gateAfter', { gate: stage.gateAfter })}</p>
                      )}
                      {'note' in stage && stage.note && (
                        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{stage.note}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="card p-5">
          <h2 className="section-title">{t('routes.detail.metadata')}</h2>
          <dl className="mt-4 space-y-4">
            {metadata.map((item) => (
              <div key={item.labelKey}>
                <dt className="label">{t(`routes.detail.metadata.${item.labelKey}` as I18nKey)}</dt>
                <dd className="mt-1 break-all text-sm text-slate-900 dark:text-white">{item.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </div>
  );
}
