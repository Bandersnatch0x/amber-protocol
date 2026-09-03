import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encodeProjectPath } from '../server/lib/claude-transcript-reader';
import {
  applySuggestionById,
  dismissSuggestion,
  listSuggestions,
  snoozeSuggestion,
  undoSuggestionById,
} from '../server/lib/suggestions/service';
import { applySuggestion } from '../server/lib/suggestions/apply';
import type { ImprovementSuggestion } from '../server/lib/suggestions/types';

const ERROR_A = 'ENOENT: no such file or directory, open /tmp/foo-123/bar';

function claudePair(repoRoot: string, claudeHome: string): void {
  const dir = path.join(claudeHome, '.claude', 'projects', encodeProjectPath(repoRoot));
  fs.mkdirSync(dir, { recursive: true });
  for (const id of ['a', 'b']) {
    fs.writeFileSync(
      path.join(dir, `${id}.jsonl`),
      [
        JSON.stringify({
          type: 'assistant',
          cwd: repoRoot,
          message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: 'tu_1', name: 'Bash', input: {} }],
          },
          timestamp: '2026-06-17T10:00:00Z',
        }),
        JSON.stringify({
          type: 'user',
          cwd: repoRoot,
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: ERROR_A },
            ],
          },
          timestamp: '2026-06-17T10:00:01Z',
        }),
      ].join('\n'),
    );
  }
}

describe('Improvement Suggestions apply overlay', () => {
  let root: string;
  let claudeHome: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-apply-'));
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-apply-claude-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'amber-protocol' }));
    fs.mkdirSync(path.join(root, 'routes'));
    claudePair(root, claudeHome);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(claudeHome, { recursive: true, force: true });
  });

  function opts() {
    return { repoRoot: root, homes: { claudeHome, codexHome: root, cursorHome: root } };
  }

  function openCard() {
    const card = listSuggestions(opts()).suggestions[0];
    expect(card).toBeTruthy();
    return card;
  }

  it('applies a wiki create and can undo it', () => {
    const card = openCard();
    const applied = applySuggestionById(card.id, opts());
    expect(applied.ok).toBe(true);
    const rel = card.operations[0].path;
    const abs = path.join(root, rel);
    expect(fs.existsSync(abs)).toBe(true);
    const body = fs.readFileSync(abs, 'utf8');
    expect(body).toContain('Improvement Suggestion');
    expect(body).toContain('Bash');

    const undone = undoSuggestionById(card.id, opts());
    expect(undone.ok).toBe(true);
    expect(fs.existsSync(abs)).toBe(false);
  });

  it('refuses apply when a create target already exists', () => {
    const card = openCard();
    const abs = path.join(root, card.operations[0].path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'already here\n');
    const result = applySuggestionById(card.id, opts());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('stale');
    expect(fs.readFileSync(abs, 'utf8')).toBe('already here\n');
  });

  it('refuses a non-allowlisted operation', () => {
    const card = openCard();
    const forged: ImprovementSuggestion = {
      ...card,
      operations: [
        {
          verb: 'create',
          artifactKind: 'wiki',
          path: 'scripts/lib/core/doctor.js',
          summary: 'should never land',
          contents: 'nope\n',
          expectedHash: null,
        },
      ],
    };
    const result = applySuggestion(root, forged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('stale');
    expect(fs.existsSync(path.join(root, 'scripts/lib/core/doctor.js'))).toBe(false);
  });

  it('hides a dismissed card from the open filter', () => {
    const card = openCard();
    const dismissed = dismissSuggestion(card.id, opts());
    expect(dismissed.ok).toBe(true);
    const listed = listSuggestions(opts()).suggestions;
    expect(listed[0].status).toBe('dismissed');
  });

  it('returns a snoozed card to open after the window', () => {
    const card = openCard();
    const now = new Date('2026-06-17T00:00:00.000Z');
    const snoozed = snoozeSuggestion(card.id, { ...opts(), now });
    expect(snoozed.ok).toBe(true);
    const still = listSuggestions({ ...opts(), now }).suggestions[0];
    expect(still.status).toBe('snoozed');
    const later = listSuggestions({
      ...opts(),
      now: new Date('2026-06-25T00:00:00.000Z'),
    }).suggestions[0];
    expect(later.status).toBe('open');
  });
});
