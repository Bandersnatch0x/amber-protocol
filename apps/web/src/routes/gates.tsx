import { createFileRoute } from '@tanstack/react-router';
import { trpc } from '@/lib/trpc';
import { useState } from 'react';
import { GateStatus } from '@/lib/types/gate';

export const Route = createFileRoute('/gates')({ component: GatesPage });

const statusOptions: { value: GateStatus | ''; label: string }[] = [
  { value: '', label: 'All Gates' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const statusStyles: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  approved: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  rejected: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

function GatesPage() {
  const [statusFilter, setStatusFilter] = useState<GateStatus | ''>('');
  const { data: gates, isLoading, error } = trpc.gate.list.useQuery(
    statusFilter ? { status: statusFilter } : undefined
  );

  return (
    <div className="page-container">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Gates</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {Array.isArray(gates) ? `${gates.length} gate${gates.length !== 1 ? 's' : ''}` : 'Loading...'}
        </p>
      </div>

      <div className="mb-6">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as GateStatus | '')}
          aria-label="Filter by status"
          className="w-full sm:w-auto px-3 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-2"></div>
              <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-2/3"></div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="card p-5 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Failed to load gates</h3>
          <p className="mt-1 text-sm text-red-700 dark:text-red-300">{error.message}</p>
        </div>
      )}

      {gates && gates.length === 0 && (
        <div className="card p-12 text-center">
          <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-1">No gates found</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {statusFilter ? `No ${statusFilter} gates` : 'No gates have been created yet'}
          </p>
        </div>
      )}

      {gates && gates.length === 0 && (
        <div className="card p-12 text-center">
          <svg className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-1">No gates found</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {statusFilter ? `No ${statusFilter} gates` : 'No gates have been created yet'}
          </p>
        </div>
      )}

      {gates && gates.length > 0 && (
        <div className="space-y-3">
          {gates.map((gate) => (
            <div key={gate.gateId} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white font-mono">
                      {gate.gateId}
                    </h3>
                    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md ${statusStyles[gate.status] || ''}`}>
                      {gate.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{gate.description}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>Stage: {gate.stage}</span>
                    <span className="text-slate-300 dark:text-slate-600">·</span>
                    <span className="font-mono">{gate.sessionId.slice(0, 8)}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
