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

// SessionEvent is a discriminated union; after normalizeEvent flattens `data`
// onto the top level, stage/command/gateId/etc. are present at runtime but not
// always on every union member's static type. Index via a record view.
function field(event: SessionEvent, key: string): unknown {
  return (event as unknown as Record<string, unknown>)[key];
}

function getString(event: SessionEvent, key: string): string | undefined {
  const value = field(event, key);
  return typeof value === 'string' ? value : undefined;
}

function getNumber(event: SessionEvent, key: string): number | undefined {
  const value = field(event, key);
  return typeof value === 'number' ? value : undefined;
}

export interface EventSummary {
  title?: string;
  details: { label: string; value: string }[];
}

// Shared extraction for state-transition events: prefer toState, fall back to
// status, then push a single detail row under the given label. Previously
// duplicated verbatim across session_started/resumed/paused/completed.
function stateTransitionDetails(
  event: SessionEvent,
  label: string,
): { details: { label: string; value: string }[] } {
  const details: { label: string; value: string }[] = [];
  const state = getString(event, 'toState') ?? getString(event, 'status');
  if (state) details.push({ label, value: state });
  return { details };
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
    case 'session_resumed':
    case 'session_paused':
      return stateTransitionDetails(event, 'State');

    case 'session_completed':
      return stateTransitionDetails(event, 'Final State');

    case 'session_aborted': {
      const fromState = getString(event, 'fromState');
      const toState = getString(event, 'toState');
      const reason = getString(event, 'reason');
      if (fromState && toState)
        details.push({ label: 'Transition', value: `${fromState} → ${toState}` });
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

    case 'runner_control_requested':
    case 'runner_ack':
    case 'runner_rejected':
    case 'runner_timeout': {
      const requestId = getString(event, 'requestId');
      const action = getString(event, 'action');
      const requestedStatus = getString(event, 'requestedStatus');
      const runnerStatus = getString(event, 'runnerStatus');
      const source = getString(event, 'source');
      const message = getString(event, 'message');
      if (requestId) details.push({ label: 'Request ID', value: requestId });
      if (action) details.push({ label: 'Action', value: action });
      if (requestedStatus) details.push({ label: 'Requested Status', value: requestedStatus });
      if (runnerStatus) details.push({ label: 'Runner Status', value: runnerStatus });
      if (source) details.push({ label: 'Source', value: source });
      if (message) details.push({ label: 'Message', value: message });
      return { title: message ?? requestId, details };
    }

    case 'error': {
      const error = getString(event, 'error') ?? getString(event, 'message');
      if (error) details.push({ label: 'Error', value: error });
      return { title: error, details };
    }

    // CLI session verify --execute writes these; normalizeEvent flattens data.*
    // onto the event so command/result/exitCode are top-level fields here.
    case 'stage_completed':
    case 'stage_started':
    case 'stage_failed':
    case 'verification_failed': {
      const stage = getString(event, 'stage') ?? getString(event, 'displayName');
      const command = getString(event, 'command');
      const result = getString(event, 'result');
      const exitCode = getNumber(event, 'exitCode');
      const durationMs = getNumber(event, 'durationMs');
      if (stage) details.push({ label: 'Stage', value: stage });
      if (command) details.push({ label: 'Command', value: command });
      if (result) details.push({ label: 'Result', value: result });
      if (exitCode !== undefined) details.push({ label: 'Exit Code', value: String(exitCode) });
      if (durationMs !== undefined)
        details.push({ label: 'Duration', value: formatDuration(durationMs) });
      return { title: command ?? stage, details };
    }

    case 'gate_triggered':
    case 'gate_passed':
    case 'gate_failed': {
      const gateId = getString(event, 'gateId') ?? getString(event, 'gate');
      if (gateId) details.push({ label: 'Gate', value: gateId });
      const reason = getString(event, 'reason');
      if (reason) details.push({ label: 'Reason', value: reason });
      return { title: gateId, details };
    }

    case 'checkpoint_created': {
      const label = getString(event, 'label') ?? getString(event, 'checkpointId');
      if (label) details.push({ label: 'Checkpoint', value: label });
      return { title: label, details };
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

  const timestamps = events.map((e) => parseTimestamp(e.timestamp));
  const validTimestamps = timestamps.filter((t): t is number => t !== null);
  const startTime = validTimestamps.length > 0 ? Math.min(...validTimestamps) : null;
  const endTime = validTimestamps.length > 0 ? Math.max(...validTimestamps) : null;
  const duration = startTime !== null && endTime !== null ? endTime - startTime : null;

  const typeCounts = events.reduce(
    (acc, event) => {
      const type = event.type || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return { startTime, endTime, duration, typeCounts };
}

/**
 * Merge timeline (disk source-of-truth) and SSE events (acceleration layer),
 * deduplicate by exact (type, timestampMs), filter heartbeats, return ascending.
 */
export function mergeActivityEvents(timeline: SessionEvent[], sse: SessionEvent[]): SessionEvent[] {
  const seen = new Set<string>();
  const merged: SessionEvent[] = [];

  for (const event of timeline) {
    const key = `${event.type}|${parseTimestamp(event.timestamp)}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(event);
    }
  }

  for (const event of sse) {
    if (event.type === 'heartbeat') continue;
    const key = `${event.type}|${parseTimestamp(event.timestamp)}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(event);
    }
  }

  return merged.sort((a, b) => parseTimestamp(a.timestamp)! - parseTimestamp(b.timestamp)!);
}
