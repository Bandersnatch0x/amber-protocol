
import { useI18n, type I18nKey } from '@/lib/i18n';
import { SessionEvent } from '@/lib/types/session-events';

interface TimelineRowProps {
  event: SessionEvent;
  onClick?: (event: SessionEvent) => void;
}

export function TimelineRow({ event, onClick }: TimelineRowProps) {
  const { t } = useI18n();
  const timestamp = 'timestamp' in event ? new Date(event.timestamp).toLocaleTimeString() : '';

  return (
    <div
      onClick={() => onClick?.(event)}
      className="h-[60px] flex items-center px-4 border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
    >
      <div className="flex-1">
        <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
          {t(`timeline.event.${event.type}` as I18nKey)}
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
