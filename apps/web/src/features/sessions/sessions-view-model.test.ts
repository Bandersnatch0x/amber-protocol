import { describe, expect, it } from 'vitest';
import { filterAndSortSessions } from './sessions-view-model';

const sessions = [
  {
    id: 'session-created',
    goal: 'Created session',
    status: 'created',
    route: { id: 'feature-standard', name: 'Standard Feature Development' },
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:05:00.000Z',
  },
  {
    id: 'session-completed',
    goal: 'Completed session',
    status: 'completed',
    route: { id: 'feature-standard', name: 'Standard Feature Development' },
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:10:00.000Z',
  },
  {
    id: 'session-running',
    goal: 'Running session',
    status: 'running',
    route: { id: 'bugfix-quick', name: 'Quick Bug Fix' },
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:15:00.000Z',
  },
];

describe('filterAndSortSessions', () => {
  it('puts active sessions first, then sorts by latest activity descending', () => {
    const result = filterAndSortSessions(sessions, '', '');

    expect(result.map((session) => session.id)).toEqual([
      'session-running',
      'session-created',
      'session-completed',
    ]);
  });

  it('filters by search across goal, session id, and route id', () => {
    expect(filterAndSortSessions(sessions, 'bugfix', '').map((session) => session.id)).toEqual(['session-running']);
    expect(filterAndSortSessions(sessions, 'session-completed', '').map((session) => session.id)).toEqual(['session-completed']);
  });

  it('filters by status after applying search', () => {
    const result = filterAndSortSessions(sessions, 'session', 'completed');
    expect(result.map((session) => session.id)).toEqual(['session-completed']);
  });
});
