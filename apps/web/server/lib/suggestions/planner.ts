import fs from 'fs';
import { safeToolName } from './fingerprint';
import { displayFailureMode, normalizeError } from './fingerprint';
import { fileHash, resolveRepoFile } from './paths';
import type {
  ExpectedEffect,
  FindingAttribution,
  FrictionSignal,
  HostId,
  SuggestionOperation,
} from './types';

function slugFor(fingerprint: string): string {
  return fingerprint.slice(0, 12);
}

function frictionRelPath(fingerprint: string): string {
  return `docs/wiki/agent/friction/${slugFor(fingerprint)}.md`;
}

function wikiBody(input: {
  fingerprint: string;
  tool: string;
  group: FrictionSignal[];
  transcriptCount: number;
  hosts: HostId[];
  now: Date;
}): string {
  const date = input.now.toISOString().slice(0, 10);
  const excerpts = input.group
    .slice(0, 5)
    .map((item, index) => `${index + 1}. [${item.host} / ${item.transcriptId}] ${item.excerpt}`)
    .join('\n');
  const sample = normalizeError(input.group[0].error);

  return [
    '---',
    'type: agent',
    `title: Repeated ${input.tool} failure`,
    'description: Improvement Suggestion from clustered host transcripts.',
    'tags: [agent, friction]',
    `updated: ${date}`,
    '---',
    '',
    `# Repeated ${input.tool} failure`,
    '',
    `This note was applied from an Improvement Suggestion. It records a tool failure that showed up in ${input.transcriptCount} sessions across ${input.hosts.join(', ')}. It does not change product code or tests.`,
    '',
    '## Evidence',
    '',
    `- Sessions: ${input.transcriptCount}`,
    `- Hosts: ${input.hosts.join(', ')}`,
    `- Fingerprint: \`${input.fingerprint}\``,
    '',
    '### Excerpts',
    '',
    excerpts,
    '',
    '## Suggested rule',
    '',
    `When calling \`${input.tool}\`, the following failure has recurred:`,
    '',
    `> ${sample}`,
    '',
    'Prefer a durable check or a clearer instruction on this knowledge surface before retrying the same call.',
    '',
    '## Suggested AGENTS.md bullet',
    '',
    `- When \`${input.tool}\` fails with this class of error, stop and inspect this wiki note instead of retrying blindly.`,
    '',
    '## Boundary',
    '',
    'Product code and tests are out of scope for this Apply path. Promote a fix through a normal session if the failure is a product defect.',
    '',
  ].join('\n');
}

// ── Instruction-surface operations (evolution contract §4 row 3, E11; plan
// Slice 6, the declared F064 §4 planner revision) ──
//
// Instruction edits change agent behavior, so the two operations below carry
// the behavior-affecting presentation duty: their summaries state the behavior
// change explicitly and name the F058 boundary (eval results never authorize
// an instruction-behavior change) — never a low-risk-by-filename framing. All
// derivation is deterministic (same inputs → same operations); wiki stays the
// first operation and the default suggestion surface.

/** The one AGENTS.md rule the friction note suggests (mirrors the wiki body's suggested bullet). */
function agentsMdBullet(tool: string, wikiRelPath: string): string {
  return `- When \`${tool}\` fails with this class of error, read \`${wikiRelPath}\` and follow its durable check instead of retrying blindly.`;
}

/**
 * The AGENTS.md instruction operation: an `update` appending the suggested
 * bullet to the current file (expectedHash pins it against Apply-time drift),
 * or a `create` when the file does not exist. The summary carries the
 * behavior-affecting presentation duty. Refuses loudly when the allowlisted
 * path cannot be resolved to a safe repo file (e.g. a symlinked escape) — a
 * silent omission would hide exactly the kind of edit the review duty exists
 * for.
 */
export function planAgentsMdOperation(input: {
  repoRoot: string;
  fingerprint: string;
  tool: string;
  wikiRelPath: string;
}): SuggestionOperation {
  const abs = resolveRepoFile(input.repoRoot, 'AGENTS.md');
  if (!abs) {
    throw new Error('AGENTS.md is allowlisted but did not resolve inside the repo; refusing to plan an instruction edit against an unresolved path');
  }
  const tool = safeToolName(input.tool);
  const summary =
    `Behavior-affecting instruction edit: this changes how every agent that reads AGENTS.md calls \`${tool}\`. ` +
    'It is gated by human review at Apply; eval results never authorize it (F058).';
  const bullet = agentsMdBullet(tool, input.wikiRelPath);

  const existingHash = fileHash(abs);
  if (existingHash === null) {
    return {
      verb: 'create',
      artifactKind: 'agents-md',
      path: 'AGENTS.md',
      summary,
      contents: `# AGENTS.md\n\n${bullet}\n`,
      expectedHash: null,
    };
  }
  // Update: append to the pinned current bytes. A drift between plan and
  // Apply is the existing `stale` refusal, never a silent overwrite.
  const current = fs.readFileSync(abs, 'utf8');
  const glue = current.endsWith('\n') ? '\n' : '\n\n';
  return {
    verb: 'update',
    artifactKind: 'agents-md',
    path: 'AGENTS.md',
    summary,
    contents: `${current}${glue}${bullet}\n`,
    expectedHash: existingHash,
  };
}

