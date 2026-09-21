import { normalizeError } from './fingerprint';
import type { FrictionSignal, HostId, SuggestionOperation } from './types';

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
