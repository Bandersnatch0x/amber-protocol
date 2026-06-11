'use client';

import { trpc } from '@/lib/trpc';
import Link from 'next/link';
import { useState } from 'react';

export default function RoutesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const { data: grouped, isLoading, error } = trpc.route.grouped.useQuery();

  const filteredGrouped = grouped
    ? Object.entries(grouped).reduce((acc, [category, routes]) => {
        const filtered = routes.filter(
          route =>
            route.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            route.id.toLowerCase().includes(searchQuery.toLowerCase())
        );
        if (filtered.length > 0) {
          acc[category] = filtered;
        }
        return acc;
      }, {} as Record<string, typeof routes>)
    : {};

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="h-10 bg-gray-200 rounded w-full mb-6"></div>
          <div className="space-y-4">
            <div className="h-32 bg-gray-200 rounded"></div>
            <div className="h-32 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-red-800">Error loading routes</h3>
          <p className="mt-1 text-sm text-red-700">{error.message}</p>
        </div>
      </div>
    );
  }

  const totalRoutes = Object.values(filteredGrouped).reduce((sum, routes) => sum + routes.length, 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Routes</h1>

        <div className="flex items-center gap-4 mb-4">
          <input
            type="text"
            placeholder="Search routes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-600">
            {totalRoutes} route(s) found
          </span>
        </div>
      </div>

      {totalRoutes === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-500">No routes found</p>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(filteredGrouped).map(([category, routes]) => (
            <div key={category}>
              <h2 className="text-xl font-semibold text-gray-900 mb-4 capitalize">
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {routes.map((route) => (
                  <Link
                    key={route.id}
                    href={`/routes/${route.id}`}
                    className="block bg-white border border-gray-200 rounded-lg p-6 hover:border-blue-500 hover:shadow-md transition-all"
                  >
                    <div className="mb-3">
                      <h3 className="text-lg font-semibold text-gray-900 mb-1">
                        {route.name}
                      </h3>
                      <span className="text-xs text-gray-500 font-mono">{route.id}</span>
                    </div>
                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                      {route.description}
                    </p>
                    {route.stages && route.stages.length > 0 && (
                      <div className="flex items-center text-sm text-gray-500">
                        <svg
                          className="h-4 w-4 mr-1"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                          />
                        </svg>
                        {route.stages.length} stage(s)
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