/**
 * The skill instruction operation: a deterministic SKILL.md create under
 * `skills/agent-friction-<fingerprint slug>/` teaching the same durable
 * handling rule the wiki note records. Created disabled-by-having-no-runtime:
 * a skill file is consulted by agents, never scheduled or executed by Amber.
 */
export function planSkillOperation(input: {
  fingerprint: string;
  tool: string;
  wikiRelPath: string;
}): SuggestionOperation {
  const tool = safeToolName(input.tool);
  const name = `agent-friction-${input.fingerprint.slice(0, 12)}`;
  const contents = [
    '---',
    `name: ${name}`,
    `description: Durable handling for the recurring \`${tool}\` failure recorded at \`${input.wikiRelPath}\`.`,
    '---',
    '',
    `# ${name}`,
    '',
    `This skill was applied from an Improvement Suggestion. It changes agent behavior: any agent that loads it will call \`${tool}\` differently.`,
    '',
    '## Rule',
    '',
    agentsMdBullet(tool, input.wikiRelPath),
    '',
    '## Boundary',
    '',
    'Eval results never authorize this skill or any instruction-behavior change (F058); the human review at Apply is the gate. Product code and tests are out of scope for this Apply path.',
    '',
  ].join('\n');
  return {
    verb: 'create',
    artifactKind: 'skill',
    path: `skills/${name}/SKILL.md`,
    summary:
      `Behavior-affecting instruction edit: this skill changes how agents that load it call \`${tool}\`. ` +
      'It is gated by human review at Apply; eval results never authorize it (F058).',
    contents,
    expectedHash: null,
  };
}

/**
 * The full card plan: the wiki friction note first (the default suggestion
 * surface, unchanged) followed by the two instruction-surface operations
 * under the existing allowlist. Deterministic per inputs and repo state.
 */
export function planFrictionCardOperations(input: {
  repoRoot: string;
  fingerprint: string;
  tool: string;
  group: FrictionSignal[];
  transcriptCount: number;
  hosts: HostId[];
  now: Date;
}): SuggestionOperation[] {
  const wikiRelPath = frictionRelPath(input.fingerprint);
  return [
    ...planFrictionNote(input),
    planAgentsMdOperation({
      repoRoot: input.repoRoot,
      fingerprint: input.fingerprint,
      tool: input.tool,
      wikiRelPath,
    }),
    planSkillOperation({ fingerprint: input.fingerprint, tool: input.tool, wikiRelPath }),
  ];
}

export function planFrictionNote(input: {
  fingerprint: string;
  tool: string;
  group: FrictionSignal[];
  transcriptCount: number;
  hosts: HostId[];
  now: Date;
}): SuggestionOperation[] {
  const rel = frictionRelPath(input.fingerprint);
  return [
    {
      verb: 'create',
      artifactKind: 'wiki',
      path: rel,
      summary: `Record the repeated ${input.tool} failure on the wiki friction surface.`,
      contents: wikiBody(input),
      expectedHash: null,
    },
  ];
}

// Structured attribution for a promoted friction card (trusted-control
// evolution contract §3), derived deterministically from the real signal and
// the planned wiki destination — a claim about where the friction is
// attributed, never a permission. failureMode goes through the display-safe
// boundary (redactSecrets BEFORE normalizeError), so no secret material from
// the raw error reaches the new persisted/rendered metadata.
export function deriveFindingAttribution(input: {
  tool: string;
  group: FrictionSignal[];
}): FindingAttribution {
  return {
    entrySurface: 'tool-output',
    impactSurface: 'context',
    failureMode: displayFailureMode(input.group[0].error),
    responsibleArtifact: 'wiki',
  };
}

// Dual-axis expected-effect statement (trusted-control evolution contract §6
// V3): the planner's planned change names BOTH axes of the dual-axis
// assessment — readiness (what the durable note gives agents to consult) and
// effectiveness (what recurring friction it addresses). Deterministic text,
// never an eval reference (F058 non-authority); admission validates the shape
// through the shared core invariant. Presence is proven, soundness is not —
// the semantic judge is the operator reviewing the card (E5).
export function deriveExpectedEffect(input: {
  tool: string;
  transcriptCount: number;
}): ExpectedEffect {
  return {
    readiness: `Recording this recurring ${input.tool} failure on the wiki friction surface gives agents a durable note to consult before retrying the same call.`,
    effectiveness: `The friction note points ${input.transcriptCount} recurring ${input.tool} failure sessions at the recorded failure mode instead of blind retries, reducing repeated failed calls of this class.`,
  };
}
