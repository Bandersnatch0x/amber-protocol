/**
 * Tests for the inferred transcript↔session association (task #34):
 * pure matching rules (cwd + time-window) and the service-level degradation
 * paths (missing manifest / missing transcripts -> empty candidates).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  matchTranscriptsForSession,
  normalizeDirectoryPath,
  computeWindowOverlap,
  TRANSCRIPT_MATCH_BASIS,
  type MatchableTranscript,
} from '../server/lib/transcript-session-match';
import { candidatesForSession } from '../server/lib/transcript-service';

const REPO_ROOT = 'D:\\code_space\\coding-harness';

function transcript(overrides: Partial<MatchableTranscript> & { id: string }): MatchableTranscript {
  return {
    outline: `outline for ${overrides.id}`,
    startedAt: '2026-08-18T01:00:00.000Z',
    endedAt: '2026-08-18T03:00:00.000Z',
    cwd: REPO_ROOT,
    ...overrides,
  };
}

const SESSION_WINDOW = {
  createdAt: '2026-08-18T01:49:29.512Z',
  lastActivity: '2026-08-18T02:46:43.938Z',
};

describe('matchTranscriptsForSession (pure rules)', () => {
  it('matches when cwd equals the repo root and windows overlap', () => {
    const result = matchTranscriptsForSession({
      transcripts: [transcript({ id: 't-1' })],
      sessionWindow: SESSION_WINDOW,
      repoRoot: REPO_ROOT,
    });

    expect(result).toHaveLength(1);
    expect(result[0].transcriptId).toBe('t-1');
    // Intersection of [01:00,03:00] and [01:49:29,02:46:43].
    expect(result[0].overlapFrom).toBe('2026-08-18T01:49:29.512Z');
    expect(result[0].overlapTo).toBe('2026-08-18T02:46:43.938Z');
    expect(result[0].overlapMs).toBeGreaterThan(0);
    expect(result[0].cwd).toBe(REPO_ROOT);
  });

  it('does not match when the cwd differs', () => {
    const result = matchTranscriptsForSession({
      transcripts: [transcript({ id: 't-1', cwd: 'D:\\code_space\\some-other-repo' })],
      sessionWindow: SESSION_WINDOW,
      repoRoot: REPO_ROOT,
    });

    expect(result).toEqual([]);
  });

  it('does not match when the time windows do not overlap', () => {
    const result = matchTranscriptsForSession({
      transcripts: [
        transcript({
          id: 't-1',
          startedAt: '2026-08-17T00:00:00.000Z',
          endedAt: '2026-08-17T01:00:00.000Z',
        }),
      ],
      sessionWindow: SESSION_WINDOW,
      repoRoot: REPO_ROOT,
    });

    expect(result).toEqual([]);
  });

  it('treats a window that merely touches at session creation as overlap', () => {
    const result = matchTranscriptsForSession({
      transcripts: [
        transcript({
          id: 't-1',
          startedAt: SESSION_WINDOW.createdAt,
          endedAt: SESSION_WINDOW.createdAt,
        }),
      ],
      sessionWindow: { createdAt: SESSION_WINDOW.createdAt },
      repoRoot: REPO_ROOT,
    });

    expect(result).toHaveLength(1);
    expect(result[0].overlapMs).toBe(0);
  });

  it('matches a transcript whose cwd equals the session worktree path', () => {
    const worktree = 'D:\\code_space\\coding-harness\\.amber\\worktrees\\wt-1';
    const result = matchTranscriptsForSession({
      transcripts: [transcript({ id: 't-1', cwd: worktree })],
      sessionWindow: SESSION_WINDOW,
      repoRoot: REPO_ROOT,
      worktreePath: worktree,
    });

    expect(result).toHaveLength(1);
  });

  it('normalizes Windows path case and separators when comparing cwds', () => {
    const result = matchTranscriptsForSession({
      transcripts: [transcript({ id: 't-1', cwd: 'd:/CODE_SPACE/coding-harness\\' })],
      sessionWindow: SESSION_WINDOW,
      repoRoot: REPO_ROOT,
    });

    expect(result).toHaveLength(1);
    expect(normalizeDirectoryPath('D:\\A\\B')).toBe(normalizeDirectoryPath('d:/a/b'));
  });

  it('sorts multiple candidates by overlap duration descending', () => {
    const result = matchTranscriptsForSession({
      transcripts: [
        // 30 min overlap.
        transcript({
          id: 'small',
          startedAt: '2026-08-18T01:49:29.512Z',
          endedAt: '2026-08-18T02:19:29.512Z',
        }),
        // Full session window overlap.
        transcript({ id: 'full' }),
        // 10 min overlap.
        transcript({
          id: 'tiny',
          startedAt: '2026-08-18T02:36:43.938Z',
          endedAt: '2026-08-18T02:46:43.938Z',
        }),
      ],
      sessionWindow: SESSION_WINDOW,
      repoRoot: REPO_ROOT,
    });

    expect(result.map((c) => c.transcriptId)).toEqual(['full', 'small', 'tiny']);
  });

  it('caps the candidate list at five entries', () => {
    const transcripts = Array.from({ length: 8 }, (_, i) => transcript({ id: `t-${i}` }));
    const result = matchTranscriptsForSession({
      transcripts,
      sessionWindow: SESSION_WINDOW,
      repoRoot: REPO_ROOT,
    });

    expect(result).toHaveLength(5);
  });

  it('skips transcripts lacking cwd or timestamps instead of guessing', () => {
    const result = matchTranscriptsForSession({
      transcripts: [
        transcript({ id: 'no-cwd', cwd: undefined }),
        transcript({ id: 'no-start', startedAt: undefined }),
        transcript({ id: 'no-end', endedAt: undefined }),
      ],
      sessionWindow: SESSION_WINDOW,
      repoRoot: REPO_ROOT,
    });

    expect(result).toEqual([]);
  });

  it('returns nothing when the session has no creation time', () => {
    const result = matchTranscriptsForSession({
      transcripts: [transcript({ id: 't-1' })],
      sessionWindow: {},
      repoRoot: REPO_ROOT,
    });

    expect(result).toEqual([]);
  });

  it('computes inclusive window intersections', () => {
    expect(computeWindowOverlap(0, 10, 10, 20)).toEqual({ fromMs: 10, toMs: 10 });
    expect(computeWindowOverlap(0, 10, 11, 20)).toBeNull();
  });
});

describe('candidatesForSession (service degradation)', () => {
  let tmpRoot: string;
  let repoRoot: string;
  let claudeHome: string;
  const sessionId = '00000000-0000-4000-8000-0000000000aa';
  const previousRepoRootEnv = process.env.AMBER_REPO_ROOT;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-match-svc-'));
    repoRoot = path.join(tmpRoot, 'repo');
    claudeHome = path.join(tmpRoot, 'claude-home');
    fs.mkdirSync(path.join(repoRoot, '.amber', 'sessions'), { recursive: true });
    // resolveStatePath reads AMBER_REPO_ROOT per call, so pinning the env here
    // keeps the test hermetic.
    process.env.AMBER_REPO_ROOT = repoRoot;
  });

  afterEach(() => {
    if (previousRepoRootEnv === undefined) {
      delete process.env.AMBER_REPO_ROOT;
    } else {
      process.env.AMBER_REPO_ROOT = previousRepoRootEnv;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function seedSession(manifest: Record<string, unknown>): void {
    const sessionDir = path.join(repoRoot, '.amber', 'sessions', sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  }

  function seedTranscript(id: string, records: Array<Record<string, unknown>>): void {
    const encoded = repoRoot.replace(/[^a-zA-Z0-9]/g, '-');
    const projectDir = path.join(claudeHome, '.claude', 'projects', encoded);
    fs.mkdirSync(projectDir, { recursive: true });
    const lines = records.map((record) => JSON.stringify(record)).join('\n');
    fs.writeFileSync(path.join(projectDir, `${id}.jsonl`), `${lines}\n`);
  }

  it('returns empty candidates (no error) when the manifest is missing', () => {
    const result = candidatesForSession('no-such-session', { repoPath: repoRoot, claudeHome });
    expect(result).toEqual({ candidates: [], basis: TRANSCRIPT_MATCH_BASIS });
  });

  it('returns empty candidates when no transcripts exist', () => {
    seedSession({
      sessionId,
      goal: 'match test',
      status: 'completed',
      route: { id: 'bugfix-quick', version: '1.0.0' },
      createdAt: SESSION_WINDOW.createdAt,
      updatedAt: SESSION_WINDOW.lastActivity,
    });

    const result = candidatesForSession(sessionId, { repoPath: repoRoot, claudeHome });
    expect(result).toEqual({ candidates: [], basis: TRANSCRIPT_MATCH_BASIS });
  });

  it('infers a candidate from real jsonl cwd/timestamps and the manifest window', () => {
    seedSession({
      sessionId,
      goal: 'match test',
      status: 'completed',
      route: { id: 'bugfix-quick', version: '1.0.0' },
      createdAt: SESSION_WINDOW.createdAt,
      updatedAt: SESSION_WINDOW.lastActivity,
    });
    seedTranscript('match-me', [
      // Metadata record without cwd (must be skipped by cwd discovery).
      { type: 'summary', sessionId: 'match-me' },
      {
        type: 'user',
        message: { role: 'user', content: 'hello' },
        timestamp: '2026-08-18T02:00:00.000Z',
        cwd: repoRoot,
      },
      {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        timestamp: '2026-08-18T02:30:00.000Z',
        cwd: repoRoot,
      },
    ]);
    seedTranscript('other-repo', [
      {
        type: 'user',
        message: { role: 'user', content: 'elsewhere' },
        timestamp: '2026-08-18T02:00:00.000Z',
        cwd: path.join(tmpRoot, 'another-repo'),
      },
    ]);

    const result = candidatesForSession(sessionId, { repoPath: repoRoot, claudeHome });
    expect(result.basis).toBe(TRANSCRIPT_MATCH_BASIS);
    expect(result.candidates.map((c) => c.transcriptId)).toEqual(['match-me']);
    expect(result.candidates[0].overlapFrom).toBe('2026-08-18T02:00:00.000Z');
    expect(result.candidates[0].overlapTo).toBe('2026-08-18T02:30:00.000Z');
    expect(result.candidates[0].outline).toBe('hello');
  });

  it('matches via a string-shaped worktree manifest field (CLI schema form)', () => {
    const worktree = path.join(repoRoot, '.amber', 'worktrees', 'wt-1');
    seedSession({
      sessionId,
      goal: 'worktree match test',
      status: 'executing',
      route: { id: 'feature-standard', version: '1.0.0' },
      createdAt: SESSION_WINDOW.createdAt,
      updatedAt: SESSION_WINDOW.lastActivity,
      worktree,
    });
    seedTranscript('wt-transcript', [
      {
        type: 'user',
        message: { role: 'user', content: 'worktree work' },
        timestamp: '2026-08-18T02:00:00.000Z',
        cwd: worktree,
      },
    ]);

    const result = candidatesForSession(sessionId, { repoPath: repoRoot, claudeHome });
    expect(result.candidates.map((c) => c.transcriptId)).toEqual(['wt-transcript']);
  });
});
