import { getTimelineEventConfig } from './timeline-config';

export function EventIcon({ type }: { type: string }) {
  const config = getTimelineEventConfig(type);

  return (
    <div className={`flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 ${config.color}`}>
      <span className="text-xl">{config.icon}</span>
    </div>
  );
}
