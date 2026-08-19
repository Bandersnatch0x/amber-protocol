import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Hermetic Claude Code transcript fixture for the transcript timeline e2e.
 *
 * Seeded under `<AMBER_CLAUDE_HOME>/.claude/projects/<encode(e2eRepoRoot)>/`
 * so `transcript.list`/`transcript.read` resolve it through the same read
 * path as production (AMBER_REPO_ROOT + AMBER_CLAUDE_HOME). Covers noise
 * classes N1-N5 and N8 plus two ordinary conversation turns.
 */

export const FIXTURE_TRANSCRIPT_ID = 'fixture-transcript';

// Must match server/lib/claude-transcript-reader.ts encodeProjectPath.
function encodeProjectPath(repoPath: string): string {
  return repoPath.replace(/[^a-zA-Z0-9]/g, '-');
}

export function getE2EClaudeHome(): string {
  const override = process.env.AMBER_E2E_CLAUDE_HOME;
  if (override) return path.resolve(override);

  const repoKey = path.resolve(process.cwd(), '..', '..').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `amber-web-e2e-claude-home-${repoKey}`);
}

function fixtureRecords(): Array<Record<string, unknown>> {
  return [
    // Ordinary conversation turns.
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'E2E fixture: please walk through the transcript denoising rules.',
          },
        ],
      },
      timestamp: '2026-06-20T00:00:00.000Z',
      gitBranch: 'main',
    },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'The pipeline hides metadata envelopes and folds local command noise into single-line chips.',
          },
        ],
      },
      timestamp: '2026-06-20T00:00:10.000Z',
    },
    // N1: local-command-caveat (whole message wrapped -> hidden via R1).
    {
      type: 'user',
      isMeta: true,
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<local-command-caveat>Caveat: this local command output is only visible to you.</local-command-caveat>',
          },
        ],
      },
      timestamp: '2026-06-20T00:00:20.000Z',
    },
    // N2: slash command invocation (folded chip via R2). The >15min gap from
    // the previous visible record also exercises the turn separator.
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>',
          },
        ],
      },
      timestamp: '2026-06-20T00:20:00.000Z',
    },
    // N3 + N4: local command stdout with ANSI escapes (folded line via R3).
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<local-command-stdout>\u001b[1mFable 5\u001b[22m is ready</local-command-stdout>',
          },
        ],
      },
      timestamp: '2026-06-20T00:20:05.000Z',
    },
    // N5: task notification (summary extracted via R5).
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<task-notification>\n<summary>Background agent completed the regression sweep.</summary>\n</task-notification>',
          },
        ],
      },
      timestamp: '2026-06-20T00:20:10.000Z',
    },
    // N8: away_summary recap (folded line via R8, subtype passthrough).
    {
      type: 'system',
      subtype: 'away_summary',
      message: {
        role: 'system',
        content:
          'While you were away: the timeline refactor landed and tests stayed green. (disable recaps in /config)',
      },
      timestamp: '2026-06-20T00:20:20.000Z',
    },
  ];
}

/** Idempotently seed the fixture transcript for the e2e repo root.
 *
 * Every record carries `cwd: repoRoot` (task #34) so the inferred
 * transcript↔session association (cwd match + time-window overlap) can
 * resolve this fixture against the seeded e2e session manifest. */
export function seedE2ETranscriptFixture(repoRoot: string, claudeHome: string): void {
  const projectDir = path.join(claudeHome, '.claude', 'projects', encodeProjectPath(repoRoot));
  fs.mkdirSync(projectDir, { recursive: true });

  const lines = fixtureRecords().map((record) => JSON.stringify({ ...record, cwd: repoRoot }));
  fs.writeFileSync(
    path.join(projectDir, `${FIXTURE_TRANSCRIPT_ID}.jsonl`),
    `${lines.join('\n')}\n`,
  );
}

/** Remove only the seeded fixture home; refuses to touch non-temp paths. */
export function removeE2ETranscriptFixture(claudeHome: string): void {
  const tmpRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(claudeHome);

  if (!resolved.startsWith(tmpRoot + path.sep)) {
    throw new Error(`Refusing to remove non-temp E2E Claude home: ${resolved}`);
  }

  fs.rmSync(resolved, { recursive: true, force: true });
}
