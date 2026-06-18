import { describe, it, expect } from 'vitest';
import path from 'path';
import os from 'os';
import { resolveWithin } from '../server/lib/safe-path';
import { readSessionById, readTimelineEvents } from '../server/lib/session-reader';
import { getRouteById } from '../server/lib/route-reader';

describe('resolveWithin', () => {
  const base = path.resolve(os.tmpdir(), 'amber-safe-path-base');

  it('resolves a plain id under the base directory', () => {
    const out = resolveWithin(base, 'abc-123');
    expect(out).toBe(path.join(base, 'abc-123'));
  });

  it('resolves an id with dots/dashes that does not escape', () => {
    const out = resolveWithin(base, '2026-06-19T10.00.00');
    expect(out).toBe(path.join(base, '2026-06-19T10.00.00'));
  });

  it('rejects a parent-traversal id', () => {
    expect(resolveWithin(base, '../../../../etc/passwd')).toBeNull();
  });

  it('rejects a bare ".." id', () => {
    expect(resolveWithin(base, '..')).toBeNull();
  });

  it('rejects an absolute path segment', () => {
    expect(resolveWithin(base, path.resolve(os.tmpdir(), 'elsewhere'))).toBeNull();
  });

  it('rejects an empty id (resolves to the base itself)', () => {
    expect(resolveWithin(base, '')).toBeNull();
  });
});

describe('session/route readers reject path traversal', () => {
  it('readSessionById returns null for a traversal id', () => {
    expect(readSessionById('../../../../../../../../etc')).toBeNull();
  });

  it('readTimelineEvents returns [] for a traversal id', () => {
    expect(readTimelineEvents('../../../../../../../../etc')).toEqual([]);
  });

  it('getRouteById returns null for a traversal id', () => {
    expect(getRouteById('../../../../../../package')).toBeNull();
  });
});
