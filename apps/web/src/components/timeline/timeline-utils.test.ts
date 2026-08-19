import { describe, it, expect } from 'vitest';
import type { SessionEvent } from '@/lib/types/session-events';
import {
  parseTimestamp,
  formatEventTimestamp,
  formatDuration,
  getEventSummary,
  computeTimelineMetrics,
} from '@/components/timeline/timeline-utils';

// Characterization tests: timeline-utils had zero coverage. These pin current
// behavior as a safety net before the getEventSummary state-extraction is
// consolidated. The events use the loose shape the runtime timeline actually
// emits (toState/fromState/status are not in the zod schema but are read by
// getEventSummary via its keyof-indexed getters).

function event(partial: Partial<SessionEvent> & { type: string }): SessionEvent {
  return { timestamp: '2025-01-01T00:00:00Z', ...partial } as SessionEvent;
}

describe('parseTimestamp', () => {
  it('passes through numbers', () => {
    expect(parseTimestamp(123456)).toBe(123456);
  });
  it('parses ISO strings', () => {
    expect(typeof parseTimestamp('2025-01-01T00:00:00Z')).toBe('number');
  });
  it('returns null for unparseable strings', () => {
    expect(parseTimestamp('not a date')).toBeNull();
  });
  it('returns null for empty/unknown input', () => {
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp(null)).toBeNull();
  });
});

describe('formatEventTimestamp', () => {
  it('returns Unknown time for unparseable input', () => {
    expect(formatEventTimestamp('nope')).toBe('Unknown time');
  });
  it('returns a locale string for valid input', () => {
    expect(formatEventTimestamp('2025-01-01T00:00:00Z')).toMatch(/\d/);
  });
});

describe('formatDuration', () => {
  it('clamps negative durations to 0', () => {
    expect(formatDuration(-100)).toBe('0ms');
  });
  it('formats milliseconds', () => {
    expect(formatDuration(500)).toBe('500ms');
  });
  it('formats seconds with a decimal', () => {
    expect(formatDuration(1500)).toBe('1.5s');
  });
  it('formats minutes', () => {
    expect(formatDuration(65_000)).toBe('1m 5s');
  });
  it('formats hours', () => {
    expect(formatDuration(3_661_000)).toBe('1h 1m 1s');
  });
  it('formats days', () => {
    expect(formatDuration(900_61000)).toMatch(/1d 1h 1m/);
  });
});

