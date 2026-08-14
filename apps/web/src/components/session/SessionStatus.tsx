import { StatusBadge } from './StatusBadge';
import { ConnectionIndicator } from './ConnectionIndicator';
import { formatEventTimestamp, parseTimestamp } from '@/components/timeline/timeline-utils';
import { useI18n, type I18nKey } from '@/lib/i18n';
import type { SessionEvent, SessionStatus as SessionStatusType } from '@/lib/types/session-events';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

interface SessionStatusProps {
  status: SessionStatusType | null;
  connectionState: ConnectionState;
  lastEvent: SessionEvent | null;
  onRetry?: () => void;
  reconnectAttempt?: number;
}

function formatRelativeTime(timestamp: number, t: (key: I18nKey, params?: Record<string, string | number>) => string): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return t('sessions.status.justNow');
  if (seconds < 60) return t('sessions.status.secondsAgo', { count: seconds });
  if (seconds < 3600) return t('sessions.status.minutesAgo', { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('sessions.status.hoursAgo', { count: Math.floor(seconds / 3600) });
  return t('sessions.status.daysAgo', { count: Math.floor(seconds / 86400) });
}

export function SessionStatus({ status, connectionState, lastEvent, onRetry, reconnectAttempt }: SessionStatusProps) {
  const { t } = useI18n();
  const latestTimestamp = lastEvent ? parseTimestamp(lastEvent.timestamp) : null;
  const latestLabel = lastEvent ? t(`timeline.event.${lastEvent.type}` as I18nKey) : t('sessions.status.waiting');

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="space-y-1">
        <p className="label">{t('sessions.status.lifecycle')}</p>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
        </div>
      </div>

      <div className="space-y-1">
        <p className="label">{t('sessions.status.connection')}</p>
        <div className="flex items-center gap-2">
          <ConnectionIndicator state={connectionState} onRetry={onRetry} reconnectAttempt={reconnectAttempt} />
        </div>
      </div>

      <div className="space-y-1">
        <p className="label">{t('sessions.status.latestActivity')}</p>
        {latestTimestamp !== null ? (
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white">{latestLabel}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400" title={formatEventTimestamp(lastEvent?.timestamp)}>
              {formatRelativeTime(latestTimestamp, t)} · {formatEventTimestamp(lastEvent?.timestamp)}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('sessions.status.noTimelineActivity')}</p>
        )}
      </div>
    </div>
  );
}
