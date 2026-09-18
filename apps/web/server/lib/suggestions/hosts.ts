import fs from 'fs';
import path from 'path';
import {
  encodeProjectPath,
  extractFailures,
  listRepoTranscripts,
} from '../claude-transcript-reader';
import { excerptOf, frictionFingerprint, safeToolName } from './fingerprint';
import { HOST_FILE_CEILING, cursorWorkspaceHash, isRepoScoped } from './paths';
import type { FrictionSignal, HostId, SuggestionHomes } from './types';

const CODEX_ROLLOUT_RE = /^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-fA-F-]{36})\.jsonl$/;

function readText(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function parseJsonl(content: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as unknown;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        rows.push(value as Record<string, unknown>);
      }
    } catch {
      continue;
    }
  }
  return rows;
}

function newestFiles(dir: string, match: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: { abs: string; mtime: number }[] = [];
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && match(entry.name)) {
        try {
          found.push({ abs, mtime: fs.statSync(abs).mtimeMs });
        } catch {
          continue;
        }
      }
    }
  };
  walk(dir);
  found.sort((a, b) => b.mtime - a.mtime);
  return found.slice(0, HOST_FILE_CEILING).map((item) => item.abs);
}

function signalFromFailure(
  host: HostId,
  transcriptId: string,
  tool: string,
  error: string,
  timestamp?: string,
  sourceFile?: string,
): FrictionSignal {
  const safeTool = safeToolName(tool);
  return {
    host,
    transcriptId,
    tool: safeTool,
    error,
    excerpt: excerptOf(error),
    timestamp,
    fingerprint: frictionFingerprint(safeTool, error),
    // The owning source of the V1 evidence reference (evolution contract
    // §6) — never rendered or persisted on the card itself.
    sourceFile: sourceFile ?? '',
  };
}

// Codex rollouts do not always carry an explicit `success` flag, so the string
// form needs a fallback. Matching a bare "error" anywhere would score a
// successful `grep -n error file` or a "0 errors" test summary as friction, and
// two such transcripts are enough to promote a bogus card.
// ponytail: line-anchored markers only. If real failures still slip through,
// the upgrade path is a per-host exit-code field rather than a looser regex.
const FAILURE_MARKERS = [
  /^\s*(?:error|fatal|traceback|exception)\b/im,
  /^\s*[A-Z][A-Za-z]*Error\b/m,
  /\bE[A-Z]{3,}\b/,
  /\bexit(?:ed)?(?:\s+(?:with\s+)?(?:status|code))?\s+(?!0\b)\d+/i,
  /\bcommand not found\b/i,
  /\bpermission denied\b/i,
];

function outputLooksFailed(output: unknown, success: unknown): boolean {
  if (success === false) return true;
  if (success === true) return false;
  if (typeof output !== 'string') return false;
  return FAILURE_MARKERS.some((pattern) => pattern.test(output));
}

export function collectClaudeSignals(
  repoRoot: string,
  claudeHome?: string,
): { signals: FrictionSignal[]; transcriptsScanned: number } {
  const summaries = listRepoTranscripts(repoRoot, { claudeHome });
  const scanned = summaries.slice(0, HOST_FILE_CEILING);
  const signals: FrictionSignal[] = [];
  for (const summary of scanned) {
    const content = readText(summary.sourceFile);
    if (content === null) continue;
    for (const failure of extractFailures(content, { redact: false })) {
      signals.push(
        signalFromFailure(
          'claude',
          summary.id,
          failure.tool,
          failure.error,
          failure.timestamp,
          summary.sourceFile,
        ),
      );
    }
  }
  return { signals, transcriptsScanned: scanned.length };
}

function collectCodexSignals(
  repoRoot: string,
  codexHome: string,
): { signals: FrictionSignal[]; transcriptsScanned: number } {
  const sessionsDir = path.join(codexHome, 'sessions');
  const files = newestFiles(sessionsDir, (name) => CODEX_ROLLOUT_RE.test(name));
  const signals: FrictionSignal[] = [];
  // The exposure denominator is the window the collector read — every file it
  // opened, including the ones that turned out to belong to another repo or
  // held no failure. Counting only failing transcripts would make the rate a
  // function of the numerator.
  let transcriptsScanned = 0;

  for (const filePath of files) {
    const content = readText(filePath);
    if (content === null) continue;
    transcriptsScanned += 1;
    const records = parseJsonl(content);
    const meta = records.find((row) => row.type === 'session_meta');
    const payload =
      meta && meta.payload && typeof meta.payload === 'object'
        ? (meta.payload as Record<string, unknown>)
        : {};
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : undefined;
    if (!isRepoScoped(cwd, repoRoot)) continue;

    const match = CODEX_ROLLOUT_RE.exec(path.basename(filePath));
    const transcriptId =
      (typeof payload.id === 'string' && payload.id) || match?.[1] || path.basename(filePath);

    const pending = new Map<string, { tool: string; timestamp?: string }>();
    for (const record of records) {
      const item =
        record.type === 'response_item' && record.payload && typeof record.payload === 'object'
          ? (record.payload as Record<string, unknown>)
          : record;
      const timestamp = typeof record.timestamp === 'string' ? record.timestamp : undefined;
      const itemType = item.type;
      if (
        itemType === 'function_call' ||
        itemType === 'local_shell_call' ||
        itemType === 'custom_tool_call'
      ) {
        const id =
          typeof item.call_id === 'string'
            ? item.call_id
            : typeof item.id === 'string'
              ? item.id
              : '';
        const tool =
          itemType === 'local_shell_call'
            ? 'local_shell'
            : typeof item.name === 'string'
              ? item.name
              : 'function';
        if (id) pending.set(id, { tool, timestamp });
      } else if (itemType === 'function_call_output' || itemType === 'custom_tool_call_output') {
        const id =
          typeof item.call_id === 'string'
            ? item.call_id
            : typeof item.id === 'string'
              ? item.id
              : '';
        const call = id ? pending.get(id) : undefined;
        let output: unknown = item.output;
        if (output && typeof output === 'object') {
          const body = output as Record<string, unknown>;
          output = body.body ?? body.text ?? output;
        }
        if (outputLooksFailed(output, item.success)) {
          const error = typeof output === 'string' ? output : JSON.stringify(output ?? 'failed');
          signals.push(
            signalFromFailure(
              'codex',
              transcriptId,
              call?.tool ?? 'function',
              error,
              timestamp ?? call?.timestamp,
              filePath,
            ),
          );
        }
      }
    }
  }
  return { signals, transcriptsScanned };
}

