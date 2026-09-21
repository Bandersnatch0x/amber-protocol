import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encodeProjectPath } from '../server/lib/claude-transcript-reader';
import { cursorWorkspaceHash } from '../server/lib/suggestions/paths';
import { listSuggestions } from '../server/lib/suggestions/service';

const ERROR_A = 'ENOENT: no such file or directory, open /tmp/foo-123/bar';
const ERROR_B = 'permission denied for path /tmp/secret';

function claudeFailureJsonl(tool: string, error: string, cwd: string): string {
  return [
    JSON.stringify({
      type: 'assistant',
      cwd,
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tu_1', name: tool, input: { command: 'ls' } }],
      },
      timestamp: '2026-06-17T10:00:00Z',
    }),
    JSON.stringify({
      type: 'user',
      cwd,
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: error }],
      },
      timestamp: '2026-06-17T10:00:01Z',
    }),
  ].join('\n');
}

function codexFailureJsonl(
  repoRoot: string,
  sessionId: string,
  tool: string,
  error: string,
): string {
  return [
    JSON.stringify({
      type: 'session_meta',
      payload: { id: sessionId, cwd: repoRoot, source: 'cli' },
      timestamp: '2026-06-17T10:00:00Z',
    }),
    JSON.stringify({
      type: 'response_item',
      payload: { type: 'function_call', call_id: 'c1', name: tool },
      timestamp: '2026-06-17T10:00:01Z',
    }),
    JSON.stringify({
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'c1', success: false, output: error },
      timestamp: '2026-06-17T10:00:02Z',
    }),
  ].join('\n');
}

function cursorFailureJsonl(tool: string, error: string): string {
  return [
    JSON.stringify({
      role: 'assistant',
      message: { content: [{ type: 'tool_use', id: 't1', name: tool }] },
      timestamp: '2026-06-17T10:00:00Z',
    }),
    JSON.stringify({
      role: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: error }],
      },
      timestamp: '2026-06-17T10:00:01Z',
    }),
  ].join('\n');
}

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${contents}\n`);
}

describe('Improvement Suggestions clustering', () => {
  let root: string;
  let claudeHome: string;
  let codexHome: string;
  let cursorHome: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-'));
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-claude-'));
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-codex-'));
    cursorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-cursor-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'amber-protocol' }));
    fs.mkdirSync(path.join(root, 'routes'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(claudeHome, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
    fs.rmSync(cursorHome, { recursive: true, force: true });
  });

  function seedClaude(id: string, error: string, tool = 'Bash'): void {
    const dir = path.join(claudeHome, '.claude', 'projects', encodeProjectPath(root));
    writeFile(path.join(dir, `${id}.jsonl`), claudeFailureJsonl(tool, error, root));
  }

  function seedCodex(sessionId: string, error: string, tool = 'Bash'): void {
    const name = `rollout-2026-06-17T10-00-00-${sessionId}.jsonl`;
    writeFile(
      path.join(codexHome, 'sessions', name),
      codexFailureJsonl(root, sessionId, tool, error),
    );
  }

  function seedCursor(id: string, error: string, tool = 'Bash'): void {
    const dir = path.join(cursorHome, 'chats', cursorWorkspaceHash(root));
    writeFile(path.join(dir, `${id}.jsonl`), cursorFailureJsonl(tool, error));
  }

  function list() {
    return listSuggestions({
      repoRoot: root,
      homes: { claudeHome, codexHome, cursorHome },
    });
  }

  it('does not promote a one-off failure', () => {
    seedClaude('only-once', ERROR_A);
    expect(list().suggestions).toEqual([]);
  });

  it('promotes the same failure across Claude and Codex', () => {
    seedClaude('claude-1', ERROR_A);
    seedCodex('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ERROR_A);
    const cards = list().suggestions;
    expect(cards).toHaveLength(1);
    expect(cards[0].transcriptCount).toBe(2);
    expect(cards[0].hosts).toEqual(['claude', 'codex']);
    expect(cards[0].operations[0].path).toMatch(/^docs\/wiki\/agent\/friction\/[0-9a-f]{12}\.md$/);
    expect(cards[0].operations[0].verb).toBe('create');
    expect(cards[0].title).toContain('Bash');
  });

  it('merges Cursor into the same fingerprint', () => {
    seedClaude('claude-1', ERROR_A);
    seedCodex('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ERROR_A);
    seedCursor('cursor-1', ERROR_A);
    const cards = list().suggestions;
    expect(cards).toHaveLength(1);
    expect(cards[0].transcriptCount).toBe(3);
    expect(cards[0].hosts).toEqual(['claude', 'codex', 'cursor']);
  });

  it('does not cluster distinct error classes', () => {
    seedClaude('claude-1', ERROR_A);
    seedCodex('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ERROR_B);
    expect(list().suggestions).toEqual([]);
  });

  it('ignores Codex rollouts whose cwd is another repository', () => {
    seedClaude('claude-1', ERROR_A);
    const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-foreign-'));
    const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    writeFile(
      path.join(codexHome, 'sessions', `rollout-2026-06-17T10-00-00-${sessionId}.jsonl`),
      codexFailureJsonl(foreign, sessionId, 'Bash', ERROR_A),
    );
    expect(list().suggestions).toEqual([]);
    fs.rmSync(foreign, { recursive: true, force: true });
  });

  it('redacts secrets in evidence excerpts', () => {
    const secretError = 'Authorization: Bearer sk-ant-secret000111222333444 failed';
    seedClaude('claude-1', secretError);
    seedCursor('cursor-1', secretError);
    const excerpt = list().suggestions[0].evidence[0].excerpt;
    expect(excerpt).not.toContain('sk-ant-secret000111222333444');
    expect(excerpt).toContain('[REDACTED]');
  });
});
