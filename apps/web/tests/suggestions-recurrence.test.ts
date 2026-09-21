import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encodeProjectPath } from '../server/lib/claude-transcript-reader';
import { listSuggestions } from '../server/lib/suggestions/service';
import { clusterSignals } from '../server/lib/suggestions/cluster';
import { HOST_FILE_CEILING } from '../server/lib/suggestions/paths';
import type { FrictionSignal } from '../server/lib/suggestions/types';

const ERROR_A = 'ENOENT: no such file or directory, open /tmp/foo-123/bar';

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

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${contents}\n`);
}

describe('Improvement Suggestions recurrence reporting (evolution contract §9, E8)', () => {
  let root: string;
  let claudeHome: string;
  let codexHome: string;
  let cursorHome: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-recur-'));
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-recur-claude-'));
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-recur-codex-'));
    cursorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-recur-cursor-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'amber-protocol' }));
    fs.mkdirSync(path.join(root, 'routes'));
  });

  afterEach(() => {
    for (const dir of [root, claudeHome, codexHome, cursorHome]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
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

  function list() {
    return listSuggestions({
      repoRoot: root,
      homes: { claudeHome, codexHome, cursorHome },
    });
  }

  it('derives recurrenceRate = occurrences / transcripts scanned for the same window', () => {
    seedClaude('claude-1', ERROR_A);
    seedCodex('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ERROR_A);
    // Two clean transcripts share the window: the denominator is 4, not 2.
    seedClaude('claude-clean-1', 'some unrelated successful output, no failure');
    seedCodex('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeff', 'another clean session, all good');
    const card = list().suggestions[0];
    expect(card.recurrence).toBeDefined();
    expect(card.recurrence!.occurrences).toBe(2);
    expect(card.recurrence!.transcriptsScanned).toBe(4);
    expect(card.recurrence!.recurrenceRate).toBe(0.5);
    expect(card.recurrence!.denominator).toBe('measured');
    expect(card.recurrence!.window).toBe(
      `newest ${HOST_FILE_CEILING} transcript files per host home`,
    );
  });

  it('reports unknown — never a fabricated number — when no denominator is supplied', () => {
    const signal: FrictionSignal = {
      host: 'claude',
      transcriptId: 't1',
      tool: 'Bash',
      error: ERROR_A,
      excerpt: 'excerpt',
      fingerprint: 'fp',
      sourceFile: '',
    };
    const cards = clusterSignals([signal, { ...signal, transcriptId: 't2' }], root);
    expect(cards).toHaveLength(1);
    expect(cards[0].recurrence!.recurrenceRate).toBe(null);
    expect(cards[0].recurrence!.transcriptsScanned).toBe(null);
    expect(cards[0].recurrence!.denominator).toBe('unknown');
    expect(cards[0].recurrence!.occurrences).toBe(2);
  });

  it('is deterministic for the same window input', () => {
    seedClaude('claude-1', ERROR_A);
    seedCodex('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ERROR_A);
    const first = list().suggestions[0].recurrence;
    const second = list().suggestions[0].recurrence;
    expect(first).toEqual(second);
  });

  it('carries no before/after improvement claim: the shape is closed and report-only', () => {
    seedClaude('claude-1', ERROR_A);
    seedCodex('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ERROR_A);
    const card = list().suggestions[0];
    const keys = Object.keys(card.recurrence!).sort();
    expect(keys).toEqual([
      'denominator',
      'occurrences',
      'recurrenceRate',
      'transcriptsScanned',
      'window',
    ]);
    expect(JSON.stringify(card.recurrence)).not.toMatch(/delta|improve|reduction|before|after/i);
  });

  it('is additive: attribution, admission, and existing card fields are unchanged', () => {
    seedClaude('claude-1', ERROR_A);
    seedCodex('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ERROR_A);
    const card = list().suggestions[0];
    // B1 behavior intact.
    expect(card.findingAttribution).toBeDefined();
    expect(card.findingAttribution!.responsibleArtifact).toBe('wiki');
    // B3 behavior intact: the review trail recorded promotion + validation.
    expect(card.rejectionHistory).toBeDefined();
    expect(card.rejectionHistory!.status).toBe('none');
    // Pre-recurrence card fields keep their values.
    expect(card.id).toBe(card.fingerprint.slice(0, 16));
    expect(card.transcriptCount).toBe(2);
    expect(card.hosts).toEqual(['claude', 'codex']);
    expect(card.evidenceCount).toBe(2);
    expect(card.status).toBe('open');
    // Pre-recurrence card fields keep their values; the wiki note stays the
    // first planned operation (Slice 6 adds the instruction-surface ops).
    expect(card.operations).toHaveLength(3);
    expect(card.operations[0].artifactKind).toBe('wiki');
  });
});
