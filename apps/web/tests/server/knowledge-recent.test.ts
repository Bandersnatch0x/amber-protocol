import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecentChangeItem } from '../../src/lib/knowledge-dto';
import {
  FEATURE_HISTORY_ARGS,
  GIT_EXECUTABLE,
  GIT_RECENT_ARGS,
  attachVerifiedLink,
  collectAdrChanges,
  collectDriftChanges,
  collectFeatureChanges,
  collectGitChanges,
  collectMaintenanceChanges,
  orderAndCapRecentChanges,
} from '../../server/lib/knowledge-recent';

const scratchRoots: string[] = [];

function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-recent-test-'));
  scratchRoots.push(root);
  return root;
}

function item(id: string, source: RecentChangeItem['source'], time: string): RecentChangeItem {
  return { id, source, title: id, time };
}

afterEach(() => {
  for (const root of scratchRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('knowledge recent-change source adapters', () => {
  it('uses the constant git executable and fixed bounded argv without a shell', async () => {
    const calls: unknown[][] = [];
    const changes = await collectGitChanges('C:/repo', async (executable, args, options) => {
      calls.push([executable, args, options]);
      return {
        stdout:
          'abc123\x1f2026-08-27T08:25:54+08:00\x1ffeat(knowledge): live feed\n' + 'malformed row',
      };
    });

    expect(calls).toEqual([
      [
        GIT_EXECUTABLE,
        GIT_RECENT_ARGS,
        {
          cwd: 'C:/repo',
          encoding: 'utf8',
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
      ],
    ]);
    expect(GIT_EXECUTABLE).toBe('git');
    expect(GIT_RECENT_ARGS).toEqual([
      'log',
      '-n',
      '20',
      '--pretty=format:%H%x1f%cI%x1f%s',
      '--date=iso-strict',
      '--',
      '.',
    ]);
    expect(changes).toEqual([
      {
        id: 'git:abc123',
        source: 'git',
        title: 'feat(knowledge): live feed',
        time: '2026-08-27T08:25:54+08:00',
      },
    ]);
  });

  it('maps non-empty feature-list git history through its own fixed pathspec', async () => {
    const calls: unknown[][] = [];
    const changes = await collectFeatureChanges('C:/repo', async (executable, args, options) => {
      calls.push([executable, args, options]);
      return {
        stdout: 'feature123\x1f2026-08-26T02:16:13+08:00\x1ffix(hooks): update feature state',
      };
    });

    expect(calls).toEqual([
      [
        GIT_EXECUTABLE,
        FEATURE_HISTORY_ARGS,
        {
          cwd: 'C:/repo',
          encoding: 'utf8',
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
      ],
    ]);
    expect(FEATURE_HISTORY_ARGS).toEqual([
      'log',
      '-n',
      '20',
      '--pretty=format:%H%x1f%cI%x1f%s',
      '--date=iso-strict',
      '--',
      'feature_list.json',
    ]);
    expect(changes).toEqual([
      {
        id: 'feature:feature123',
        source: 'feature',
        title: 'fix(hooks): update feature state',
        time: '2026-08-26T02:16:13+08:00',
      },
    ]);
  });

  it('parses ADR Date lines and maps them to the real governance route', () => {
    const root = scratch();
    const adrRoot = path.join(root, 'docs', 'adr');
    fs.mkdirSync(adrRoot, { recursive: true });
    fs.writeFileSync(
      path.join(adrRoot, '0001-example.md'),
      '# Example decision\n\n**Status:** Accepted\n**Date:** 2026-08-20\n',
    );
    fs.writeFileSync(path.join(adrRoot, '0002-undated.md'), '# Undated decision\n');

    expect(collectAdrChanges(root)).toEqual([
      {
        id: 'adr:0001-example:2026-08-20',
        source: 'adr',
        title: 'Example decision',
        time: '2026-08-20',
        linkTo: 'governance',
      },
    ]);
  });

  it('maps graph drift deterministically while preserving finding content', () => {
    const changes = collectDriftChanges([
      { nodeId: 'feature:F007', kind: 'dead-anchor', path: 'b.ts', detail: 'second finding' },
      { nodeId: 'feature:F001', kind: 'dead-anchor', path: 'a.ts', detail: 'first finding' },
    ]);

    expect(changes).toHaveLength(2);
    expect(changes.map((change) => change.title).sort()).toEqual([
      'first finding',
      'second finding',
    ]);
    expect(changes.every((change) => change.source === 'drift' && change.time === '')).toBe(true);
  });

  it('passes maintenance finding text through without synthetic interpretation', () => {
    const changes = collectMaintenanceChanges({
      wikiLint: { errors: ['broken wiki link'], warnings: [] },
      evolutionRollup: [{ text: 'repeated tool failure' }],
      regressionProposals: [{ taskId: 'failure-1', assertion: 'retry should preserve evidence' }],
      errors: ['registry unavailable'],
    });

    expect(changes.map((change) => change.title).sort()).toEqual([
      'broken wiki link',
      'registry unavailable',
      'repeated tool failure',
      'retry should preserve evidence',
    ]);
    expect(changes.every((change) => change.source === 'maintenance')).toBe(true);
  });
});

describe('knowledge recent-change ordering and links', () => {
  it('pins all drift first, sorts dated rows newest-first with an id tie-break, and caps at 50', () => {
    const changes = [
      item('dated:b', 'git', '2026-08-20T00:00:00Z'),
      item('drift:z', 'drift', ''),
      item('dated:a', 'adr', '2026-08-20'),
      item('newest', 'feature', '2026-08-21'),
      item('maintenance:a', 'maintenance', ''),
      item('drift:a', 'drift', ''),
      ...Array.from({ length: 60 }, (_, index) =>
        item(`older:${String(index).padStart(2, '0')}`, 'git', '2026-01-01'),
      ),
    ];

    const ordered = orderAndCapRecentChanges(changes, 100);
    const result = orderAndCapRecentChanges(changes);

    expect(result).toHaveLength(50);
    expect(ordered.slice(0, 2).map((change) => change.id)).toEqual(['drift:a', 'drift:z']);
    expect(ordered.slice(2, 5).map((change) => change.id)).toEqual([
      'newest',
      'dated:a',
      'dated:b',
    ]);
    expect(ordered.at(-1)?.id).toBe('maintenance:a');
    expect(result.some((change) => change.source === 'maintenance')).toBe(false);
  });

  it('emits each supported jump only for an id present in the corresponding live reader set', () => {
    const live = {
      sessionIds: new Set(['session-real']),
      gateIds: new Set(['gate-real']),
      transcriptIds: new Set(['transcript-real']),
      routeIds: new Set(['route-real']),
      featureIds: new Set(['F059']),
    };
    const cases: Array<[string, RecentChangeItem['linkTo'], string]> = [
      ['changed session-real', 'sessions', 'session-real'],
      ['resolved gate-real', 'gates', 'gate-real'],
      ['reviewed transcript-real', 'transcripts', 'transcript-real'],
      ['updated route-real', 'routes', 'route-real'],
      ['completed F059', 'governance', 'F059'],
    ];

    for (const [title, linkTo, linkId] of cases) {
      expect(
        attachVerifiedLink({ id: title, source: 'git', title, time: '2026-08-20' }, live),
      ).toMatchObject({
        linkTo,
        linkId,
        linkLabel: linkId,
      });
    }

    expect(
      attachVerifiedLink(
        {
          id: 'invalid',
          source: 'git',
          title: 'placeholder-session',
          time: '2026-08-20',
          linkTo: 'sessions',
          linkId: 'placeholder-session',
        },
        live,
      ),
    ).not.toHaveProperty('linkTo');
  });
});
