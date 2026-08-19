import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  encodeProjectPath,
  parseTranscript,
  listRepoTranscripts,
  readRepoTranscript,
} from '../server/lib/claude-transcript-reader';

// A realistic slice of a Claude Code transcript (.jsonl), one JSON object per line.
const FIXTURE_JSONL = [
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: 'print DATABASE_PASSWORD=secret-val-123 from the env' },
    timestamp: '2026-06-17T10:00:00Z',
    gitBranch: 'feat/lens',
  }),
  JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Reading the file now.' },
        { type: 'tool_use', name: 'Read', input: { file_path: 'config.env' } },
      ],
    },
    timestamp: '2026-06-17T10:00:01Z',
  }),
  JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
    timestamp: '2026-06-17T10:00:02Z',
  }),
].join('\n');

describe('encodeProjectPath', () => {
  it('encodes a Windows repo path the way Claude Code names its projects dir', () => {
    // Verified against this repo's own ~/.claude project dir name.
    expect(encodeProjectPath('D:\\code_space\\coding-harness')).toBe(
      'D--code-space-coding-harness',
    );
  });

  it('encodes a POSIX repo path by replacing every non-alphanumeric char with a dash', () => {
    expect(encodeProjectPath('/home/user/my_project')).toBe('-home-user-my-project');
  });
});

describe('parseTranscript', () => {
  it('parses one normalized turn per JSONL line', () => {
    const turns = parseTranscript(FIXTURE_JSONL, { redact: false });
    expect(turns).toHaveLength(3);
    expect(turns[0].type).toBe('user');
    expect(turns[0].text).toContain('print DATABASE_PASSWORD');
  });

  it('captures tool names from assistant tool_use blocks', () => {
    const turns = parseTranscript(FIXTURE_JSONL, { redact: false });
    expect(turns[1].type).toBe('assistant');
    expect(turns[1].text).toContain('Reading the file now.');
    expect(turns[1].tools).toContain('Read');
  });

  it('redacts secrets in turn text when redact is enabled', () => {
    const turns = parseTranscript(FIXTURE_JSONL, { redact: true });
    expect(turns[0].text).not.toContain('secret-val-123');
    expect(turns[0].text).toContain('[REDACTED');
  });

  it('respects the limit option', () => {
    const turns = parseTranscript(FIXTURE_JSONL, { redact: false, limit: 2 });
    expect(turns).toHaveLength(2);
  });

  it('skips malformed JSON lines instead of throwing', () => {
    const content = FIXTURE_JSONL + '\nthis is not json\n';
    const turns = parseTranscript(content, { redact: false });
    expect(turns).toHaveLength(3);
  });

  it('passes subtype/isMeta through from the raw JSONL record (additive)', () => {
    const content = [
      JSON.stringify({
        type: 'system',
        subtype: 'away_summary',
        message: { role: 'system', content: 'While you were away: the refactor landed.' },
        timestamp: '2026-06-17T10:05:00Z',
      }),
      JSON.stringify({
        type: 'user',
        isMeta: true,
        message: { role: 'user', content: 'meta turn' },
        timestamp: '2026-06-17T10:05:01Z',
      }),
    ].join('\n');
    const turns = parseTranscript(content, { redact: false });
    expect(turns).toHaveLength(2);
    expect(turns[0].subtype).toBe('away_summary');
    expect(turns[0].isMeta).toBeUndefined();
    expect(turns[1].isMeta).toBe(true);
    expect(turns[1].subtype).toBeUndefined();
  });

  it('omits subtype/isMeta for records that carry no discriminators', () => {
    const turns = parseTranscript(FIXTURE_JSONL, { redact: false });
    for (const turn of turns) {
      expect(turn.subtype).toBeUndefined();
      expect(turn.isMeta).toBeUndefined();
    }
    // Undefined fields vanish under JSON serialization -> wire shape unchanged.
    expect(JSON.parse(JSON.stringify(turns[0]))).not.toHaveProperty('subtype');
  });
});

