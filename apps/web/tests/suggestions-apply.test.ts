import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { applySuggestion, undoSuggestion } from '../server/lib/suggestions/apply';
import { fileHash } from '../server/lib/suggestions/paths';
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

  it('refuses an update whose target changed under the card (content-hash staleness)', () => {
    const card = openCard();
    const rel = 'docs/wiki/agent/friction/existing.md';
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'draft-time bytes\n');

    // The card was planned against the draft-time hash; the file has since
    // changed, so Apply must refuse rather than clobber the newer bytes.
    const forged: ImprovementSuggestion = {
      ...card,
      operations: [
        {
          verb: 'update',
          artifactKind: 'wiki',
          path: rel,
          summary: 'should never land',
          contents: 'planned bytes\n',
          expectedHash: 'b'.repeat(64),
        },
      ],
    };
    const result = applySuggestion(root, forged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('stale');
    expect(fs.readFileSync(abs, 'utf8')).toBe('draft-time bytes\n');
  });

  it('refuses a second Apply of an already-applied card', () => {
    const card = openCard();
    expect(applySuggestionById(card.id, opts()).ok).toBe(true);
    const again = applySuggestionById(card.id, opts());
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('already-applied');
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

  // A second create on an allowlisted path; its target is sabotaged below so
  // the commit loop's second write throws a real fs error mid-commit.
  function twoOpCard(card: ImprovementSuggestion): ImprovementSuggestion {
    const secondRel = card.operations[0].path.replace(/\.md$/, '-second.md');
    return {
      ...card,
      operations: [
        card.operations[0],
        { ...card.operations[0], path: secondRel, summary: 'second write' },
      ],
    };
  }

  it('fails closed when an Apply commit write throws mid-commit (compensated rollback)', () => {
    const card = openCard();
    const forged = twoOpCard(card);
    const firstRel = card.operations[0].path;
    const abs1 = path.join(root, firstRel);

    // Real I/O failure, no mock: the second create target is a directory, so
    // its writeFileSync throws EISDIR after the first create already landed.
    fs.mkdirSync(path.join(root, forged.operations[1].path), { recursive: true });

    const result = applySuggestion(root, forged);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('commit-io-failed');
      expect(result.message).toContain('pre-Apply state');
    }
    // No partial state: the earlier successful create is rolled back, the
    // sabotaged target never got Apply bytes, and the card is still open.
    expect(fs.existsSync(abs1)).toBe(false);
    expect(fs.statSync(path.join(root, forged.operations[1].path)).isDirectory()).toBe(true);
    expect(listSuggestions(opts()).suggestions[0].status).toBe('open');
  });

  it('fails closed when an Undo restore throws mid-commit (restored to post-Apply state)', () => {
    const card = openCard();
    const forged = twoOpCard(card);
    expect(applySuggestion(root, forged).ok).toBe(true);
    const abs1 = path.join(root, card.operations[0].path);
    const abs2 = path.join(root, forged.operations[1].path);
    const applied1 = fs.readFileSync(abs1, 'utf8');
    const applied2 = fs.readFileSync(abs2, 'utf8');

    // Undo restores created files by unlinking, in order: let the first
    // restore succeed and the second throw. A plain read-only trick cannot
    // fail the second unlink without also failing Undo's compensation, so
    // the spy throws exactly once, on the second target unlink.
    const realUnlink = fs.unlinkSync.bind(fs);
    const targets = new Set([abs1, abs2]);
    let targetUnlinks = 0;
    vi.spyOn(fs, 'unlinkSync').mockImplementation(((p: fs.PathLike) => {
      if (targets.has(p)) {
        targetUnlinks += 1;
        if (targetUnlinks === 2) throw new Error('simulated mid-commit unlink failure');
      }
      return realUnlink(p);
    }) as typeof fs.unlinkSync);

    const undone = undoSuggestion(root, forged);
    vi.restoreAllMocks();
    expect(undone.ok).toBe(false);
    if (!undone.ok) {
      expect(undone.code).toBe('commit-io-failed');
      expect(undone.message).toContain('pre-Undo state');
    }
    // Exact post-Apply state: both files byte-identical, overlay untouched.
    expect(fs.readFileSync(abs1, 'utf8')).toBe(applied1);
    expect(fs.readFileSync(abs2, 'utf8')).toBe(applied2);
    expect(listSuggestions(opts()).suggestions[0].status).toBe('applied');
  });

  it('returns an explicit degraded result when Apply mid-commit compensation itself fails', () => {
    const card = openCard();
    const forged = twoOpCard(card);
    const firstRel = card.operations[0].path;
    const abs1 = path.join(root, firstRel);

    // The second write throws, and the rollback unlink fails too: the
    // compensation cannot restore, so the result must name the affected
    // paths and the reconciliation step instead of reporting success.
    const realWrite = fs.writeFileSync.bind(fs);
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((
      p: fs.PathOrFileDescriptor,
      data: unknown,
    ) => {
      if (String(p).endsWith('-second.md')) throw new Error('simulated mid-commit EIO');
      return realWrite(p, data as string | Uint8Array);
    }) as typeof fs.writeFileSync);
    vi.spyOn(fs, 'unlinkSync').mockImplementation((() => {
      throw new Error('simulated rollback failure');
    }) as typeof fs.unlinkSync);

    const result = applySuggestion(root, forged);
    vi.restoreAllMocks();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('commit-io-degraded');
      expect(result.message).toContain('DEGRADED STATE');
      expect(result.message).toContain(firstRel);
    }
    // The partial state is by definition still there; it must be named
    // loudly, never silent and never reported as success.
    expect(fs.existsSync(abs1)).toBe(true);
  });

  // A double update on one allowlisted file: both operations pin the same
  // draft-time hash, so the precheck plans both, but the second commit-time
  // check sees the file after the first update and refuses stale — reaching
  // the commit loop's stale-refusal rollback with a non-empty applied set.
  function staleSecondOpCard(card: ImprovementSuggestion): ImprovementSuggestion {
    const rel = 'docs/wiki/agent/friction/existing.md';
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'draft-time bytes\n');
    const draftHash = fileHash(abs) as string;
    return {
      ...card,
      operations: [
        {
          verb: 'update',
          artifactKind: 'wiki',
          path: rel,
          summary: 'first update lands',
          contents: 'first-update bytes\n',
          expectedHash: draftHash,
        },
        {
          verb: 'update',
          artifactKind: 'wiki',
          path: rel,
          summary: 'second update must refuse stale',
          contents: 'second-update bytes\n',
          expectedHash: draftHash,
        },
      ],
    };
  }

  it('routes a stale-refusal rollback failure through the compensation contract (compensated)', () => {
    const card = openCard();
    const forged = staleSecondOpCard(card);
    const rel = forged.operations[0].path;
    const abs = path.join(root, rel);
    const draftBytes = fs.readFileSync(abs, 'utf8');

    // The commit loop's stale branch calls rollback after op 1 landed. Let
    // op 1's write succeed (call 1), fail the rollback restore (call 2), and
    // let the compensation's restore succeed (call 3): the double failure
    // must return the explicit commit-io-failed result — never a throw.
    const realWrite = fs.writeFileSync.bind(fs);
    let writes = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((
      p: fs.PathOrFileDescriptor,
      data: unknown,
    ) => {
      if (String(p) === abs) {
        writes += 1;
        if (writes === 2) throw new Error('simulated stale-branch rollback failure');
      }
      return realWrite(p, data as string | Uint8Array);
    }) as typeof fs.writeFileSync);

    const result = applySuggestion(root, forged);
    vi.restoreAllMocks();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('commit-io-failed');
      expect(result.message).toContain('pre-Apply state');
    }
    // Compensation restored the exact draft-time bytes and the card stayed
    // open — no partial state from the double failure.
    expect(fs.readFileSync(abs, 'utf8')).toBe(draftBytes);
    expect(listSuggestions(opts()).suggestions[0].status).toBe('open');
  });

  it('routes a stale-refusal rollback failure through the compensation contract (degraded)', () => {
    const card = openCard();
    const forged = staleSecondOpCard(card);
    const rel = forged.operations[0].path;
    const abs = path.join(root, rel);

    // The restore write fails for the rollback AND the compensation, so the
    // degraded result must name the affected path and the reconciliation step.
    const realWrite = fs.writeFileSync.bind(fs);
    let writes = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((
      p: fs.PathOrFileDescriptor,
      data: unknown,
    ) => {
      if (String(p) === abs) {
        writes += 1;
        if (writes >= 2) throw new Error('simulated stale-branch rollback failure');
      }
      return realWrite(p, data as string | Uint8Array);
    }) as typeof fs.writeFileSync);

    const result = applySuggestion(root, forged);
    vi.restoreAllMocks();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('commit-io-degraded');
      expect(result.message).toContain('DEGRADED STATE');
      expect(result.message).toContain(rel);
    }
    // The first update's bytes remain (compensation could not restore); the
    // mismatch is the named degraded state, never success and never silent.
    expect(fs.readFileSync(abs, 'utf8')).toBe('first-update bytes\n');
  });
});
