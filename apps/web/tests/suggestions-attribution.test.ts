import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { execFileSync } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { encodeProjectPath } from '../server/lib/claude-transcript-reader';
import { cursorWorkspaceHash } from '../server/lib/suggestions/paths';
import { listSuggestions } from '../server/lib/suggestions/service';
import { deriveFindingAttribution } from '../server/lib/suggestions/planner';
import type { FrictionSignal } from '../server/lib/suggestions/types';
import type { WebAdapter } from '../../../scripts/lib/web-adapter';

const here = path.dirname(fileURLToPath(import.meta.url));

// The closed vocabulary and validator authority is the core module, reached
// through the web-adapter seam — typed by the adapter's .d.ts declaration
// (the typed SSOT), never an ad hoc asserted shape or a parallel TS enum
// authority.
const requireCli = createRequire(import.meta.url);
const adapter = requireCli('../../../scripts/lib/web-adapter.js') as WebAdapter;
const { attributionProblem, FINDING_ATTRIBUTION } = adapter;

// The single literal the runtime test deepEquals against AND the compiler
// check pins the TS unions to — one source of truth for both directions.
const ENTRY = ['instruction-surface', 'tool-output', 'policy-rule', 'capability-request'] as const;
const IMPACT = ['target-repo', 'context', 'external', 'governance-state'] as const;
const ARTIFACT = [
  'instruction-surface',
  'rules',
  'memory',
  'capability-registry',
  'wiki',
  'route',
  'loop-contract',
] as const;

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

