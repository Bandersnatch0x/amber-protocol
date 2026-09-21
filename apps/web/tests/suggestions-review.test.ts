import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encodeProjectPath } from '../server/lib/claude-transcript-reader';
import { frictionFingerprint } from '../server/lib/suggestions/fingerprint';
import { admitSuggestionCard } from '../server/lib/suggestions/admission';
import { applySuggestion } from '../server/lib/suggestions/apply';
import {
  applySuggestionById,
  dismissSuggestion,
  listSuggestions,
  snoozeSuggestion,
  undoSuggestionById,
} from '../server/lib/suggestions/service';
import type {
  FrictionSignal,
  ImprovementSuggestion,
  SuggestionHomes,
} from '../server/lib/suggestions/types';
import type { WebAdapter } from '../../../scripts/lib/web-adapter';

// F064 Slice 3 (trusted-control evolution contract §5–§8): the card admission
// path and the suggestion-review ledger, exercised against the REAL service /
// apply / undo paths (no model). The ledger seam is the web adapter — typed by
// its .d.ts declaration, reached through the requireCli bridge.
const requireCli = createRequire(import.meta.url);
const adapter = requireCli('../../../scripts/lib/web-adapter.js') as WebAdapter;

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

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${contents}\n`);
}

describe('Improvement Suggestions review ledger (evolution contract §8)', () => {
  let root: string;
  let claudeHome: string;
  let homes: SuggestionHomes;
  let seamCounter = 0;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-review-'));
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-review-claude-'));
    homes = { claudeHome, codexHome: root, cursorHome: root };
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'amber-protocol' }));
    fs.mkdirSync(path.join(root, 'routes'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(claudeHome, { recursive: true, force: true });
  });

  function seedClaude(id: string, error = ERROR_A, tool = 'Bash'): string {
    const dir = path.join(claudeHome, '.claude', 'projects', encodeProjectPath(root));
    const file = path.join(dir, `${id}.jsonl`);
    writeFile(file, claudeFailureJsonl(tool, error, root));
    return file;
  }

  function opts() {
    return { repoRoot: root, homes };
  }

  function list() {
    return listSuggestions(opts());
  }

  function ledgerPath(): string {
    return path.join(root, '.amber', 'suggestions', 'review.jsonl');
  }

  function ledgerKinds(): string[] {
    if (!fs.existsSync(ledgerPath())) return [];
    return fs
      .readFileSync(ledgerPath(), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line).kind);
  }

  it('promotes a real cluster into proposed + validated and exposes the card with its dual-axis effect', () => {
    seedClaude('a');
    seedClaude('b');
    const cards = list().suggestions;
    expect(cards).toHaveLength(1);

    const card = cards[0];
    expect(card.status).toBe('open');
    expect(card.expectedEffect).toBeDefined();
    expect(card.expectedEffect!.readiness.length).toBeGreaterThan(0);
    expect(card.expectedEffect!.effectiveness).toContain('Bash');
    expect(card.rejectionHistory).toEqual({ status: 'none' });

    expect(ledgerKinds()).toEqual(['proposed', 'validated']);
    const [record] = adapter.foldSuggestionReview(root);
    expect(record.fingerprint).toBe(card.fingerprint);
    expect(record.validatedAt).toBeTruthy();
    expect(record.appliedCount).toBe(0);

    // A second scan is idempotent: the promotion and validation events are
    // written once, not once per page load.
    list();
    expect(ledgerKinds()).toEqual(['proposed', 'validated']);
  });

  it('a prior rejection is an informative notice that never blocks admission (§8.3)', () => {
    seedClaude('a');
    seedClaude('b');
    const fingerprint = frictionFingerprint('Bash', ERROR_A);

    // Pre-existing durable rejection for the SAME fingerprint (written through
    // the seam, exactly like an earlier scan's admission failure would have).
    const proposed = adapter.ensureSuggestionProposed(root, {
      fingerprint,
      evidence: [{ host: 'claude', transcriptId: 'old', excerpt: 'e' }],
      hosts: ['claude'],
      operations: [{ verb: 'create', path: 'docs/wiki/agent/friction/old.md' }],
      attribution: {
        entrySurface: 'tool-output',
        impactSurface: 'context',
        failureMode: 'enoent',
        responsibleArtifact: 'wiki',
      },
    });
    expect(proposed.ok).toBe(true);
    const rejected = adapter.recordSuggestionValidityRejection(root, {
      fingerprint,
      reason: 'validity:eval-only-claim',
      summary: 'the earlier cluster claimed only an eval reference',
    });
    expect(rejected.ok).toBe(true);

    // The scenario changed: admission now passes and the card is exposed
    // carrying the notice — the hint never blocks. The scan's proposal
    // content differs from the seeded round (fresh evidence, planner
    // operations), so the retry opens a new §8.2 proposal round before its
    // validation: proposed(round 1) → rejected → proposed(round 2) → validated.
    const cards = list().suggestions;
    expect(cards).toHaveLength(1);
    expect(cards[0].rejectionHistory).toMatchObject({
      status: 'rejected',
      reason: 'validity:eval-only-claim',
    });
    expect(ledgerKinds()).toEqual(['proposed', 'rejected', 'proposed', 'validated']);
    const [record] = adapter.foldSuggestionReview(root);
    expect(record.proposalCount).toBe(2);
    expect(record.rejectionsSinceLastProposal).toBe(0);
    expect(record.rejections).toHaveLength(1);
  });

  it('a corrupt review ledger fails the surface closed (E12 write side) and the hint reports unknown', () => {
    seedClaude('a');
    seedClaude('b');
    expect(list().suggestions).toHaveLength(1);
    fs.appendFileSync(ledgerPath(), 'garbage\n');

    expect(() => list()).toThrow(/AMBER_E_SUGGESTION_REVIEW_CORRUPT/);
    expect(adapter.suggestionReviewHistory(root, 'any-fingerprint')).toEqual({ status: 'unknown' });
  });

  // ── §8.2 proposal rounds: a retry is a new proposal, deduped per round ──

  function proposalInput(fingerprint: string, evidence: object[], hosts: string[]) {
    return {
      fingerprint,
      evidence,
      hosts,
      operations: [{ verb: 'create', path: 'docs/wiki/agent/friction/rounds.md', summary: 's' }],
      attribution: {
        entrySurface: 'tool-output',
        impactSurface: 'context',
        failureMode: 'enoent',
        responsibleArtifact: 'wiki',
      },
    };
  }

  it('an unchanged re-surface rides the existing round; a changed-evidence retry opens a new one (§8.2)', () => {
    const fingerprint = `fp-rounds-${(seamCounter += 1)}`;
    const input = proposalInput(
      fingerprint,
      [{ host: 'claude', transcriptId: 't1', excerpt: 'e' }],
      ['claude'],
    );

    expect(adapter.ensureSuggestionProposed(root, input)).toMatchObject({
      ok: true,
      appended: true,
    });
    expect(
      adapter.recordSuggestionValidityRejection(root, {
        fingerprint,
        reason: 'validity:no-evidence',
        summary: 'first round fails',
      }),
    ).toMatchObject({ ok: true, appended: true });

    // An unchanged re-surface (the same failing cluster rescanned) rides the
    // existing round: no second proposed event, no second same-round rejection.
    expect(adapter.ensureSuggestionProposed(root, input)).toEqual({
      ok: true,
      appended: false,
      record: null,
    });
    expect(
      adapter.recordSuggestionValidityRejection(root, {
        fingerprint,
        reason: 'validity:no-evidence',
        summary: 'same round again',
      }),
    ).toEqual({ ok: true, appended: false, record: null });
    expect(ledgerKinds()).toEqual(['proposed', 'rejected']);

    // A rejected round cannot be validated — the retry must re-propose first.
    const refused = adapter.recordSuggestionValidated(root, { fingerprint });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('AMBER_E_SUGGESTION_REVIEW_STATE');
      expect(refused.errors[0]).toContain('already rejected this round');
    }

    // Retry with changed cluster evidence: a new round with its own proposal.
    expect(
      adapter.ensureSuggestionProposed(root, {
        ...input,
        evidence: [{ host: 'claude', transcriptId: 't2', excerpt: 'different friction' }],
      }),
    ).toMatchObject({ ok: true, appended: true });
    expect(ledgerKinds()).toEqual(['proposed', 'rejected', 'proposed']);
    const [round2] = adapter
      .foldSuggestionReview(root)
      .filter((entry) => entry.fingerprint === fingerprint);
    expect(round2.proposalCount).toBe(2);
    expect(round2.rejectionsSinceLastProposal).toBe(0);
    expect(round2.validatedAt).toBeNull();
    expect(round2.rejections).toHaveLength(1);

    // The new round records its own rejection; the hint reports the latest.
    expect(
      adapter.recordSuggestionValidityRejection(root, {
        fingerprint,
        reason: 'validity:eval-only-claim',
        summary: 'second round fails differently',
      }),
    ).toMatchObject({ ok: true, appended: true });
    expect(adapter.suggestionReviewHistory(root, fingerprint)).toMatchObject({
      status: 'rejected',
      reason: 'validity:eval-only-claim',
    });

    // Round 3 passes and is applied; a currently-applied fingerprint is past
    // its admission decision and never re-proposes, even with changed evidence.
    expect(
      adapter.ensureSuggestionProposed(root, {
        ...input,
        evidence: [{ host: 'claude', transcriptId: 't3', excerpt: 'third round' }],
      }),
    ).toMatchObject({ ok: true, appended: true });
    expect(adapter.recordSuggestionValidated(root, { fingerprint }).ok).toBe(true);
    expect(
      adapter.recordSuggestionApplied(root, {
        fingerprint,
        applied: [
          {
            path: 'docs/wiki/agent/friction/rounds.md',
            beforeHash: null,
            afterHash: 'a'.repeat(64),
          },
        ],
      }).ok,
    ).toBe(true);
    expect(
      adapter.ensureSuggestionProposed(root, {
        ...input,
        evidence: [{ host: 'claude', transcriptId: 't4', excerpt: 'while applied' }],
      }),
    ).toEqual({ ok: true, appended: false, record: null });
    expect(ledgerKinds()).toEqual([
      'proposed',
      'rejected',
      'proposed',
      'rejected',
      'proposed',
      'validated',
      'applied',
    ]);

    // After an Undo the same round continues (no re-proposal): undo, then the
    // re-apply on the same proposal is legal again.
    expect(
      adapter.recordSuggestionUndone(root, {
        fingerprint,
        restored: [{ path: 'docs/wiki/agent/friction/rounds.md', hash: null }],
      }).ok,
    ).toBe(true);
    expect(
      adapter.ensureSuggestionProposed(root, {
        ...input,
        evidence: [{ host: 'claude', transcriptId: 't5', excerpt: 'after undo' }],
      }),
    ).toEqual({ ok: true, appended: false, record: null });
    expect(
      adapter.recordSuggestionApplied(root, {
        fingerprint,
        applied: [
          {
            path: 'docs/wiki/agent/friction/rounds.md',
            beforeHash: null,
            afterHash: 'b'.repeat(64),
          },
        ],
      }).ok,
    ).toBe(true);
    expect(ledgerKinds()).toEqual([
      'proposed',
      'rejected',
      'proposed',
      'rejected',
      'proposed',
      'validated',
      'applied',
      'undone',
      'applied',
    ]);
  });

  it('a host-set change also opens a new proposal round (§8.2)', () => {
    const fingerprint = `fp-rounds-hosts-${(seamCounter += 1)}`;
    const input = proposalInput(
      fingerprint,
      [{ host: 'claude', transcriptId: 't1', excerpt: 'e' }],
      ['claude'],
    );

    expect(adapter.ensureSuggestionProposed(root, input)).toMatchObject({
      ok: true,
      appended: true,
    });
    expect(
      adapter.recordSuggestionValidityRejection(root, {
        fingerprint,
        reason: 'validity:no-evidence',
        summary: 'first round fails',
      }),
    ).toMatchObject({ ok: true, appended: true });

    // Same evidence, but the cluster gained a host: the proposal is new.
    expect(
      adapter.ensureSuggestionProposed(root, { ...input, hosts: ['claude', 'codex'] }),
    ).toMatchObject({ ok: true, appended: true });
    const [record] = adapter
      .foldSuggestionReview(root)
      .filter((entry) => entry.fingerprint === fingerprint);
    expect(record.proposalCount).toBe(2);
    expect(record.hosts).toEqual(['claude', 'codex']);
  });

  // ── V1–V3 pass/fail matrices at the card admission boundary (§6) ──

  function realCard(): ImprovementSuggestion {
    seedClaude('a');
    seedClaude('b');
    const card = list().suggestions[0];
    expect(card).toBeTruthy();
    return card;
  }

  function seamSignals(fingerprint: string, sourceFile: string): FrictionSignal[] {
    return [
      {
        host: 'claude',
        transcriptId: 't1',
        tool: 'Bash',
        error: ERROR_A,
        excerpt: 'e',
        fingerprint,
        sourceFile,
      },
    ];
  }

  function admitAtSeam(card: ImprovementSuggestion, signals: FrictionSignal[]) {
    return admitSuggestionCard({
      repoRoot: root,
      card,
      signals,
      homes,
      actionable: true,
    });
  }

  it('V1: an unresolvable transcript citation rejects the card with validity:no-evidence', () => {
    const base = realCard();
    const fingerprint = `fp-seam-v1-${(seamCounter += 1)}`;
    const card: ImprovementSuggestion = { ...base, fingerprint };
    const missing = path.join(claudeHome, 'missing-transcript.jsonl');

    const outcome = admitAtSeam(card, seamSignals(fingerprint, missing));
    expect(outcome.exposed).toBe(false);
    if (!outcome.exposed) expect(outcome.reason).toBe('validity:no-evidence');

    const [record] = adapter
      .foldSuggestionReview(root)
      .filter((entry) => entry.fingerprint === fingerprint);
    expect(record.validatedAt).toBeNull();
    expect(record.rejections[0].reason).toBe('validity:no-evidence');
  });

  it('V2: a declared capability-registry reduction rejects the card with validity:capability-reduction', () => {
    const base = realCard();
    const fingerprint = `fp-seam-v2-${(seamCounter += 1)}`;
    // V1 must resolve before V2 is reached (the rules run V1→V2→V3), so the
    // citation has to be a real transcript under the card's host home.
    const sourceFile = path.join(claudeHome, 'real.jsonl');
    writeFile(sourceFile, 'x\n');
    const card: ImprovementSuggestion = {
      ...base,
      fingerprint,
      operations: [
        {
          verb: 'remove',
          artifactKind: 'wiki',
          path: '.amber/runner/registry.jsonl',
          summary: 'should never pass',
          expectedHash: 'a'.repeat(64),
        },
      ],
    };

    const outcome = admitAtSeam(card, seamSignals(fingerprint, sourceFile));
    expect(outcome.exposed).toBe(false);
    if (!outcome.exposed) expect(outcome.reason).toBe('validity:capability-reduction');

    const [record] = adapter
      .foldSuggestionReview(root)
      .filter((entry) => entry.fingerprint === fingerprint);
    expect(record.rejections[0].reason).toBe('validity:capability-reduction');
  });

  it('V3: a missing or eval-only effect statement rejects the card with validity:eval-only-claim', () => {
    const base = realCard();
    const sourceFile = path.join(claudeHome, 'real.jsonl');
    writeFile(sourceFile, 'x\n');

    // Missing statement.
    const missingFp = `fp-seam-v3a-${(seamCounter += 1)}`;
    const missingCard: ImprovementSuggestion = { ...base, fingerprint: missingFp };
    const { expectedEffect: _omit, ...withoutEffect } = missingCard;
    void _omit;
    const missingOutcome = admitAtSeam(withoutEffect, seamSignals(missingFp, sourceFile));
    expect(missingOutcome.exposed).toBe(false);
    if (!missingOutcome.exposed) expect(missingOutcome.reason).toBe('validity:eval-only-claim');

    // Eval-only axes.
    const evalFp = `fp-seam-v3b-${(seamCounter += 1)}`;
    const evalCard: ImprovementSuggestion = {
      ...base,
      fingerprint: evalFp,
      expectedEffect: { readiness: 'eval F058 passes', effectiveness: 'see the eval report' },
    };
    const evalOutcome = admitAtSeam(evalCard, seamSignals(evalFp, sourceFile));
    expect(evalOutcome.exposed).toBe(false);
    if (!evalOutcome.exposed) expect(evalOutcome.reason).toBe('validity:eval-only-claim');
  });

  it('V1–V3 pass at the seam: a valid card is exposed and validated', () => {
    const base = realCard();
    const fingerprint = `fp-seam-pass-${(seamCounter += 1)}`;
    const sourceFile = path.join(claudeHome, 'real.jsonl');
    writeFile(sourceFile, 'x\n');

    const outcome = admitAtSeam({ ...base, fingerprint }, seamSignals(fingerprint, sourceFile));
    expect(outcome.exposed).toBe(true);
    const [record] = adapter
      .foldSuggestionReview(root)
      .filter((entry) => entry.fingerprint === fingerprint);
    expect(record.validatedAt).toBeTruthy();
  });

  // ── Review actions: Dismiss / Snooze / Apply / Undo (§8.1/§8.2/§8.6) ──

  function openCard(): ImprovementSuggestion {
    seedClaude('a');
    seedClaude('b');
    const card = list().suggestions[0];
    expect(card).toBeTruthy();
    return card;
  }

  it('Dismiss appends a durable rejected event; Snooze stays overlay-only', () => {
    const card = openCard();

    const snoozed = snoozeSuggestion(card.id, opts());
    expect(snoozed.ok).toBe(true);
    expect(ledgerKinds()).toEqual(['proposed', 'validated'], 'snooze writes no ledger event');

    const dismissed = dismissSuggestion(card.id, opts());
    expect(dismissed.ok).toBe(true);
    expect(ledgerKinds()).toEqual(['proposed', 'validated', 'rejected']);
    const [record] = adapter.foldSuggestionReview(root);
    expect(record.rejections[0].reason).toBe('dismissed-by-operator');
  });

  it('Apply writes the file, the applied audit event, and the overlay — in §8.6 order', () => {
    const card = openCard();
    const applied = applySuggestionById(card.id, opts());
    expect(applied.ok).toBe(true);

    const abs = path.join(root, card.operations[0].path);
    expect(fs.existsSync(abs)).toBe(true);
    expect(ledgerKinds()).toEqual(['proposed', 'validated', 'applied']);
    const [record] = adapter.foldSuggestionReview(root);
    expect(record.appliedCount).toBe(1);
    expect(record.lastAppliedDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    // The applied bytes never ride the ledger — digest only (§8.4).
    expect(fs.readFileSync(ledgerPath(), 'utf8')).not.toContain('Improvement Suggestion');
    const overlay = JSON.parse(
      fs.readFileSync(path.join(root, '.amber', 'suggestions', 'state.json'), 'utf8'),
    );
    expect(overlay.records[card.fingerprint].status).toBe('applied');
  });

  it('Undo restores the bytes, appends undone, and returns the card to open', () => {
    const card = openCard();
    expect(applySuggestionById(card.id, opts()).ok).toBe(true);
    const abs = path.join(root, card.operations[0].path);

    const undone = undoSuggestionById(card.id, opts());
    expect(undone.ok).toBe(true);
    expect(fs.existsSync(abs)).toBe(false);
    expect(ledgerKinds()).toEqual(['proposed', 'validated', 'applied', 'undone']);
    const [record] = adapter.foldSuggestionReview(root);
    expect(record.undoneCount).toBe(1);
    expect(record.lastRestoredDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // ── Existing safety boundaries stay intact (no widened authority) ──

  it('MEMORY.md and non-allowlisted targets stay refused with no audit event', async () => {
    const base = openCard();
    const fingerprint = `fp-memory-${(seamCounter += 1)}`;
    // Stand up the promotion + admission chain, then drive Apply directly
    // with a forged MEMORY.md operation (the seam setup mirrors the service).
    const proposed = adapter.ensureSuggestionProposed(root, {
      fingerprint,
      evidence: base.evidence,
      hosts: base.hosts,
      operations: base.operations,
      attribution: base.findingAttribution!,
    });
    expect(proposed.ok).toBe(true);
    expect(adapter.recordSuggestionValidated(root, { fingerprint }).ok).toBe(true);

    const forged: ImprovementSuggestion = {
      ...base,
      fingerprint,
      operations: [
        {
          verb: 'create',
          artifactKind: 'wiki',
          path: 'MEMORY.md',
          summary: 'should never land',
          contents: 'nope\n',
          expectedHash: null,
        },
      ],
    };
    const result = applySuggestion(root, forged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('stale');
    expect(fs.existsSync(path.join(root, 'MEMORY.md'))).toBe(false);
    // The forged fingerprint's own chain is intact (proposed + validated) and
    // the refusal added no applied event for it.
    expect(ledgerKinds()).toEqual(['proposed', 'validated', 'proposed', 'validated']);
    const kinds = ledgerKinds();
    expect(kinds.filter((kind) => kind === 'applied').length).toBe(0);
  });

  it('all-or-nothing: a multi-operation card with one invalid op writes nothing and appends nothing', async () => {
    const base = openCard();
    const fingerprint = `fp-multi-${(seamCounter += 1)}`;
    const proposed = adapter.ensureSuggestionProposed(root, {
      fingerprint,
      evidence: base.evidence,
      hosts: base.hosts,
      operations: base.operations,
      attribution: base.findingAttribution!,
    });
    expect(proposed.ok).toBe(true);
    expect(adapter.recordSuggestionValidated(root, { fingerprint }).ok).toBe(true);

    const good = base.operations[0];
    const forged: ImprovementSuggestion = {
      ...base,
      fingerprint,
      operations: [
        good,
        {
          verb: 'create',
          artifactKind: 'wiki',
          path: 'scripts/lib/core/doctor.js',
          summary: 'second op must refuse',
          contents: 'nope\n',
          expectedHash: null,
        },
      ],
    };
    const result = applySuggestion(root, forged);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('stale');
    expect(fs.existsSync(path.join(root, good.path))).toBe(false);
    expect(fs.existsSync(path.join(root, 'scripts/lib/core/doctor.js'))).toBe(false);
    expect(ledgerKinds().filter((kind) => kind === 'applied').length).toBe(0);
  });

  // ── §8.6 precheck refusals: nothing changes where precheck can catch it ──

  it('a corrupt ledger refuses Apply before any mutation', () => {
    const card = openCard();
    // Corrupt the ledger AFTER promotion, then drive Apply through the raw
    // apply path: the service's own list() would re-promote and throw at
    // promotion, which is the read side — this test is about the §8.6
    // write-side precheck refusing before the target file is touched.
    fs.appendFileSync(ledgerPath(), 'garbage\n');
    const result = applySuggestion(root, card);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('AMBER_E_SUGGESTION_REVIEW_CORRUPT');
      expect(result.message).toContain('Refused before any change');
    }
    expect(fs.existsSync(path.join(root, card.operations[0].path))).toBe(false);
    // The ledger is byte-identical to what promotion left plus the corruption:
    // the refused Apply appended nothing.
    expect(fs.readFileSync(ledgerPath(), 'utf8').trimEnd().endsWith('garbage')).toBe(true);
    expect(fs.readFileSync(ledgerPath(), 'utf8').split(/\r?\n/).filter(Boolean).length).toBe(3);
  });

  it('an exhausted ceiling refuses Apply before any mutation', () => {
    const card = openCard();
    process.env.AMBER_SUGGESTION_REVIEW_MAX_BYTES = '1';
    try {
      const result = applySuggestionById(card.id, opts());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('AMBER_E_SUGGESTION_REVIEW_SIZE_CEILING');
      expect(fs.existsSync(path.join(root, card.operations[0].path))).toBe(false);
      expect(ledgerKinds()).toEqual(['proposed', 'validated']);
    } finally {
      delete process.env.AMBER_SUGGESTION_REVIEW_MAX_BYTES;
    }
  });

  it('a fresh lock refuses Apply before any mutation', () => {
    const card = openCard();
    fs.writeFileSync(path.join(path.dirname(ledgerPath()), 'review.lock'), 'held-by-a-live-writer');
    try {
      const result = applySuggestionById(card.id, opts());
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('AMBER_E_SUGGESTION_REVIEW_LOCK');
      expect(fs.existsSync(path.join(root, card.operations[0].path))).toBe(false);
      expect(ledgerKinds()).toEqual(['proposed', 'validated']);
    } finally {
      fs.rmSync(path.join(path.dirname(ledgerPath()), 'review.lock'), { force: true });
    }
  });

  // ── §8.6 compensation: audit append failure after the target mutation ──

  function patchFs(overrides: { append?: boolean; unlink?: boolean }) {
    const realAppend = fs.appendFileSync;
    const realUnlink = fs.unlinkSync;
    if (overrides.append) {
      fs.appendFileSync = ((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
        if (String(typeof target === 'number' ? '' : target).endsWith('review.jsonl')) {
          throw new Error('EACCES: permission denied, open review.jsonl (simulated)');
        }
        return (realAppend as (...args: unknown[]) => void)(target, ...rest);
      }) as typeof fs.appendFileSync;
    }
    if (overrides.unlink) {
      fs.unlinkSync = ((target: fs.PathLike) => {
        if (String(target).endsWith('.md')) {
          throw new Error('EPERM: operation not permitted, unlink (simulated)');
        }
        return (realUnlink as (p: fs.PathLike) => void)(target);
      }) as typeof fs.unlinkSync;
    }
    return () => {
      fs.appendFileSync = realAppend;
      fs.unlinkSync = realUnlink;
    };
  }

  it('an audit append failure after mutation compensates by byte-restore and returns audit-write-failed', () => {
    const card = openCard();
    const restore = patchFs({ append: true });
    try {
      const result = applySuggestionById(card.id, opts());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('audit-write-failed');
        expect(result.message).toContain('rolled back');
        expect(result.message).not.toContain('DEGRADED');
      }
      // Compensation removed the created file; the overlay never saw applied
      // (it holds no record for this fingerprint — and may not exist at all,
      // since the overlay is written only after a successful audit append);
      // the ledger has no applied event.
      expect(fs.existsSync(path.join(root, card.operations[0].path))).toBe(false);
      expect(ledgerKinds()).toEqual(['proposed', 'validated']);
      const overlayPath = path.join(root, '.amber', 'suggestions', 'state.json');
      const overlay = fs.existsSync(overlayPath)
        ? JSON.parse(fs.readFileSync(overlayPath, 'utf8'))
        : { records: {} };
      expect(overlay.records[card.fingerprint]).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('a failed compensation names the degraded state and the operator reconciliation step — never success', () => {
    const card = openCard();
    const restore = patchFs({ append: true, unlink: true });
    try {
      const result = applySuggestionById(card.id, opts());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('audit-write-failed');
        expect(result.message).toContain('DEGRADED STATE');
        expect(result.message).toContain('reconciliation');
      }
      // The file remains (compensation could not remove it) and no applied
      // event exists — the mismatch is the degraded state the message names.
      expect(fs.existsSync(path.join(root, card.operations[0].path))).toBe(true);
      expect(ledgerKinds().filter((kind) => kind === 'applied').length).toBe(0);
    } finally {
      restore();
    }
  });

  it('an Undo audit append failure compensates by restoring the applied bytes', () => {
    const card = openCard();
    expect(applySuggestionById(card.id, opts()).ok).toBe(true);
    const abs = path.join(root, card.operations[0].path);
    const appliedBytes = fs.readFileSync(abs, 'utf8');

    const restore = patchFs({ append: true });
    try {
      const result = undoSuggestionById(card.id, opts());
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('audit-write-failed');
        expect(result.message).toContain('rolled back');
      }
      // Compensation re-created the file with the exact bytes Apply left;
      // the overlay still says applied; no undone event exists.
      expect(fs.readFileSync(abs, 'utf8')).toBe(appliedBytes);
      expect(ledgerKinds()).toEqual(['proposed', 'validated', 'applied']);
      const overlay = JSON.parse(
        fs.readFileSync(path.join(root, '.amber', 'suggestions', 'state.json'), 'utf8'),
      );
      expect(overlay.records[card.fingerprint].status).toBe('applied');
    } finally {
      restore();
    }
  });
});
