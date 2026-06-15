import type { SessionStatus } from '@/lib/types/session-events';

interface StatusBadgeProps {
  status: SessionStatus | string | null;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  idle: { label: 'Idle', className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' },
  running: { label: 'Running', className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  paused: { label: 'Paused', className: 'bg-amber-50 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300' },
  completed: { label: 'Completed', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  aborted: { label: 'Aborted', className: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  created: { label: 'Created', className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  if (!status) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
        --
      </span>
    );
  }

  const config = statusConfig[status] || { label: status, className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md ${config.className}`}>
      {config.label}
    </span>
  );
}
