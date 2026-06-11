'use client';

import { trpc } from '@/lib/trpc';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { EventIcon } from '@/components/timeline/EventIcon';
import { TimelineFilter } from '@/components/timeline/TimelineFilter';

function TimelineEvent({ event, index }: { event: any; index: number }) {
  const [expanded, setExpanded] = useState(false);

  const eventType = event.type || event.event || 'unknown';

  return (
    <div className="flex gap-4 group">
      {/* Timeline line */}
      <div className="relative flex flex-col items-center">
        <EventIcon type={eventType} />
        <div className="flex-1 w-px bg-gray-200 dark:bg-gray-700 mt-2 group-last:hidden" />
      </div>

      {/* Event content */}
      <div className="flex-1 pb-8">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:border-blue-300 dark:hover:border-blue-600 transition-colors">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                #{index + 1}
              </span>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                {eventType}
              </span>
              {event.timestamp && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500"
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          </div>

          {event.message && (
            <p className="text-sm text-gray-900 dark:text-gray-100 mb-2">{event.message}</p>
          )}

          {event.stage && (
            <p className="text-sm text-gray-600 dark:text-gray-300">Stage: {event.stage}</p>
          )}

          {event.gate && (
            <p className="text-sm text-gray-600 dark:text-gray-300">Gate: {event.gate}</p>
          )}

          {expanded && (
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-3 rounded overflow-auto text-gray-900 dark:text-gray-100">
                {JSON.stringify(event, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TimelinePage() {
  const params = useParams();
  const id = params.id as string;
  const [selectedType, setSelectedType] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: session } = trpc.session.byId.useQuery({ id });
  const { data: events, isLoading, error } = trpc.session.timeline.useQuery({
    sessionId: id,
  });

  const filteredEvents = events?.filter(event => {
    const eventType = event.type || event.event || '';
    const matchesType = !selectedType || eventType === selectedType;
    const matchesSearch = !searchQuery ||
      JSON.stringify(event).toLowerCase().includes(searchQuery.toLowerCase());
    return matchesType && matchesSearch;
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error loading timeline</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <Link
          href={`/sessions/${id}`}
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-500 mb-2 inline-block"
        >
          ← Back to session
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Timeline</h1>
        {session && (
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{session.goal}</p>
        )}
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          {filteredEvents?.length || 0} of {events?.length || 0} event(s)
        </p>
      </div>

      <TimelineFilter
        selectedType={selectedType}
        onTypeChange={setSelectedType}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      />

      {!filteredEvents || filteredEvents.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-500 dark:text-gray-400">No timeline events found</p>
        </div>
      ) : (
        <div className="space-y-0">
          {filteredEvents.map((event, index) => (
            <TimelineEvent key={index} event={event} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}
