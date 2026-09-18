import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encodeProjectPath } from '../server/lib/claude-transcript-reader';
import {
  applySuggestionById,
  listSuggestions,
  undoSuggestionById,
} from '../server/lib/suggestions/service';
import {
  planAgentsMdOperation,
  planFrictionCardOperations,
  planFrictionNote,
  planSkillOperation,
} from '../server/lib/suggestions/planner';
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

// Plan Slice 6 / evolution contract §4 row 3 + E11: the F064 planner emits
// instruction-surface operations (agents-md, skill) under the existing
// allowlist, with the behavior-affecting presentation duties; wiki stays the
// first operation and the default suggestion surface; MEMORY.md stays refused
// and no planned path leaves the allowlist.

describe('Instruction-surface planner extension (Slice 6)', () => {
  let root: string;
  let claudeHome: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-instr-'));
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-instr-claude-'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'amber-protocol' }));
    fs.mkdirSync(path.join(root, 'routes'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(claudeHome, { recursive: true, force: true });
  });

  function seedClaudePair(): void {
    const dir = path.join(claudeHome, '.claude', 'projects', encodeProjectPath(root));
    fs.mkdirSync(dir, { recursive: true });
    for (const id of ['a', 'b']) {
      fs.writeFileSync(path.join(dir, `${id}.jsonl`), claudeFailureJsonl('Bash', ERROR_A, root));
    }
  }

  function list() {
    return listSuggestions({ repoRoot: root, homes: { claudeHome } }).suggestions;
  }

  const group: FrictionSignal[] = [
    { host: 'claude', transcriptId: 't1', tool: 'Bash', error: 'boom', excerpt: 'boom', fingerprint: 'abc123def456' },
  ];

  it('wiki stays the first operation and the default suggestion surface', () => {
    seedClaudePair();
    const card = list()[0];
    expect(card.operations[0].artifactKind).toBe('wiki');
    expect(card.operations[0].verb).toBe('create');
    expect(card.operations[0].path).toMatch(/^docs\/wiki\/agent\/friction\/[0-9a-f]{12}\.md$/);
    // The wiki summary is not framed as an instruction edit.
    expect(card.operations[0].summary).not.toContain('Behavior-affecting');
    expect(card.operations.map((op) => op.artifactKind)).toEqual(['wiki', 'agents-md', 'skill']);
  });

  it('emits the AGENTS.md instruction operation with behavior-affecting presentation and the F058 boundary', () => {
    const op = planAgentsMdOperation({
      repoRoot: root,
      fingerprint: 'abc123def456',
      tool: 'Bash',
      wikiRelPath: 'docs/wiki/agent/friction/abc123def456.md',
    });
    expect(op.artifactKind).toBe('agents-md');
    expect(op.path).toBe('AGENTS.md');
    // Presentation duty: behavior-affecting, never low-risk-by-filename, F058 named.
    expect(op.summary).toContain('Behavior-affecting instruction edit');
    expect(op.summary).toContain('F058');
    // The bullet references the wiki note, not raw error material.
    expect(op.contents).toContain('docs/wiki/agent/friction/abc123def456.md');
    // Missing AGENTS.md → create with empty expectedHash (Apply create rules).
    expect(op.verb).toBe('create');
    expect(op.expectedHash).toBeNull();
  });

  it('plans an update with a pinned expectedHash when AGENTS.md exists', () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'existing rules\n');
    const op = planAgentsMdOperation({
      repoRoot: root,
      fingerprint: 'abc123def456',
      tool: 'Bash',
      wikiRelPath: 'docs/wiki/agent/friction/abc123def456.md',
    });
    expect(op.verb).toBe('update');
    expect(op.expectedHash).not.toBeNull();
    expect((op.contents ?? '').startsWith('existing rules\n')).toBe(true);
    expect(op.contents).toContain('read `docs/wiki/agent/friction/abc123def456.md`');
  });

  it('emits the skill instruction operation under the skills allowlist with the same duties', () => {
    const op = planSkillOperation({
      fingerprint: 'abc123def456',
      tool: 'Bash',
      wikiRelPath: 'docs/wiki/agent/friction/abc123def456.md',
    });
    expect(op.artifactKind).toBe('skill');
    expect(op.verb).toBe('create');
    expect(op.expectedHash).toBeNull();
    expect(op.path).toMatch(/^skills\/agent-friction-[0-9a-f]{12}\/SKILL\.md$/);
    expect(op.summary).toContain('Behavior-affecting instruction edit');
    expect(op.summary).toContain('F058');
    expect(op.contents).toContain('name: agent-friction-abc123def456');
  });

  it('derivation is deterministic: same inputs → identical operations', () => {
    const a = planAgentsMdOperation({ repoRoot: root, fingerprint: 'abc123def456', tool: 'Bash', wikiRelPath: 'w.md' });
    const b = planAgentsMdOperation({ repoRoot: root, fingerprint: 'abc123def456', tool: 'Bash', wikiRelPath: 'w.md' });
    expect(a).toEqual(b);
    const s1 = planSkillOperation({ fingerprint: 'abc123def456', tool: 'Bash', wikiRelPath: 'w.md' });
    const s2 = planSkillOperation({ fingerprint: 'abc123def456', tool: 'Bash', wikiRelPath: 'w.md' });
    expect(s1).toEqual(s2);
    // The composed plan keeps the wiki note identical to the standalone planner.
    const wiki = planFrictionNote({ fingerprint: 'abc123def456', tool: 'Bash', group, transcriptCount: 2, hosts: ['claude'], now: new Date('2026-09-18') });
    const card = planFrictionCardOperations({ repoRoot: root, fingerprint: 'abc123def456', tool: 'Bash', group, transcriptCount: 2, hosts: ['claude'], now: new Date('2026-09-18') });
    expect(card[0]).toEqual(wiki[0]);
    expect(card).toHaveLength(3);
  });

  // End-to-end Apply/Undo are I/O-bound and sit near the 5s default timeout
  // under full-suite parallel load (1.8s isolated); the explicit budget keeps
  // the assertions intact without weakening them.
  it('Apply accepts the instruction-surface operations under the allowlist; Undo restores them', { timeout: 20000 }, () => {
    seedClaudePair();
    const card = list()[0];
    // The real card carries the instruction-surface operations through the
    // same admission path (V1–V3 ran during list(); it was exposed).
    expect(card.operations).toHaveLength(3);
    expect(fs.existsSync(path.join(root, 'AGENTS.md'))).toBe(false);

    const applied = applySuggestionById(card.id, { repoRoot: root, homes: { claudeHome } });
    expect(applied.ok).toBe(true);

    // All three artifacts landed; the instruction file carries the bullet.
    expect(fs.existsSync(path.join(root, card.operations[0].path))).toBe(true);
    const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    expect(agents).toContain('docs/wiki/agent/friction/');
    expect(fs.existsSync(path.join(root, card.operations[2].path))).toBe(true);

    // Undo restores everything: created files removed, AGENTS.md back to absent.
    const undone = undoSuggestionById(card.id, { repoRoot: root, homes: { claudeHome } });
    expect(undone.ok).toBe(true);
    expect(fs.existsSync(path.join(root, card.operations[0].path))).toBe(false);
    expect(fs.existsSync(path.join(root, card.operations[2].path))).toBe(false);
    expect(fs.existsSync(path.join(root, 'AGENTS.md'))).toBe(false);
  });

  it('Undo restores the pre-Apply AGENTS.md bytes when the file existed', { timeout: 20000 }, () => {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'existing rules\n');
    seedClaudePair();
    const card = list()[0];
    expect(applySuggestionById(card.id, { repoRoot: root, homes: { claudeHome } }).ok).toBe(true);
    const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    expect(agents.startsWith('existing rules\n')).toBe(true);
    expect(agents).toContain('docs/wiki/agent/friction/');
    expect(undoSuggestionById(card.id, { repoRoot: root, homes: { claudeHome } }).ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe('existing rules\n');
  });

  it('the planner never plans MEMORY.md and every planned path is allowlisted', () => {
    seedClaudePair();
    const card = list()[0];
    for (const op of card.operations) {
      expect(op.path).not.toBe('MEMORY.md');
      const allowlisted =
        op.path === 'AGENTS.md' ||
        op.path === 'CLAUDE.md' ||
        (op.path.startsWith('docs/wiki/') && op.path.endsWith('.md')) ||
        /^skills\/[^/]+\/SKILL\.md$/.test(op.path);
      expect(allowlisted).toBe(true);
    }
  });
});
