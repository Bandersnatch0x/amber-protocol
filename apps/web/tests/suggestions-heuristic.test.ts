import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { listSuggestions } from '../server/lib/suggestions/service';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-heur-'));
}

function codexRollout(
  sessionId: string,
  tool: string,
  output: string,
  success?: boolean,
  cwd?: string,
): string {
  const records = [
    JSON.stringify({
      type: 'session_meta',
      payload: { id: sessionId, cwd: cwd ?? '/tmp/repo', source: 'cli' },
      timestamp: '2026-09-03T10:00:00Z',
    }),
    JSON.stringify({
      type: 'response_item',
      payload: { type: 'function_call', call_id: 'c1', name: tool },
      timestamp: '2026-09-03T10:00:01Z',
    }),
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'c1',
        success,
        output,
      },
      timestamp: '2026-09-03T10:00:02Z',
    }),
  ];
  return records.join('\n');
}

describe('outputLooksFailed heuristic', () => {
  let root: string;
  let codexHome: string;

  beforeEach(() => {
    root = tmp();
    codexHome = tmp();
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'test' }));
    fs.mkdirSync(path.join(root, 'routes'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  });

  function seedCodex(sessionId: string, tool: string, output: string, success?: boolean): void {
    const name = `rollout-2026-09-03T10-00-00-${sessionId}.jsonl`;
    const dir = path.join(codexHome, 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), codexRollout(sessionId, tool, output, success, root));
  }

  function list() {
    return listSuggestions({ repoRoot: root, homes: { codexHome } });
  }

  it('does not treat successful grep output as a failure', () => {
    seedCodex(
      'aaaaaaaa-1111-2222-3333-000000000001',
      'Bash',
      'src/server.ts:42:  throw new Error("connection failed")',
    );
    seedCodex(
      'aaaaaaaa-1111-2222-3333-000000000002',
      'Bash',
      'tests/unit.test.ts:19:  // error case covered',
    );
    expect(list().suggestions).toEqual([]);
  });

  it('does not treat test pass summaries as failures', () => {
    seedCodex(
      'aaaaaaaa-1111-2222-3333-000000000003',
      'Bash',
      'PASS tests/unit.test.ts\n✓ all tests passed (0 errors)',
    );
    seedCodex(
      'aaaaaaaa-1111-2222-3333-000000000004',
      'Bash',
      'Tests: 42 passed, 0 failed, 0 errors',
    );
    expect(list().suggestions).toEqual([]);
  });

  it('recognizes line-anchored error markers', () => {
    seedCodex('aaaaaaaa-1111-2222-3333-000000000005', 'Bash', 'Error: ENOENT: no such file');
    seedCodex('aaaaaaaa-1111-2222-3333-000000000006', 'Bash', 'Error: ENOENT: no such file');
    const cards = list().suggestions;
    expect(cards).toHaveLength(1);
    expect(cards[0].tool).toBe('Bash');
  });

  it('recognizes explicit success=false even when output looks benign', () => {
    seedCodex('aaaaaaaa-1111-2222-3333-000000000007', 'Bash', 'all good', false);
    seedCodex('aaaaaaaa-1111-2222-3333-000000000008', 'Bash', 'all good', false);
    const cards = list().suggestions;
    expect(cards).toHaveLength(1);
  });

  it('does not promote when success=true overrides error-like text', () => {
    seedCodex('aaaaaaaa-1111-2222-3333-000000000009', 'Bash', 'error logs cleaned', true);
    seedCodex('aaaaaaaa-1111-2222-3333-00000000000a', 'Bash', 'error logs cleaned', true);
    expect(list().suggestions).toEqual([]);
  });

  it('recognizes exit code markers', () => {
    seedCodex(
      'aaaaaaaa-1111-2222-3333-00000000000b',
      'Bash',
      'Command failed\nProcess exited with code 1',
    );
    seedCodex(
      'aaaaaaaa-1111-2222-3333-00000000000c',
      'Bash',
      'Command failed\nProcess exited with code 1',
    );
    const cards = list().suggestions;
    expect(cards).toHaveLength(1);
  });

  it('does not flag exit 0', () => {
    seedCodex('aaaaaaaa-1111-2222-3333-00000000000d', 'Bash', 'Command exited with code 0');
    seedCodex('aaaaaaaa-1111-2222-3333-00000000000e', 'Bash', 'exited with code 0');
    expect(list().suggestions).toEqual([]);
  });
});
