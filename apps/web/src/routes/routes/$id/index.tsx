import { createFileRoute, Link } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';

export const Route = createFileRoute('/routes/$id/')({ component: RouteDetailPage });

function RouteDetailPage() {
  const { id } = Route.useParams();
  const { data: route, isLoading, error } = trpc.route.byId.useQuery({ id });

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-24"></div>
          <div className="h-7 bg-slate-200 dark:bg-slate-700 rounded w-1/3"></div>
          <div className="card p-6 h-32"></div>
          <div className="card p-6 h-48"></div>
        </div>
      </div>
    );
  }

  if (error || !route) {
    return (
      <div className="page-container">
        <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 max-w-md">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Route not found</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error?.message || 'This route may have been removed or the link is incorrect.'}</p>
          <Link to="/routes" className="btn-secondary mt-4 text-sm">
            Back to routes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="mb-6">
        <Link to="/routes" className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 mb-3 inline-flex items-center gap-1">
          <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Routes
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{route.name}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-1">{route.id}</p>
          </div>
          {route.category && (
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 capitalize">
              {route.category}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="card p-5">
            <h2 className="section-title mb-4">Description</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed break-words">
              {route.description}
            </p>
          </div>

          {route.stages && route.stages.length > 0 && (
            <div className="card p-5">
              <h2 className="section-title mb-4">Stages ({route.stages.length})</h2>
              <div className="space-y-2">
                {route.stages.map((stage, index) => (
                  <div key={index} className="flex items-start gap-3 p-3 rounded-md bg-slate-50 dark:bg-slate-900">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">{index + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 dark:text-slate-300">{stage.displayName}</p>
                      {stage.gateAfter && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1">
                          <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          Gate: {stage.gateAfter}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="card p-5">
            <h2 className="section-title mb-4">Metadata</h2>
            <dl className="space-y-3">
              <div>
                <dt className="label">Category</dt>
                <dd className="value capitalize">{route.category || 'Uncategorized'}</dd>
              </div>
              {route.metadata?.version && (
                <div>
                  <dt className="label">Version</dt>
                  <dd className="value">{route.metadata.version}</dd>
                </div>
              )}
              {route.metadata?.author && (
                <div>
                  <dt className="label">Author</dt>
                  <dd className="value">{route.metadata.author}</dd>
                </div>
              )}
              {route.metadata?.tags && route.metadata.tags.length > 0 && (
                <div>
                  <dt className="label mb-2">Tags</dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {route.metadata.tags.map((tag, index) => (
                      <span key={index} className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                        {tag}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
