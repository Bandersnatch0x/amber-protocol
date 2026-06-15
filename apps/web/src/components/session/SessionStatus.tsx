import { StatusBadge } from './StatusBadge';
import { ConnectionIndicator } from './ConnectionIndicator';
import type { SessionEvent, SessionStatus as SessionStatusType } from '@/lib/types/session-events';

type ConnectionState = 'connecting' | 'open' | 'closed' | 'error';

interface SessionStatusProps {
  status: SessionStatusType | null;
  connectionState: ConnectionState;
  lastEvent: SessionEvent | null;
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function SessionStatus({ status, connectionState, lastEvent }: SessionStatusProps) {
  const isStale = lastEvent && 'timestamp' in lastEvent && Date.now() - lastEvent.timestamp > 5000;

  return (
    <div className="flex items-center gap-4">
      <StatusBadge status={status} />
      <ConnectionIndicator state={connectionState} />
      {lastEvent && 'timestamp' in lastEvent && (
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {formatRelativeTime(lastEvent.timestamp)}
          {isStale && connectionState !== 'open' && ' (disconnected)'}
        </span>
      )}
    </div>
  );
}
