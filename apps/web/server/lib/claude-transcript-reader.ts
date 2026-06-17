/**
 * Read-only reader for Claude Code session transcripts that belong to the
 * current repository. Transcripts live as JSONL under
 * `~/.claude/projects/<encoded-repo-path>/<sessionId>.jsonl`.
 *
 * This is the data layer for Session Lens (repo-local session observability).
 * It is deliberately read-only and repo-scoped, and it redacts secrets by
 * default before any text leaves this module.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { redactSecrets } from './redaction';

export interface TranscriptTurn {
  type: string;
  role?: string;
  text: string;
  tools: string[];
  timestamp?: string;
}

export interface TranscriptSummary {
  id: string;
  turnCount: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  gitBranch?: string;
}

export interface TranscriptDetail extends TranscriptSummary {
  turns: TranscriptTurn[];
}

export interface TranscriptFailure {
  tool: string;
  input: string;
  error: string;
  timestamp?: string;
}

interface ParseOptions {
  limit?: number;
  redact?: boolean;
}

interface RepoOptions {
  claudeHome?: string;
}

type ReadOptions = RepoOptions & ParseOptions;

// Claude Code names each project's transcript directory by replacing every
// non-alphanumeric character in the absolute repo path with a dash. Verified
// against this repo: D:\code_space\coding-harness -> D--code-space-coding-harness.
export function encodeProjectPath(repoPath: string): string {
  return repoPath.replace(/[^a-zA-Z0-9]/g, '-');
}

export function resolveClaudeProjectsDir(claudeHome: string = os.homedir()): string {
  return path.join(claudeHome, '.claude', 'projects');
}

function extractTextAndTools(content: unknown): { text: string; tools: string[] } {
  if (typeof content === 'string') {
    return { text: content, tools: [] };
  }
  if (!Array.isArray(content)) {
    return { text: '', tools: [] };
  }

  const texts: string[] = [];
  const tools: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) {
      continue;
    }
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      texts.push(b.text);
    } else if (b.type === 'tool_use' && typeof b.name === 'string') {
      tools.push(b.name);
    } else if (b.type === 'tool_result') {
      const c = b.content;
      if (typeof c === 'string') {
        texts.push(c);
      } else if (Array.isArray(c)) {
        for (const inner of c) {
          if (inner && typeof inner === 'object') {
            const t = (inner as Record<string, unknown>).text;
            if (typeof t === 'string') {
              texts.push(t);
            }
          }
        }
      }
    }
  }
  return { text: texts.join('\n'), tools };
}

function normalizeTurn(raw: unknown, redact: boolean): TranscriptTurn | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const message =
    obj.message && typeof obj.message === 'object'
      ? (obj.message as Record<string, unknown>)
      : {};
  const { text, tools } = extractTextAndTools(message.content);
  const role = typeof message.role === 'string' ? message.role : undefined;
  const type = typeof obj.type === 'string' ? obj.type : role ?? 'unknown';

  return {
    type,
    role,
    text: redact ? redactSecrets(text) : text,
    tools,
    timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : undefined,
  };
}

export function parseTranscript(content: string, opts: ParseOptions = {}): TranscriptTurn[] {
  const redact = opts.redact !== false; // safe default: redact
  const turns: TranscriptTurn[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines instead of failing the whole read
    }
    const turn = normalizeTurn(parsed, redact);
    if (turn) {
      turns.push(turn);
    }
    if (opts.limit && turns.length >= opts.limit) {
      break;
    }
  }
  return turns;
}

interface PendingCall {
  tool: string;
  input: string;
  timestamp?: string;
}

function resultErrorText(block: Record<string, unknown>): string {
  const content = block.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const inner of content) {
      if (inner && typeof inner === 'object') {
        const t = (inner as Record<string, unknown>).text;
        if (typeof t === 'string') {
          parts.push(t);
        }
      }
    }
    return parts.join('\n');
  }
  return '';
}

// Extract failed tool calls by linking tool_use (id, name, input) to a later
// tool_result with the same tool_use_id and is_error true. This is the trace
// source for failure-to-regression proposals.
export function extractFailures(content: string, opts: ParseOptions = {}): TranscriptFailure[] {
  const redact = opts.redact !== false;
  const calls = new Map<string, PendingCall>();
  const failures: TranscriptFailure[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const message =
      parsed.message && typeof parsed.message === 'object'
        ? (parsed.message as Record<string, unknown>)
        : {};
    const blocks = Array.isArray(message.content) ? message.content : [];
    const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined;

    for (const raw of blocks) {
      if (typeof raw !== 'object' || raw === null) {
        continue;
      }
      const block = raw as Record<string, unknown>;

      if (block.type === 'tool_use' && typeof block.id === 'string') {
        calls.set(block.id, {
          tool: typeof block.name === 'string' ? block.name : 'unknown',
          input: block.input !== undefined ? JSON.stringify(block.input) : '',
          timestamp,
        });
      } else if (
        block.type === 'tool_result' &&
        block.is_error === true &&
        typeof block.tool_use_id === 'string'
      ) {
        const call = calls.get(block.tool_use_id);
        const errorText = resultErrorText(block);
        failures.push({
          tool: call ? call.tool : 'unknown',
          input: redact ? redactSecrets(call ? call.input : '') : call ? call.input : '',
          error: redact ? redactSecrets(errorText) : errorText,
          timestamp: timestamp ?? call?.timestamp,
        });
      }
    }
  }

  return failures;
}

function readTextFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function findGitBranch(content: string): string | undefined {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj && typeof obj.gitBranch === 'string') {
        return obj.gitBranch;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

function summarize(id: string, content: string): TranscriptSummary {
  const turns = parseTranscript(content, { redact: false });
  const timestamps = turns
    .map((t) => t.timestamp)
    .filter((t): t is string => typeof t === 'string');

  return {
    id,
    turnCount: turns.length,
    firstTimestamp: timestamps[0],
    lastTimestamp: timestamps[timestamps.length - 1],
    gitBranch: findGitBranch(content),
  };
}

function repoTranscriptDir(repoPath: string, claudeHome?: string): string {
  return path.join(resolveClaudeProjectsDir(claudeHome), encodeProjectPath(repoPath));
}

export function listRepoTranscripts(repoPath: string, opts: RepoOptions = {}): TranscriptSummary[] {
  const dir = repoTranscriptDir(repoPath, opts.claudeHome);
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith('.jsonl'))
    .map((file) => {
      const content = readTextFile(path.join(dir, file));
      if (content === null) {
        return null;
      }
      return summarize(file.replace(/\.jsonl$/i, ''), content);
    })
    .filter((s): s is TranscriptSummary => s !== null)
    .sort((a, b) => (b.lastTimestamp ?? '').localeCompare(a.lastTimestamp ?? ''));
}

export function readRepoTranscript(
  repoPath: string,
  transcriptId: string,
  opts: ReadOptions = {},
): TranscriptDetail | null {
  // Reject path traversal: transcript ids are session uuids / safe filenames.
  if (!/^[A-Za-z0-9._-]+$/.test(transcriptId)) {
    return null;
  }

  const filePath = path.join(repoTranscriptDir(repoPath, opts.claudeHome), `${transcriptId}.jsonl`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = readTextFile(filePath);
  if (content === null) {
    return null;
  }

  const turns = parseTranscript(content, { redact: opts.redact !== false, limit: opts.limit });
  return { ...summarize(transcriptId, content), turns };
}
