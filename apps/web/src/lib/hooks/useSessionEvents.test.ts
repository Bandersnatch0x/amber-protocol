import { describe, it, expect } from 'vitest';
import { statusFromEventType } from '@/lib/hooks/useSessionEvents';

// Unit tests for statusFromEventType — the pure event-type→status mapping
// extracted from the useSessionEvents onmessage if/else ladder. This is the
// new testable surface; the mapping was previously buried in a side-effectful
// React hook.

describe('statusFromEventType', () => {
  it('maps session_started to running', () => {
    expect(statusFromEventType('session_started')).toBe('running');
  });

  it('maps session_resumed to running', () => {
    expect(statusFromEventType('session_resumed')).toBe('running');
  });

  it('maps session_paused to paused', () => {
    expect(statusFromEventType('session_paused')).toBe('paused');
  });

  it('maps session_completed to completed', () => {
    expect(statusFromEventType('session_completed')).toBe('completed');
  });

  it('maps session_aborted to aborted', () => {
    expect(statusFromEventType('session_aborted')).toBe('aborted');
  });

  it('returns null for events that do not change status', () => {
    expect(statusFromEventType('session_created')).toBeNull();
    expect(statusFromEventType('task_progress')).toBeNull();
    expect(statusFromEventType('error')).toBeNull();
    expect(statusFromEventType('heartbeat')).toBeNull();
  });
});
