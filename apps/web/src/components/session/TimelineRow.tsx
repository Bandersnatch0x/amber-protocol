
import { SessionEvent } from '@/lib/types/session-events';

interface TimelineRowProps {
  event: SessionEvent;
  onClick?: (event: SessionEvent) => void;
}

const eventLabels: Record<SessionEvent['type'], string> = {
  session_started: 'Session Started',
  session_paused: 'Session Paused',
  session_resumed: 'Session Resumed',
  session_completed: 'Session Completed',
  session_aborted: 'Session Aborted',
  task_progress: 'Task Progress',
  error: 'Error',
  heartbeat: 'Heartbeat',
};

export function TimelineRow({ event, onClick }: TimelineRowProps) {
  const timestamp = 'timestamp' in event ? new Date(event.timestamp).toLocaleTimeString() : '';

  return (
    <div
      onClick={() => onClick?.(event)}
      className="h-[60px] flex items-center px-4 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
    >
      <div className="flex-1">
        <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
          {eventLabels[event.type]}
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {timestamp}
          {event.type === 'task_progress' && ` - ${event.task}: ${event.progress}%`}
          {event.type === 'error' && ` - ${event.error}`}
          {event.type === 'session_aborted' && event.reason && ` - ${event.reason}`}
        </div>
      </div>
    </div>
  );
}
