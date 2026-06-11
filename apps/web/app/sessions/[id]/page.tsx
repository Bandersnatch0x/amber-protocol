'use client';

import { trpc } from '@/lib/trpc';
import { useParams } from 'next/navigation';
import Link from 'next/link';

function StatusBadge({ status }: { status: string }) {
  const colors = {
    completed: 'bg-green-100 text-green-800',
    running: 'bg-blue-100 text-blue-800',
    paused: 'bg-yellow-100 text-yellow-800',
    failed: 'bg-red-100 text-red-800',
    aborted: 'bg-gray-100 text-gray-800',
  };

  const color = colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800';

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${color}`}>
      {status}
    </span>
  );
}

export default function SessionDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const { data: session, isLoading, error } = trpc.session.byId.useQuery({ id });

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

  if (error || !session) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-red-800">Session not found</h3>
          <p className="mt-1 text-sm text-red-700">{error?.message || 'Session does not exist'}</p>
          <Link href="/sessions" className="mt-3 inline-block text-sm text-red-600 hover:text-red-500">
            ← Back to sessions
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link href="/sessions" className="text-sm text-blue-600 hover:text-blue-500 mb-2 inline-block">
          ← Back to sessions
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <StatusBadge status={session.status} />
              <span className="text-sm text-gray-500 font-mono">{session.id}</span>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">{session.goal}</h1>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Session Details</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-medium text-gray-500">Status</dt>
                <dd className="mt-1 text-sm text-gray-900">{session.status}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Route</dt>
                <dd className="mt-1 text-sm text-gray-900">{session.route.id}</dd>
              </div>
              <div>
                <dt className="text-sm font-medium text-gray-500">Created</dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {new Date(session.createdAt).toLocaleString()}
                </dd>
              </div>
              {session.updatedAt && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Updated</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {new Date(session.updatedAt).toLocaleString()}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-sm font-medium text-gray-500">Timeline Events</dt>
                <dd className="mt-1 text-sm text-gray-900">{session.timelineEvents}</dd>
              </div>
              {session.worktree && (
                <div>
                  <dt className="text-sm font-medium text-gray-500">Worktree</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {session.worktree.active ? '✓ Active' : '✗ Inactive'}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {session.budget && (
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Budget</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Tokens Used</span>
                  <span className="text-sm font-medium text-gray-900">
                    {session.budget.tokensUsed?.toLocaleString() || 0}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">Max Tokens</span>
                  <span className="text-sm font-medium text-gray-900">
                    {session.budget.maxTokens.toLocaleString()}
                  </span>
                </div>
                {session.budget.tokensUsed !== undefined && (
                  <>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{
                          width: `${Math.min(
                            100,
                            (session.budget.tokensUsed / session.budget.maxTokens) * 100
                          )}%`,
                        }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>
                        {((session.budget.tokensUsed / session.budget.maxTokens) * 100).toFixed(1)}% used
                      </span>
                      <span>
                        {(session.budget.maxTokens - session.budget.tokensUsed).toLocaleString()} remaining
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Actions</h2>
            <div className="flex space-x-3">
              <Link
                href={`/sessions/${session.id}/timeline`}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700"
              >
                View Timeline
              </Link>
              <button
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                disabled
              >
                Control Session (Coming Soon)
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Manifest</h2>
            <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto max-h-96">
              {JSON.stringify(session.manifest, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
