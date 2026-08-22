/**
 * Pure, side-effect-free denoising rules for Claude Code transcript turns.
 *
 * Rules follow the transcript timeline refactor report (R1-R9). Matching is
 * content-based on `turn.text` so the same logic works with or without the
 * optional server-side `subtype`/`isMeta` passthrough fields:
 *
 *  R1 local-command-caveat  -> hidden (MetadataPanel "localCommand" group)
 *  R2 slash command         -> folded single-line chip card
 *  R3 local-command-stdout   -> folded single line (first line, ANSI stripped)
 *  R4 ANSI escapes          -> stripped from every displayed text
 *  R5 task-notification     -> folded single line (its <summary>)
 *  R6 system-reminder       -> hidden (MetadataPanel "systemReminder" group)
 *  R7 metadata-only shells  -> handled by transcripts-model (unchanged)
 *  R8 away_summary recap    -> folded single line (suffix removed)
 *  R9 whitespace collapse   -> applied to every extracted summary
 *
 * Nothing here touches React or the network; every export is unit-testable.
 */

export type DenoiseKind =
  'hidden' | 'slashCommand' | 'stdout' | 'taskNotification' | 'recap' | 'plain';

export type DenoiseHiddenGroup = 'localCommand' | 'systemReminder';

export interface DenoiseTurnLike {
  text?: string;
  subtype?: string;
}

export interface DenoiseResult {
  kind: DenoiseKind;
  /** Only set when kind === 'hidden': which MetadataPanel group counts it. */
  hiddenGroup?: DenoiseHiddenGroup;
  /** Single-line summary for folded kinds; empty for hidden/plain. */
  summary: string;
  /** Parameter rendered into the chip, e.g. the `/model` slash command name. */
  chipParam?: string;
  /** R2 records may also carry command output; surfaced as a second chip. */
  secondaryChip?: 'commandStdout';
  /** Original text with R4 ANSI stripping applied; tags preserved for "view raw". */
  raw: string;
}

/** Declarative description of the rule table (documentation + diagnostics). */
export const TRANSCRIPT_NOISE_RULES = [
  { id: 'R1', name: 'local-command-caveat', action: 'hide' },
  { id: 'R2', name: 'slash-command', action: 'fold-chip' },
  { id: 'R3', name: 'local-command-stdout', action: 'fold-line' },
  { id: 'R4', name: 'ansi-escape', action: 'strip-global' },
  { id: 'R5', name: 'task-notification', action: 'fold-line' },
  { id: 'R6', name: 'system-reminder', action: 'hide' },
  { id: 'R7', name: 'metadata-only-shell', action: 'hide' },
  { id: 'R8', name: 'away-summary-recap', action: 'fold-line' },
  { id: 'R9', name: 'whitespace-collapse', action: 'normalize' },
] as const;

export const SUMMARY_LIMIT_SHORT = 80;
export const SUMMARY_LIMIT_LONG = 120;

// R1/R6 use whole-message anchoring (^...$): user messages merely *quoting*
// these tags are never hidden — only messages that ARE the wrapper block.
const CAVEAT_PATTERN = /^<local-command-caveat>[\s\S]*<\/local-command-caveat>\s*$/;
const SYSTEM_REMINDER_PATTERN = /^<system-reminder>[\s\S]*<\/system-reminder>\s*$/;
// R4: CSI sequences plus OSC sequences (terminated by BEL, or end of text).
const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\u0007]*(?:\u0007|$)/g;
// R8: the server-side `subtype: 'away_summary'` passthrough is the precise
// discriminator; the trailing-suffix heuristic is only a fallback for legacy
// data that predates the passthrough (Claude Code may reword the recap text
// at any time, so the suffix alone must never be the primary signal).
const RECAP_SUFFIX_PATTERN = /\(disable recaps in \/config\)\s*$/;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/** Returns the inner content of the first `<tag>...</tag>` block, if any. */
export function extractTag(text: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(text);
  return match ? match[1] : undefined;
}

/** R9: collapse every whitespace run (including newlines) into one space. */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split('\n')) {
    if (line.trim()) return line;
  }
  return '';
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function foldFirstLine(text: string, maxLength: number): string {
  return truncate(collapseWhitespace(firstNonEmptyLine(text)), maxLength);
}

function classifySlashCommand(text: string, raw: string): DenoiseResult {
  const name = collapseWhitespace(extractTag(text, 'command-name') ?? '').replace(/^\/+/, '');
  const args = collapseWhitespace(extractTag(text, 'command-args') ?? '');
  const message = collapseWhitespace(extractTag(text, 'command-message') ?? '');
  const summary = truncate(args || message, SUMMARY_LIMIT_SHORT);

  return {
    kind: 'slashCommand',
    summary,
    chipParam: `/${name}`,
    secondaryChip: text.includes('<local-command-stdout>') ? 'commandStdout' : undefined,
    raw,
  };
}

function classifyStdout(text: string, raw: string): DenoiseResult {
  const content = extractTag(text, 'local-command-stdout') ?? '';
  return {
    kind: 'stdout',
    summary: foldFirstLine(stripAnsi(content), SUMMARY_LIMIT_LONG),
    raw,
  };
}

function classifyTaskNotification(text: string, raw: string): DenoiseResult {
  const summaryTag = extractTag(text, 'summary');
  const fallbackSource = stripAnsi(text).replace(/<\/?task-notification>/g, '');
  const summary =
    summaryTag !== undefined
      ? truncate(collapseWhitespace(summaryTag), SUMMARY_LIMIT_LONG)
      : truncate(collapseWhitespace(fallbackSource), SUMMARY_LIMIT_LONG);

  return { kind: 'taskNotification', summary, raw };
}

function classifyRecap(text: string, raw: string): DenoiseResult {
  const withoutSuffix = text.replace(RECAP_SUFFIX_PATTERN, '');
  return {
    kind: 'recap',
    summary: foldFirstLine(stripAnsi(withoutSuffix), SUMMARY_LIMIT_LONG),
    raw,
  };
}

/**
 * Classify a transcript turn into its denoised presentation. Rule order is
 * fixed: R1/R6 hide -> R2/R3/R5/R8 fold -> R4 strip (already applied to
 * `raw`) -> plain fallback. R2 wins over R3; the stdout chip is attached as
 * `secondaryChip` instead.
 */
export function classifyTurn(turn: DenoiseTurnLike): DenoiseResult {
  const text = turn.text ?? '';
  const raw = stripAnsi(text);

  if (CAVEAT_PATTERN.test(text)) {
    return { kind: 'hidden', hiddenGroup: 'localCommand', summary: '', raw };
  }
  if (SYSTEM_REMINDER_PATTERN.test(text)) {
    return { kind: 'hidden', hiddenGroup: 'systemReminder', summary: '', raw };
  }
  if (text.includes('<command-name>')) {
    return classifySlashCommand(text, raw);
  }
  if (text.includes('<local-command-stdout>')) {
    return classifyStdout(text, raw);
  }
  if (text.includes('<task-notification>')) {
    return classifyTaskNotification(text, raw);
  }
  // R8: precise hit first (subtype passthrough), suffix heuristic only as a
  // fallback for legacy turns without a subtype. When neither is present the
  // turn degrades gracefully to `plain` full-text rendering.
  const isAwaySummary = turn.subtype === 'away_summary';
  const looksLikeLegacyRecap = !turn.subtype && RECAP_SUFFIX_PATTERN.test(text);
  if (isAwaySummary || looksLikeLegacyRecap) {
    return classifyRecap(text, raw);
  }
  return { kind: 'plain', summary: '', raw };
}
