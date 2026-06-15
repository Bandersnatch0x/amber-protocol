import type { SessionEvent } from '@/lib/types/session-events';

export function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

export function formatEventTimestamp(value: unknown): string {
  const ts = parseTimestamp(value);
  if (ts === null) return 'Unknown time';
  return new Date(ts).toLocaleString();
}

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  if (seconds > 0) return `${seconds}.${Math.floor((ms % 1000) / 100)}s`;
  return `${ms}ms`;
}

function getString(event: SessionEvent, key: keyof SessionEvent): string | undefined {
  const value = event[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumber(event: SessionEvent, key: keyof SessionEvent): number | undefined {
  const value = event[key];
  return typeof value === 'number' ? value : undefined;
}

export interface EventSummary {
  title?: string;
  details: { label: string; value: string }[];
}

export function getEventSummary(event: SessionEvent): EventSummary {
  const type = event.type;
  const details: { label: string; value: string }[] = [];

  switch (type) {
    case 'session_created': {
      const goal = getString(event, 'goal');
      const sessionId = getString(event, 'sessionId');
      if (goal) details.push({ label: 'Goal', value: goal });
      if (sessionId) details.push({ label: 'Session ID', value: sessionId });
      return { title: goal, details };
    }

    case 'session_started':
    case 'session_resumed': {
      const state = getString(event, 'toState') ?? getString(event, 'status');
      if (state) details.push({ label: 'State', value: state });
      return { details };
    }

    case 'session_paused': {
      const state = getString(event, 'toState') ?? getString(event, 'status');
      if (state) details.push({ label: 'State', value: state });
      return { details };
    }

    case 'session_completed': {
      const state = getString(event, 'toState') ?? getString(event, 'status');
      if (state) details.push({ label: 'Final State', value: state });
      return { details };
    }

    case 'session_aborted': {
      const fromState = getString(event, 'fromState');
      const toState = getString(event, 'toState');
      const reason = getString(event, 'reason');
      if (fromState && toState) details.push({ label: 'Transition', value: `${fromState} → ${toState}` });
      if (reason) details.push({ label: 'Reason', value: reason });
      return { details };
    }

    case 'task_progress': {
      const task = getString(event, 'task');
      const progress = getNumber(event, 'progress');
      if (task) details.push({ label: 'Task', value: task });
      if (progress !== undefined) details.push({ label: 'Progress', value: `${progress}%` });
      return { title: task, details };
    }

    case 'error': {
      const error = getString(event, 'error') ?? getString(event, 'message');
      if (error) details.push({ label: 'Error', value: error });
      return { title: error, details };
    }

    case 'heartbeat':
      return { details };

    default:
      return { details };
  }
}

export interface TimelineMetrics {
  startTime: number | null;
  endTime: number | null;
  duration: number | null;
  typeCounts: Record<string, number>;
}

export function computeTimelineMetrics(events: SessionEvent[] | undefined): TimelineMetrics {
  if (!events || events.length === 0) {
    return { startTime: null, endTime: null, duration: null, typeCounts: {} };
  }

  const timestamps = events.map(e => parseTimestamp(e.timestamp));
  const validTimestamps = timestamps.filter((t): t is number => t !== null);
  const startTime = validTimestamps.length > 0 ? Math.min(...validTimestamps) : null;
  const endTime = validTimestamps.length > 0 ? Math.max(...validTimestamps) : null;
  const duration = startTime !== null && endTime !== null ? endTime - startTime : null;

  const typeCounts = events.reduce((acc, event) => {
    const type = event.type || 'unknown';
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return { startTime, endTime, duration, typeCounts };
}