describe('Improvement Suggestions structured attribution (evolution contract §3)', () => {
  let root: string;
  let claudeHome: string;
  let codexHome: string;
  let cursorHome: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-attrib-'));
    claudeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-attrib-claude-'));
    codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-attrib-codex-'));
    cursorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-suggest-attrib-cursor-'));
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

  it('attaches a valid findingAttribution to every promoted card — no silent downgrade (B1R ST-B1-01)', () => {
    seedClaude('claude-1', ERROR_A);
    seedCodex('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ERROR_A);
    const cards = list().suggestions;
    expect(cards).toHaveLength(1);

    const attribution = cards[0].findingAttribution;
    // A new promoted card ALWAYS carries its attribution: an invalid derived
    // block must throw at the boundary, never emit an unattributed card.
    expect(attribution).toBeDefined();
    // Deterministic derivation from the real signal and the planned wiki destination.
    expect(attribution!.entrySurface).toBe('tool-output');
    expect(attribution!.impactSurface).toBe('context');
    expect(attribution!.responsibleArtifact).toBe('wiki');
    // failureMode reuses the display-safe boundary (redact BEFORE normalize):
    // digits and paths are normalized and no raw host path leaks.
    expect(attribution!.failureMode).toBe('enoent: no such file or directory, open <path>');
    expect(attribution!.failureMode).not.toContain('/tmp/foo-123/bar');
    // The block passes the core validator through the seam.
    expect(attributionProblem(attribution)).toBeNull();
  });

  it('redacts secret material from the derived failureMode before it is persisted (B1R SP-B1-01)', () => {
    const token = 'SyntheticSecretGhIjKlMnOpQrStUvWx';
    const group: FrictionSignal[] = [
      {
        host: 'claude',
        transcriptId: 't1',
        tool: 'Bash',
        error: `Authorization: Bearer ${token}`,
        excerpt: 'excerpt',
        fingerprint: 'f',
      },
    ];
    const derived = deriveFindingAttribution({ tool: 'Bash', group });
    expect(derived.failureMode.toLowerCase()).not.toContain(token.toLowerCase());
    expect(derived.failureMode).toContain('[redacted]');
    expect(attributionProblem(derived)).toBeNull();
  });

  it('derives attribution deterministically: same signal, same block', () => {
    const group: FrictionSignal[] = [
      {
        host: 'claude',
        transcriptId: 't1',
        tool: 'Bash',
        error: ERROR_A,
        excerpt: 'excerpt',
        fingerprint: 'f',
      },
    ];
    const first = deriveFindingAttribution({ tool: 'Bash', group });
    const second = deriveFindingAttribution({ tool: 'Bash', group });
    expect(first).toEqual(second);
    expect(attributionProblem(first)).toBeNull();
  });

  it('does not widen any permission: attribution changes nothing about routing', () => {
    seedClaude('claude-1', ERROR_A);
    seedCodex('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ERROR_A);
    const card = list().suggestions[0];

    // Apply routing: the wiki friction note is still the first operation and
    // the default suggestion surface (Slice 6 adds the instruction-surface
    // operations beside it, under the same allowlist); status open; no apply
    // permission implied by the attribution claim.
    expect(card.operations[0].verb).toBe('create');
    expect(card.operations[0].artifactKind).toBe('wiki');
    expect(card.operations[0].path).toMatch(/^docs\/wiki\/agent\/friction\/[0-9a-f]{12}\.md$/);
    expect(card.operations.map((op) => op.artifactKind)).toEqual(['wiki', 'agents-md', 'skill']);
    expect(card.status).toBe('open');
    // Changing an attribution claim can never add a destination or verb: the
    // attribution vocabulary contains no path, verb, or allowlist influence.
    const attribution = card.findingAttribution!;
    expect(Object.keys(attribution).sort()).toEqual([...FINDING_ATTRIBUTION.FIELDS].slice().sort());
    expect(JSON.stringify(attribution)).not.toMatch(/MEMORY\.md|AGENTS\.md|apply|allowlist/);
  });

  it('keeps legacy behavior: below-threshold failures promote no card, existing card fields unchanged', () => {
    // One-off failure: no card at all (threshold behavior preserved).
    seedClaude('only-once', ERROR_A);
    expect(list().suggestions).toEqual([]);

    // Promoted card keeps every pre-attribution field exactly as before.
    seedCodex('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', ERROR_A);
    const card = list().suggestions[0];
    expect(card.id).toBe(card.fingerprint.slice(0, 16));
    expect(card.tool).toBe('Bash');
    expect(card.transcriptCount).toBe(2);
    expect(card.hosts).toEqual(['claude', 'codex']);
    expect(card.evidenceCount).toBe(2);
    expect(card.title).toContain('Bash');
    expect(card.evidence[0].host).toBe('claude');
  });

  it('parity is exhaustive and compiler-enforced: TS unions == runtime closed sets (B1R ST-B1-03)', () => {
    // Runtime direction: the frozen core arrays equal the single literal set.
    expect([...FINDING_ATTRIBUTION.ENTRY_SURFACES]).toEqual([...ENTRY]);
    expect([...FINDING_ATTRIBUTION.IMPACT_SURFACES]).toEqual([...IMPACT]);
    expect([...FINDING_ATTRIBUTION.RESPONSIBLE_ARTIFACTS]).toEqual([...ARTIFACT]);
    expect([...FINDING_ATTRIBUTION.FIELDS]).toEqual([
      'entrySurface',
      'impactSurface',
      'failureMode',
      'responsibleArtifact',
    ]);

    // Compiler direction: tests are not covered by tsconfig.node.json, so a
    // merely annotated sample proves nothing. Compile a temp module with the
    // installed TypeScript that pins the unions to literals built from THE
    // SAME top-level arrays the runtime assertion above just compared to the
    // core — the bridge that makes the two checks transitive: a drift between
    // core and fixture fails the runtime toEqual; a drift between fixture and
    // TS unions fails this compile (verified in both directions).
    // The literals are JSON.stringify'd from ENTRY/IMPACT/ARTIFACT — never a
    // second hand-written copy that could silently age apart from the fixture.
    const tmpDir = fs.mkdtempSync(path.resolve(here, '.attribution-parity-'));
    const tmpFile = path.join(tmpDir, 'parity.ts');
    const paritySource = [
      "import type { EntrySurface, ImpactSurface, ResponsibleArtifact } from '../../server/lib/suggestions/types';",
      `const ENTRY = ${JSON.stringify([...ENTRY])} as const;`,
      `const IMPACT = ${JSON.stringify([...IMPACT])} as const;`,
      `const ARTIFACT = ${JSON.stringify([...ARTIFACT])} as const;`,
      // literal ⊆ union: an extra literal value fails this assignment.
      'const entryOk: readonly EntrySurface[] = ENTRY;',
      'const impactOk: readonly ImpactSurface[] = IMPACT;',
      'const artifactOk: readonly ResponsibleArtifact[] = ARTIFACT;',
      // union ⊆ literal: a union member missing from the literal leaves a
      // non-never remainder, which does not satisfy the never constraint.
      'type AssertNever<T extends never> = T;',
      'type _EntryExhaustive = AssertNever<Exclude<EntrySurface, (typeof ENTRY)[number]>>;',
      'type _ImpactExhaustive = AssertNever<Exclude<ImpactSurface, (typeof IMPACT)[number]>>;',
      'type _ArtifactExhaustive = AssertNever<Exclude<ResponsibleArtifact, (typeof ARTIFACT)[number]>>;',
      'void entryOk; void impactOk; void artifactOk;',
    ].join('\n');
    try {
      // 'wx' — exclusive create: a unique mkdtemp directory plus an exclusive
      // file write, so no pre-existing file can ever be clobbered.
      fs.writeFileSync(tmpFile, paritySource, { flag: 'wx' });
      const tscBin = requireCli.resolve('typescript/bin/tsc');
      const webRoot = path.resolve(here, '..');
      // --noEmit compile of the temp module (plus its type-only import).
      // --ignoreConfig: a bare file compile must not trip over the ambient
      // tsconfig (TS5112 on this TypeScript). Any non-zero exit or
      // diagnostics output fails the parity test — verified to fire in BOTH
      // drift directions (a union member missing from the literal → TS2344;
      // an extra literal outside the union → TS2322).
      const output = execFileSync(
        process.execPath,
        [tscBin, '--noEmit', '--skipLibCheck', '--ignoreConfig', tmpFile],
        {
          cwd: webRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      expect(String(output).trim()).toBe('');
    } finally {
      // Cleanup only the exclusively-created directory from mkdtempSync above
      // (resolved path); nothing else under tests/ is touched.
      fs.rmSync(path.resolve(tmpDir), { recursive: true, force: true });
    }

    // The vocabulary is frozen — widening attempts throw.
    expect(() => {
      (FINDING_ATTRIBUTION.ENTRY_SURFACES as unknown as string[]).push('new-surface');
    }).toThrow();
  });
});