function collectCursorSignals(
  repoRoot: string,
  cursorHome: string,
): { signals: FrictionSignal[]; transcriptsScanned: number } {
  const encoded = encodeProjectPath(repoRoot);
  const hashed = cursorWorkspaceHash(repoRoot);
  const roots = [
    path.join(cursorHome, 'chats', hashed),
    path.join(cursorHome, 'projects', encoded, 'agent-transcripts'),
  ];
  const files = roots.flatMap((root) => newestFiles(root, (name) => name.endsWith('.jsonl')));
  const signals: FrictionSignal[] = [];
  // Same denominator rule as Codex: every read file counts, failing or not.
  let transcriptsScanned = 0;

  for (const filePath of files) {
    const content = readText(filePath);
    if (content === null) continue;
    transcriptsScanned += 1;
    const records = parseJsonl(content);
    const transcriptId = path.basename(filePath, '.jsonl');
    const pending = new Map<string, { tool: string; timestamp?: string }>();

    for (const record of records) {
      const timestamp = typeof record.timestamp === 'string' ? record.timestamp : undefined;
      const message =
        record.message && typeof record.message === 'object'
          ? (record.message as Record<string, unknown>)
          : record;
      const blocks = Array.isArray(message.content)
        ? message.content
        : Array.isArray(record.content)
          ? record.content
          : [];

      for (const raw of blocks) {
        if (!raw || typeof raw !== 'object') continue;
        const block = raw as Record<string, unknown>;
        if (
          (block.type === 'tool_use' || block.type === 'tool_call') &&
          typeof block.id === 'string'
        ) {
          pending.set(block.id, {
            tool: typeof block.name === 'string' ? block.name : 'unknown',
            timestamp,
          });
        } else if (
          (block.type === 'tool_result' || block.type === 'tool_output') &&
          block.is_error === true
        ) {
          const id =
            typeof block.tool_use_id === 'string'
              ? block.tool_use_id
              : typeof block.call_id === 'string'
                ? block.call_id
                : '';
          const call = id ? pending.get(id) : undefined;
          const error =
            typeof block.content === 'string'
              ? block.content
              : typeof block.text === 'string'
                ? block.text
                : 'tool error';
          signals.push(
            signalFromFailure(
              'cursor',
              transcriptId,
              call?.tool ?? 'unknown',
              error,
              timestamp,
              filePath,
            ),
          );
        }
      }

      if (record.role === 'tool' && record.is_error === true) {
        const id =
          typeof record.tool_call_id === 'string'
            ? record.tool_call_id
            : typeof record.call_id === 'string'
              ? record.call_id
              : '';
        const call = id ? pending.get(id) : undefined;
        const error = typeof record.content === 'string' ? record.content : 'tool error';
        signals.push(
          signalFromFailure('cursor', transcriptId, call?.tool ?? 'unknown', error, timestamp, filePath),
        );
      }
    }
  }
  return { signals, transcriptsScanned };
}

export function collectHostSignals(
  repoRoot: string,
  homes: SuggestionHomes,
): {
  signals: FrictionSignal[];
  scanned: { host: HostId; transcripts: number }[];
  transcriptsScanned: number;
} {
  const claude = collectClaudeSignals(repoRoot, homes.claudeHome);
  const codex = homes.codexHome
    ? collectCodexSignals(repoRoot, homes.codexHome)
    : { signals: [], transcriptsScanned: 0 };
  const cursor = homes.cursorHome
    ? collectCursorSignals(repoRoot, homes.cursorHome)
    : { signals: [], transcriptsScanned: 0 };

  const count = (host: HostId, list: FrictionSignal[]) => ({
    host,
    transcripts: new Set(list.map((item) => item.transcriptId)).size,
  });

  return {
    signals: [...claude.signals, ...codex.signals, ...cursor.signals],
    scanned: [
      count('claude', claude.signals),
      count('codex', codex.signals),
      count('cursor', cursor.signals),
    ],
    // The recurrence exposure denominator (contract §9): the transcripts the
    // scan actually read across the declared window — the same window the
    // signals above came from.
    transcriptsScanned:
      claude.transcriptsScanned + codex.transcriptsScanned + cursor.transcriptsScanned,
  };
}
