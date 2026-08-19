import { getTimelineEventConfig } from './timeline-config';

export function EventIcon({ type }: { type: string }) {
  const config = getTimelineEventConfig(type);

  return (
    <div
      className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 font-mono text-[10px] font-semibold uppercase tracking-wide dark:bg-slate-800 ${config.color}`}
    >
      <span>{config.icon}</span>
    </div>
  );
}
