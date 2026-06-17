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
    expect(encodeProjectPath('D:\\code_space\\coding-harness')).toBe('D--code-space-coding-harness');
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
