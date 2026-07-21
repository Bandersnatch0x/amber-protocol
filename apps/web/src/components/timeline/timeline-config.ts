export interface TimelineEventConfig {
  label: string;
  icon: string;
  color: string;
}

export const TIMELINE_EVENT_CONFIG: Record<string, TimelineEventConfig> = {
  session_created: { label: 'Session Created', icon: 'SC', color: 'text-blue-600 dark:text-blue-400' },
  session_started: { label: 'Session Started', icon: 'SS', color: 'text-blue-600 dark:text-blue-400' },
  session_paused: { label: 'Session Paused', icon: 'SP', color: 'text-amber-600 dark:text-amber-400' },
  session_resumed: { label: 'Session Resumed', icon: 'SR', color: 'text-blue-600 dark:text-blue-400' },
  session_completed: { label: 'Session Completed', icon: 'OK', color: 'text-emerald-600 dark:text-emerald-400' },
  session_aborted: { label: 'Session Aborted', icon: 'AB', color: 'text-red-600 dark:text-red-400' },
  session_failed: { label: 'Session Failed', icon: 'FL', color: 'text-red-600 dark:text-red-400' },
  route_selected: { label: 'Route Selected', icon: 'RT', color: 'text-blue-600 dark:text-blue-400' },
  stage_started: { label: 'Stage Started', icon: 'ST', color: 'text-blue-600 dark:text-blue-400' },
  stage_completed: { label: 'Stage Completed', icon: 'OK', color: 'text-emerald-600 dark:text-emerald-400' },
  stage_failed: { label: 'Stage Failed', icon: 'FL', color: 'text-red-600 dark:text-red-400' },
  // Written by session verify --execute on non-zero exit (CLI SSOT).
  verification_failed: { label: 'Verification Failed', icon: 'VF', color: 'text-red-600 dark:text-red-400' },
  checkpoint_created: { label: 'Checkpoint Created', icon: 'CP', color: 'text-blue-600 dark:text-blue-400' },
  gate_triggered: { label: 'Gate Triggered', icon: 'GT', color: 'text-amber-600 dark:text-amber-400' },
  gate_passed: { label: 'Gate Passed', icon: 'GP', color: 'text-emerald-600 dark:text-emerald-400' },
  gate_failed: { label: 'Gate Failed', icon: 'GF', color: 'text-red-600 dark:text-red-400' },
  budget_warning: { label: 'Budget Warning', icon: 'BW', color: 'text-amber-600 dark:text-amber-400' },
  budget_exceeded: { label: 'Budget Exceeded', icon: 'BX', color: 'text-red-600 dark:text-red-400' },
  runner_control_requested: { label: 'Runner Control Requested', icon: 'RQ', color: 'text-blue-600 dark:text-blue-400' },
  runner_ack: { label: 'Runner ACK', icon: 'AK', color: 'text-emerald-600 dark:text-emerald-400' },
  runner_rejected: { label: 'Runner Rejected', icon: 'RJ', color: 'text-red-600 dark:text-red-400' },
  runner_timeout: { label: 'Runner Timeout', icon: 'TO', color: 'text-amber-600 dark:text-amber-400' },
  task_progress: { label: 'Task Progress', icon: 'TP', color: 'text-blue-600 dark:text-blue-300' },
  error: { label: 'Error', icon: 'ER', color: 'text-red-600 dark:text-red-400' },
  heartbeat: { label: 'Heartbeat', icon: 'HB', color: 'text-slate-500 dark:text-slate-400' },
};

export function getTimelineEventConfig(type: string): TimelineEventConfig {
  return TIMELINE_EVENT_CONFIG[type] ?? { label: type, icon: '??', color: 'text-slate-500 dark:text-slate-400' };
}

export const TIMELINE_EVENT_TYPES = Object.entries(TIMELINE_EVENT_CONFIG).map(([value, config]) => ({
  value,
  label: config.label,
}));
