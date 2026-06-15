import { describe, it, expect } from 'vitest';
import { SessionStatusSchema, SessionEventSchema } from '@server/types/session-events';

describe('Session status transitions', () => {
  const transitions: Record<string, string[]> = {
    idle: ['running'],
    running: ['paused', 'aborted', 'completed'],
    paused: ['running', 'aborted'],
    completed: [],
    aborted: [],
  };

  it.each([
    ['idle', 'running', true],
    ['running', 'paused', true],
    ['paused', 'running', true],
    ['running', 'completed', true],
    ['idle', 'paused', false],
    ['completed', 'running', false],
    ['aborted', 'running', false],
  ])('should validate transition %s -> %s', (from, to, valid) => {
    const allowed = transitions[from]?.includes(to) ?? false;
    expect(allowed).toBe(valid);
  });
});

describe('SessionStatusSchema', () => {
  it('should accept valid statuses', () => {
    expect(SessionStatusSchema.parse('idle')).toBe('idle');
    expect(SessionStatusSchema.parse('running')).toBe('running');
    expect(SessionStatusSchema.parse('paused')).toBe('paused');
    expect(SessionStatusSchema.parse('completed')).toBe('completed');
    expect(SessionStatusSchema.parse('aborted')).toBe('aborted');
  });

  it('should reject invalid statuses', () => {
    expect(() => SessionStatusSchema.parse('invalid')).toThrow();
  });
});

describe('SessionEventSchema', () => {
  it('should validate session_started event', () => {
    const event = { type: 'session_started' as const, sessionId: 's1', timestamp: 1000 };
    expect(SessionEventSchema.parse(event)).toEqual(event);
  });

  it('should validate heartbeat event', () => {
    const event = { type: 'heartbeat' as const, timestamp: 1000 };
    expect(SessionEventSchema.parse(event)).toEqual(event);
  });

  it('should reject event with missing required field', () => {
    expect(() => SessionEventSchema.parse({ type: 'session_started', timestamp: 1000 })).toThrow();
  });

  it('should reject event with unknown type', () => {
    expect(() => SessionEventSchema.parse({ type: 'unknown', timestamp: 1000 })).toThrow();
  });
});