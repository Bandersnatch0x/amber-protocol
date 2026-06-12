'use client';

import { trpc } from '@/lib/trpc';
import Link from 'next/link';
import { SessionSkeleton } from '@/components/SessionSkeleton';

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
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}

export default function SessionsPage() {
  const { data: sessions, isLoading, error } = trpc.session.list.useQuery();

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <SessionSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-red-800">Error loading sessions</h3>
          <p className="mt-1 text-sm text-red-700">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Sessions</h1>
        <p className="mt-2 text-sm text-gray-600">
          {sessions?.length || 0} session(s) found
        </p>
      </div>

      {!sessions || sessions.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-500 mb-4">No sessions found</p>
          <p className="text-sm text-gray-400">
            Start a session from the CLI to see it here
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/sessions/${session.id}`}
              className="block bg-white border border-gray-200 rounded-lg p-6 hover:border-blue-500 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-3 mb-2">
                    <StatusBadge status={session.status} />
                    <span className="text-xs text-gray-500 font-mono">
                      {session.id.slice(0, 8)}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    {session.goal}
                  </h3>
                  <div className="flex items-center space-x-4 text-sm text-gray-500">
                    <span>Route: {session.route.id}</span>
                    <span>•</span>
                    <span>
                      Created: {new Date(session.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {session.budget && (
                    <div className="mt-2 text-sm text-gray-600">
                      Budget: {session.budget.tokensUsed?.toLocaleString() || 0} /{' '}
                      {session.budget.maxTokens.toLocaleString()} tokens
                    </div>
                  )}
                </div>
                <div className="ml-4">
                  <svg
                    className="h-5 w-5 text-gray-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
