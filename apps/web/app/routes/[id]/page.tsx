'use client';

import { trpc } from '@/lib/trpc';
import { useParams } from 'next/navigation';
import Link from 'next/link';

export default function RouteDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: route, isLoading, error } = trpc.route.byId.useQuery({ id });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error || !route) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-red-800">Route not found</h3>
          <p className="mt-1 text-sm text-red-700">{error?.message || 'Route does not exist'}</p>
          <Link href="/routes" className="mt-3 inline-block text-sm text-red-600 hover:text-red-500">
            ← Back to routes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/routes" className="text-sm text-blue-600 hover:text-blue-500 mb-2 inline-block">
          ← Back to routes
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{route.name}</h1>
            <p className="text-sm text-gray-500 font-mono mt-1">{route.id}</p>
          </div>
          {route.category && (
            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800 capitalize">
              {route.category}
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Description</h2>
            <p className="text-gray-700">{route.description}</p>
          </div>

          {route.stages && route.stages.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Stages ({route.stages.length})
              </h2>
              <div className="space-y-3">
                {route.stages.map((stage, index) => (
                  <div
                    key={index}
                    className="flex items-start p-3 bg-gray-50 rounded-md"
                  >
                    <div className="flex-shrink-0">
                      <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-100 text-blue-600 font-semibold text-sm">
                        {index + 1}
                      </div>
                    </div>
                    <div className="ml-3 flex-1">
                      <p className="text-sm font-medium text-gray-900">{stage}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Metadata</h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm font-medium text-gray-500">Category</dt>
                <dd className="mt-1 text-sm text-gray-900 capitalize">
                  {route.category || 'Uncategorized'}
                </dd>
              </div>
              {route.metadata?.version && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Version</dt>
                  <dd className="mt-1 text-sm text-gray-900">{route.metadata.version}</dd>
                </div>
              )}
              {route.metadata?.author && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Author</dt>
                  <dd className="mt-1 text-sm text-gray-900">{route.metadata.author}</dd>
                </div>
              )}
              {route.metadata?.tags && route.metadata.tags.length > 0 && (
                <div>
                  <dt className="text-sm font-medium text-gray-500 mb-2">Tags</dt>
                  <dd className="flex flex-wrap gap-2">
                    {route.metadata.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-800"
                      >
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
