import fs from 'fs';
import os from 'os';
import path from 'path';
import { encodeProjectPath } from '../../../server/lib/claude-transcript-reader';
import { cursorWorkspaceHash } from '../../../server/lib/suggestions/paths';

export const FRICTION_ERROR = 'ENOENT: no such file or directory, open /tmp/foo-123/bar';

function getTempNamed(prefix: string, override: string | undefined): string {
  if (override) return path.resolve(override);
  const repoKey = path.resolve(process.cwd(), '..', '..').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `${prefix}-${repoKey}`);
}

export function getE2ECodexHome(): string {
  return getTempNamed('amber-web-e2e-codex-home', process.env.AMBER_E2E_CODEX_HOME);
}

export function getE2ECursorHome(): string {
  return getTempNamed('amber-web-e2e-cursor-home', process.env.AMBER_E2E_CURSOR_HOME);
}

function write(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${contents}\n`);
}

export function seedE2ESuggestionFixtures(
  repoRoot: string,
  homes: {
    claudeHome: string;
    codexHome: string;
    cursorHome: string;
  },
): void {
  const claudeDir = path.join(homes.claudeHome, '.claude', 'projects', encodeProjectPath(repoRoot));
  write(
    path.join(claudeDir, 'friction-claude.jsonl'),
    [
      JSON.stringify({
        type: 'assistant',
        cwd: repoRoot,
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'ls' } }],
        },
        timestamp: '2026-06-21T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'user',
        cwd: repoRoot,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: FRICTION_ERROR },
          ],
        },
        timestamp: '2026-06-21T00:00:01.000Z',
      }),
    ].join('\n'),
  );

  const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  write(
    path.join(homes.codexHome, 'sessions', `rollout-2026-06-21T00-00-00-${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: sessionId, cwd: repoRoot, source: 'cli' },
        timestamp: '2026-06-21T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call', call_id: 'c1', name: 'Bash' },
        timestamp: '2026-06-21T00:00:01.000Z',
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          call_id: 'c1',
          success: false,
          output: FRICTION_ERROR,
        },
        timestamp: '2026-06-21T00:00:02.000Z',
      }),
    ].join('\n'),
  );

  write(
    path.join(homes.cursorHome, 'chats', cursorWorkspaceHash(repoRoot), 'friction-cursor.jsonl'),
    [
      JSON.stringify({
        role: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash' }] },
        timestamp: '2026-06-21T00:00:00.000Z',
      }),
      JSON.stringify({
        role: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't1', is_error: true, content: FRICTION_ERROR },
          ],
        },
        timestamp: '2026-06-21T00:00:01.000Z',
      }),
    ].join('\n'),
  );
}