describe('getEventSummary', () => {
  it('session_created surfaces goal as title and session id', () => {
    const summary = getEventSummary(
      event({ type: 'session_created', goal: 'ship it', sessionId: 's1' }),
    );
    expect(summary.title).toBe('ship it');
    expect(summary.details).toContainEqual({ label: 'Goal', value: 'ship it' });
    expect(summary.details).toContainEqual({ label: 'Session ID', value: 's1' });
  });

  it('session_started prefers toState, falls back to status', () => {
    expect(
      getEventSummary(event({ type: 'session_started', toState: 'running' } as never)).details,
    ).toContainEqual({ label: 'State', value: 'running' });
    expect(
      getEventSummary(event({ type: 'session_started', status: 'running' } as never)).details,
    ).toContainEqual({ label: 'State', value: 'running' });
  });

  it('session_resumed uses the State label', () => {
    expect(
      getEventSummary(event({ type: 'session_resumed', toState: 'running' } as never)).details,
    ).toContainEqual({ label: 'State', value: 'running' });
  });

  it('session_paused uses the State label', () => {
    expect(
      getEventSummary(event({ type: 'session_paused', toState: 'paused' } as never)).details,
    ).toContainEqual({ label: 'State', value: 'paused' });
  });

  it('session_completed uses the Final State label', () => {
    expect(
      getEventSummary(event({ type: 'session_completed', toState: 'completed' } as never)).details,
    ).toContainEqual({ label: 'Final State', value: 'completed' });
  });

  it('session_aborted records the transition and reason', () => {
    const summary = getEventSummary(
      event({
        type: 'session_aborted',
        fromState: 'running',
        toState: 'aborted',
        reason: 'user',
      } as never),
    );
    expect(summary.details).toContainEqual({ label: 'Transition', value: 'running → aborted' });
    expect(summary.details).toContainEqual({ label: 'Reason', value: 'user' });
  });

  it('task_progress surfaces task as title and progress percent', () => {
    const summary = getEventSummary(event({ type: 'task_progress', task: 'build', progress: 42 }));
    expect(summary.title).toBe('build');
    expect(summary.details).toContainEqual({ label: 'Task', value: 'build' });
    expect(summary.details).toContainEqual({ label: 'Progress', value: '42%' });
  });

  it('error surfaces the error message as title', () => {
    const summary = getEventSummary(event({ type: 'error', error: 'boom' }));
    expect(summary.title).toBe('boom');
    expect(summary.details).toContainEqual({ label: 'Error', value: 'boom' });
  });

  it('error falls back to message when error is absent', () => {
    expect(
      getEventSummary(event({ type: 'error', message: 'alt' } as never)).details,
    ).toContainEqual({ label: 'Error', value: 'alt' });
  });

  it('heartbeat returns no details', () => {
    expect(getEventSummary(event({ type: 'heartbeat' }))).toEqual({ details: [] });
  });

  it('unknown types return no details', () => {
    expect(getEventSummary(event({ type: 'mystery' } as never))).toEqual({ details: [] });
  });

  it('stage_completed surfaces command and exit code from flattened data', () => {
    const summary = getEventSummary(
      event({
        type: 'stage_completed',
        stage: 'verify',
        command: 'npm test',
        result: 'passed',
        exitCode: 0,
        durationMs: 1200,
      } as never),
    );
    expect(summary.title).toBe('npm test');
    expect(summary.details).toContainEqual({ label: 'Stage', value: 'verify' });
    expect(summary.details).toContainEqual({ label: 'Command', value: 'npm test' });
    expect(summary.details).toContainEqual({ label: 'Exit Code', value: '0' });
  });

  it('verification_failed surfaces command and exit code', () => {
    const summary = getEventSummary(
      event({
        type: 'verification_failed',
        stage: 'verify',
        command: 'npm test',
        exitCode: 1,
      } as never),
    );
    expect(summary.title).toBe('npm test');
    expect(summary.details).toContainEqual({ label: 'Command', value: 'npm test' });
    expect(summary.details).toContainEqual({ label: 'Exit Code', value: '1' });
  });

  it('gate_passed surfaces gate id from gateId or gate', () => {
    expect(
      getEventSummary(event({ type: 'gate_passed', gateId: 'user-approval-plan' } as never)).title,
    ).toBe('user-approval-plan');
    expect(
      getEventSummary(event({ type: 'gate_passed', gate: 'user-approval-implement' } as never))
        .title,
    ).toBe('user-approval-implement');
  });
});

describe('computeTimelineMetrics', () => {
  it('returns nulls for empty input', () => {
    expect(computeTimelineMetrics([])).toEqual({
      startTime: null,
      endTime: null,
      duration: null,
      typeCounts: {},
    });
    expect(computeTimelineMetrics(undefined)).toEqual({
      startTime: null,
      endTime: null,
      duration: null,
      typeCounts: {},
    });
  });

  it('computes start, end, duration, and type counts', () => {
    const events = [
      event({ type: 'session_created', timestamp: '2025-01-01T00:00:00Z' }),
      event({ type: 'task_progress', timestamp: '2025-01-01T00:00:10Z', task: 't', progress: 1 }),
      event({ type: 'session_completed', timestamp: '2025-01-01T00:01:00Z' }),
    ];
    const metrics = computeTimelineMetrics(events);
    expect(metrics.startTime).not.toBeNull();
    expect(metrics.endTime).not.toBeNull();
    expect(metrics.endTime! - metrics.startTime!).toBe(metrics.duration);
    expect(metrics.typeCounts).toEqual({
      session_created: 1,
      task_progress: 1,
      session_completed: 1,
    });
  });

  it('counts unknown types as unknown', () => {
    const metrics = computeTimelineMetrics([event({ type: '' } as never)]);
    expect(metrics.typeCounts).toEqual({ unknown: 1 });
  });
});
