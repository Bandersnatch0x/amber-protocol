import type { SessionStatus } from '@/lib/types/session-events';
import { useI18n, type I18nKey } from '@/lib/i18n';

interface StatusBadgeProps {
  status: SessionStatus | string | null;
}

const statusConfig: Record<string, { labelKey: I18nKey; className: string }> = {
  idle: {
    labelKey: 'sessions.status.idle',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  },
  running: {
    labelKey: 'sessions.status.running',
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  executing: {
    labelKey: 'sessions.status.executing',
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  },
  paused: {
    labelKey: 'sessions.status.paused',
    className: 'bg-amber-50 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  },
  completed: {
    labelKey: 'sessions.status.completed',
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  aborted: {
    labelKey: 'sessions.status.aborted',
    className: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
  created: {
    labelKey: 'sessions.status.created',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  },
  routed: {
    labelKey: 'sessions.status.routed',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  },
  failed: {
    labelKey: 'sessions.status.failed',
    className: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  },
};

// Title-case an unknown status so a value missing from statusConfig still reads
// as a label ("executing" -> "Executing") instead of leaking raw lowercase.
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useI18n();

  if (!status) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400">
        --
      </span>
    );
  }

  const config = statusConfig[status];
  const label = config ? t(config.labelKey) : titleCase(status);
  const className =
    config?.className ?? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-md ${className}`}
    >
      {label}
    </span>
  );
}
