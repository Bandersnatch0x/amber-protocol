'use client';

import { SessionStatus } from '@/lib/types/session-events';

interface StatusBadgeProps {
  status: SessionStatus | null;
}

const statusConfig: Record<SessionStatus, { label: string; className: string }> = {
  idle: { label: 'Idle', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  running: { label: 'Running', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  paused: { label: 'Paused', className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  aborted: { label: 'Aborted', className: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  if (!status) {
    return <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">—</span>;
  }

  const config = statusConfig[status];

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded ${config.className}`}>
      {config.label}
    </span>
  );
}
