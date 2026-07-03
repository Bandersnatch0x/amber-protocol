export interface TimelineEventConfig {
  label: string;
  icon: string;
  color: string;
}

export const TIMELINE_EVENT_CONFIG: Record<string, TimelineEventConfig> = {
  session_created: { label: 'Session Created', icon: '🆕', color: 'text-blue-600 dark:text-blue-400' },
  session_started: { label: 'Session Started', icon: '▶️', color: 'text-blue-600 dark:text-blue-400' },
  session_paused: { label: 'Session Paused', icon: '⏸️', color: 'text-amber-600 dark:text-amber-400' },
  session_resumed: { label: 'Session Resumed', icon: '▶️', color: 'text-blue-600 dark:text-blue-400' },
  session_completed: { label: 'Session Completed', icon: '✅', color: 'text-emerald-600 dark:text-emerald-400' },
  session_aborted: { label: 'Session Aborted', icon: '❌', color: 'text-red-600 dark:text-red-400' },
  session_failed: { label: 'Session Failed', icon: '❌', color: 'text-red-600 dark:text-red-400' },
  route_selected: { label: 'Route Selected', icon: '🧭', color: 'text-blue-600 dark:text-blue-400' },
  stage_started: { label: 'Stage Started', icon: '▶️', color: 'text-blue-600 dark:text-blue-400' },
  stage_completed: { label: 'Stage Completed', icon: '✔️', color: 'text-emerald-600 dark:text-emerald-400' },
  stage_failed: { label: 'Stage Failed', icon: '✖️', color: 'text-red-600 dark:text-red-400' },
  gate_triggered: { label: 'Gate Triggered', icon: '🚦', color: 'text-amber-600 dark:text-amber-400' },
  gate_passed: { label: 'Gate Passed', icon: '✅', color: 'text-emerald-600 dark:text-emerald-400' },
  gate_failed: { label: 'Gate Failed', icon: '🛑', color: 'text-red-600 dark:text-red-400' },
  budget_warning: { label: 'Budget Warning', icon: '⚠️', color: 'text-amber-600 dark:text-amber-400' },
  budget_exceeded: { label: 'Budget Exceeded', icon: '🔴', color: 'text-red-600 dark:text-red-400' },
  task_progress: { label: 'Task Progress', icon: '🔵', color: 'text-violet-600 dark:text-violet-400' },
  error: { label: 'Error', icon: '⚠️', color: 'text-red-600 dark:text-red-400' },
  heartbeat: { label: 'Heartbeat', icon: '💓', color: 'text-slate-500 dark:text-slate-400' },
};

export function getTimelineEventConfig(type: string): TimelineEventConfig {
  return TIMELINE_EVENT_CONFIG[type] ?? { label: type, icon: '○', color: 'text-slate-500 dark:text-slate-400' };
}

export const TIMELINE_EVENT_TYPES = Object.entries(TIMELINE_EVENT_CONFIG).map(([value, config]) => ({
  value,
  label: config.label,
}));
