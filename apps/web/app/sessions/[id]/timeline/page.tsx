'use client';

import { trpc } from '@/lib/trpc';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';

function TimelineEvent({ event, index }: { event: any; index: number }) {
  const [expanded, setExpanded] = useState(false);

  const eventTypes: Record<string, string> = {
    'session-started': 'bg-blue-100 text-blue-800',
    'stage-started': 'bg-purple-100 text-purple-800',
    'stage-completed': 'bg-green-100 text-green-800',
    'gate-reached': 'bg-yellow-100 text-yellow-800',
    'gate-approved': 'bg-green-100 text-green-800',
    'error': 'bg-red-100 text-red-800',
    'session-completed': 'bg-green-100 text-green-800',
    'session-failed': 'bg-red-100 text-red-800',
  };

  const eventType = event.type || event.event || 'unknown';
  const color = eventTypes[eventType] || 'bg-gray-100 text-gray-800';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-3 mb-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
              {eventType}
            </span>
            <span className="text-xs text-gray-500">#{index + 1}</span>
            {event.timestamp && (
              <span className="text-xs text-gray-500">
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>

          {event.message && (
            <p className="text-sm text-gray-900 mb-2">{event.message}</p>
          )}

          {event.stage && (
            <p className="text-sm text-gray-600">Stage: {event.stage}</p>
          )}

          {event.gate && (
            <p className="text-sm text-gray-600">Gate: {event.gate}</p>
          )}
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-4 text-sm text-blue-600 hover:text-blue-500"
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <pre className="text-xs bg-gray-50 p-3 rounded overflow-auto">
            {JSON.stringify(event, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function TimelinePage() {
  const params = useParams();
  const id = params.id as string;

  const { data: session } = trpc.session.byId.useQuery({ id });
  const { data: events, isLoading, error } = trpc.session.timeline.useQuery({
    sessionId: id,
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
          <div className="h-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-red-800">Error loading timeline</h3>
          <p className="mt-1 text-sm text-red-700">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link
          href={`/sessions/${id}`}
          className="text-sm text-blue-600 hover:text-blue-500 mb-2 inline-block"
        >
          ← Back to session
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">Timeline</h1>
        {session && (
          <p className="mt-1 text-sm text-gray-600">{session.goal}</p>
        )}
        <p className="mt-2 text-sm text-gray-500">
          {events?.length || 0} event(s) recorded
        </p>
      </div>

      {!events || events.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-500">No timeline events found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event, index) => (
            <TimelineEvent key={index} event={event} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