describe('repo transcript filesystem layer', () => {
  let claudeHome: string;
  const repoPath = 'D:\\work\\demo-repo';
  const encoded = 'D--work-demo-repo';

  beforeEach(() => {
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-lens-'));
    const projectDir = path.join(claudeHome, '.claude', 'projects', encoded);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, 'sess-1.jsonl'), FIXTURE_JSONL);
  });

  afterEach(() => {
    fs.rmSync(claudeHome, { recursive: true, force: true });
  });

  it('returns an empty list when the repo has no transcripts dir', () => {
    const summaries = listRepoTranscripts('/no/such/repo', { claudeHome });
    expect(summaries).toEqual([]);
  });

  it('lists transcript summaries for the current repo', () => {
    const summaries = listRepoTranscripts(repoPath, { claudeHome });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe('sess-1');
    expect(summaries[0].turnCount).toBe(3);
    expect(summaries[0].repoPath).toBe(repoPath);
    expect(summaries[0].sourceDirectory).toBe(
      path.join(claudeHome, '.claude', 'projects', encoded),
    );
    expect(summaries[0].sourceFile).toBe(
      path.join(claudeHome, '.claude', 'projects', encoded, 'sess-1.jsonl'),
    );
    expect(summaries[0].outline).toContain('print DATABASE_PASSWORD');
    expect(summaries[0].outline).not.toContain('secret-val-123');
    expect(summaries[0].outline).toContain('[REDACTED');
  });

  it('reads a transcript and redacts secrets by default', () => {
    const detail = readRepoTranscript(repoPath, 'sess-1', { claudeHome });
    expect(detail).not.toBeNull();
    expect(detail!.turns).toHaveLength(3);
    expect(detail!.turns[0].text).not.toContain('secret-val-123');
  });

  it('returns null for an unknown transcript id', () => {
    const detail = readRepoTranscript(repoPath, 'does-not-exist', { claudeHome });
    expect(detail).toBeNull();
  });
});

describe('outline title denoise', () => {
  let claudeHome: string;
  const repoPath = 'D:\\work\\demo-repo';
  const encoded = 'D--work-demo-repo';

  function outlineOf(records: Array<Record<string, unknown>>): string {
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-lens-outline-'));
    const projectDir = path.join(claudeHome, '.claude', 'projects', encoded);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'sess-1.jsonl'),
      records.map((record) => JSON.stringify(record)).join('\n'),
    );
    const summaries = listRepoTranscripts(repoPath, { claudeHome });
    fs.rmSync(claudeHome, { recursive: true, force: true });
    expect(summaries).toHaveLength(1);
    return summaries[0].outline;
  }

  function userTurn(content: string) {
    return { type: 'user', message: { role: 'user', content }, timestamp: '2026-08-01T10:00:00Z' };
  }

  it('skips a caveat-wrapped first turn and uses the first readable message', () => {
    const outline = outlineOf([
      userTurn(
        '<local-command-caveat>\nCaveat: command output is local only.\n</local-command-caveat>',
      ),
      userTurn('<system-reminder>\nPlan mode is enabled.\n</system-reminder>'),
      userTurn('Please fix the login redirect bug'),
    ]);
    expect(outline).toBe('Please fix the login redirect bug');
  });

  it('uses command args/message as the title for slash-command envelopes', () => {
    const outline = outlineOf([
      userTurn(
        '<command-name>/front-design</command-name>\n<command-args>redesign the home page</command-args>\n<command-message>front-design</command-message>',
      ),
    ]);
    expect(outline).toBe('redesign the home page');
  });

  it('falls back to command-message when command-args is empty', () => {
    const outline = outlineOf([
      userTurn(
        '<command-name>/compact</command-name>\n<command-args></command-args>\n<command-message>compact</command-message>',
      ),
    ]);
    expect(outline).toBe('compact');
  });

  it('strips local-command-stdout tags and keeps the first output line', () => {
    const outline = outlineOf([
      userTurn(
        '<local-command-stdout>\u001b[1m\nAll checks passed\nsecond line\n</local-command-stdout>',
      ),
    ]);
    expect(outline).toBe('All checks passed');
  });

  it('degrades to the legacy truncation when every user turn is noise', () => {
    const noisy = '<local-command-caveat>\nlocal only\n</local-command-caveat>';
    const outline = outlineOf([userTurn(noisy)]);
    expect(outline).toContain('<local-command-caveat>');
  });

  it('still truncates readable titles to the existing outline length semantics', () => {
    const long = 'word '.repeat(120).trim();
    const outline = outlineOf([
      userTurn('<local-command-caveat>noise</local-command-caveat>'),
      userTurn(long),
    ]);
    expect(outline.length).toBeLessThanOrEqual(222);
    expect(outline.endsWith('...')).toBe(true);
  });
});
