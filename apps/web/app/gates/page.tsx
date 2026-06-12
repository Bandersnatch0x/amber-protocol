'use client';

import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { GateStatus } from '@/lib/types/gate';

export default function GatesPage() {
  const [statusFilter, setStatusFilter] = useState<GateStatus | ''>('');
  const { data: gates, isLoading } = trpc.gate.list.useQuery(
    statusFilter ? { status: statusFilter } : undefined
  );

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Gates</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {gates?.length || 0} gate(s) found
        </p>
      </div>

      <div className="mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as GateStatus | '')}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        >
          <option value="">All Gates</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="space-y-4">
        {gates?.map((gate) => (
          <div
            key={gate.gateId}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                  {gate.gateId}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {gate.description}
                </p>
                <div className="mt-2 flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                  <span>Stage: {gate.stage}</span>
                  <span>Session: {gate.sessionId}</span>
                </div>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs font-medium ${
                  gate.status === 'pending'
                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    : gate.status === 'approved'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                }`}
              >
                {gate.status}
              </span>
            </div>
          </div>
        ))}
      </div>

      {gates?.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          No gates found
        </div>
      )}
    </div>
  );
}
