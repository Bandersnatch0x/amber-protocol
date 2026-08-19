import { classifyTurn } from './transcript-denoise';

export interface TranscriptListItem {
  id: string;
  gitBranch?: string;
  outline?: string;
  repoPath?: string;
  sourceDirectory?: string;
  sourceFile?: string;
  turnCount: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

export interface TranscriptTurnLike {
  type: string;
  role?: string;
  text?: string;
  tools?: string[];
  timestamp?: string;
  /** Optional additive passthrough from the server reader (Claude JSONL). */
  subtype?: string;
  isMeta?: boolean;
}

export interface TranscriptMetadataItem {
  label: string;
  summaryLabel: string;
  description: string;
  timestamp?: string;
}

export interface TranscriptDisplayModel<T extends TranscriptTurnLike> {
  visibleTurns: T[];
  metadata: TranscriptMetadataItem[];
}

export function filterTranscripts(
  transcripts: TranscriptListItem[] | undefined,
  searchQuery: string,
): TranscriptListItem[] {
  if (!transcripts) return [];
  const query = searchQuery.trim().toLowerCase();
  if (!query) return transcripts;

  return transcripts.filter(
    (transcript) =>
      transcript.id.toLowerCase().includes(query) ||
      (transcript.gitBranch ?? '').toLowerCase().includes(query) ||
      (transcript.outline ?? '').toLowerCase().includes(query) ||
      (transcript.repoPath ?? '').toLowerCase().includes(query) ||
      (transcript.sourceDirectory ?? '').toLowerCase().includes(query),
  );
}

export function getTurnRoleLabel(turn: TranscriptTurnLike): string {
  return turn.role ?? turn.type;
}

const METADATA_TYPES = new Set([
  'attachment',
  'file-history-snapshot',
  'last-prompt',
  'mode',
  'permission-mode',
  'queue-operation',
  'summary',
]);

const ROLE_LABELS: Record<string, string> = {
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
  user: 'User',
};

const TYPE_LABELS: Record<string, string> = {
  attachment: 'Attachment',
  'file-history-snapshot': 'File history snapshot',
  'last-prompt': 'Last prompt state',
  mode: 'Mode metadata',
  'permission-mode': 'Permission mode',
  'queue-operation': 'Queue operation',
  summary: 'Summary metadata',
};

const METADATA_DETAILS: Record<string, Omit<TranscriptMetadataItem, 'timestamp'>> = {
  assistant: {
    label: 'Empty assistant record',
    summaryLabel: 'empty assistant records',
    description: 'A message envelope with no rendered assistant text or tool call.',
  },
  attachment: {
    label: 'Attachment record',
    summaryLabel: 'attachment records',
    description: 'File or image attachment metadata captured with the prompt.',
  },
  'file-history-snapshot': {
    label: 'File history snapshot',
    summaryLabel: 'file history snapshots',
    description: 'Repository file-state snapshot recorded for context continuity.',
  },
  'last-prompt': {
    label: 'Prompt snapshot',
    summaryLabel: 'prompt snapshots',
    description: 'Internal state for the latest prompt, hidden from the readable transcript.',
  },
  localCommand: {
    label: 'Local command record',
    summaryLabel: 'local command records',
    description: 'Slash-command caveat envelope hidden from the readable transcript.',
  },
  mode: {
    label: 'Session mode record',
    summaryLabel: 'session mode records',
    description: 'Runtime mode information recorded by the client.',
  },
  'permission-mode': {
    label: 'Permission record',
    summaryLabel: 'permission records',
    description: 'Tool approval policy state captured during the session.',
  },
  'queue-operation': {
    label: 'Queue operation record',
    summaryLabel: 'queue operation records',
    description: 'Internal queue state used to coordinate session work.',
  },
  summary: {
    label: 'Summary record',
    summaryLabel: 'summary records',
    description: 'Stored conversation summary used for context continuity.',
  },
  systemReminder: {
    label: 'System reminder record',
    summaryLabel: 'system reminder records',
    description: 'Injected system reminder envelope hidden from the readable transcript.',
  },
  system: {
    label: 'Empty system record',
    summaryLabel: 'empty system records',
    description: 'A system message envelope with no readable transcript text.',
  },
  user: {
    label: 'Empty user record',
    summaryLabel: 'empty user records',
    description: 'A user message envelope with no rendered prompt text.',
  },
};

const TOOL_LABELS: Record<string, string> = {
  Bash: 'Run shell command',
  Edit: 'Edit file',
  Glob: 'Find files',
  Grep: 'Search text',
  LS: 'List directory',
  MultiEdit: 'Edit file',
  Read: 'Read file',
  TodoWrite: 'Update todo list',
  WebFetch: 'Fetch URL',
  Write: 'Write file',
};

function hasText(turn: TranscriptTurnLike): boolean {
  return Boolean(turn.text?.trim());
}

function hasTools(turn: TranscriptTurnLike): boolean {
  return Boolean(turn.tools?.length);
}

export function isMetadataOnlyTurn(turn: TranscriptTurnLike): boolean {
  if (hasText(turn) || hasTools(turn)) return false;
  const label = getTurnRoleLabel(turn);
  return (
    METADATA_TYPES.has(label) || label === 'assistant' || label === 'user' || label === 'system'
  );
}

export function getTurnDisplayLabel(turn: TranscriptTurnLike): string {
  const label = getTurnRoleLabel(turn);
  return ROLE_LABELS[label] ?? TYPE_LABELS[label] ?? label;
}

export function getToolDisplayLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool;
}

function getMetadataDetails(turn: TranscriptTurnLike): Omit<TranscriptMetadataItem, 'timestamp'> {
  const label = getTurnRoleLabel(turn);
  return (
    METADATA_DETAILS[label] ?? {
      label: getTurnDisplayLabel(turn),
      summaryLabel: `${getTurnDisplayLabel(turn).toLowerCase()} records`,
      description: 'Low-level session record hidden from the readable transcript.',
    }
  );
}

export function isToolOnlyTurn(turn: TranscriptTurnLike): boolean {
  return !hasText(turn) && hasTools(turn);
}

export function buildTranscriptDisplayModel<T extends TranscriptTurnLike>(
  turns: T[],
): TranscriptDisplayModel<T> {
  const metadata: TranscriptMetadataItem[] = [];
  const visibleTurns: T[] = [];

  for (const turn of turns) {
    if (isMetadataOnlyTurn(turn)) {
      const details = getMetadataDetails(turn);
      metadata.push({
        ...details,
        timestamp: turn.timestamp,
      });
      continue;
    }

    // Denoise R1/R6: whole-message caveat/system-reminder wrappers are hidden
    // from the timeline and counted in the MetadataPanel instead.
    const denoise = classifyTurn(turn);
    if (denoise.kind === 'hidden' && denoise.hiddenGroup) {
      metadata.push({
        ...METADATA_DETAILS[denoise.hiddenGroup],
        timestamp: turn.timestamp,
      });
      continue;
    }

    visibleTurns.push(turn);
  }

  return { visibleTurns, metadata };
}
