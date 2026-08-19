import crypto from 'crypto';
import fsp from 'fs/promises';
import path from 'path';
import { resolveStatePath } from './artifact-store';
import { resolveWithin } from './safe-path';

const GENESIS_HASH = '0'.repeat(64);

export interface SessionAuditRecordSummary {
  kind: string;
  gateId?: string;
  recordedAt?: string;
  hash?: string;
  prevHash?: string;
}

export interface SessionAuditEventSummary {
  type: string;
  gateId?: string;
  timestamp?: string;
}

export interface SessionAuditSummary {
  sessionId: string;
  gateId?: string;
  ledger: {
    path: string;
    exists: boolean;
    verified: boolean;
    recordCount: number;
    latest?: SessionAuditRecordSummary;
    latestForGate?: SessionAuditRecordSummary;
    error?: string;
  };
  timeline: {
    path: string;
    exists: boolean;
    eventCount: number;
    latest?: SessionAuditEventSummary;
    latestForGate?: SessionAuditEventSummary;
    error?: string;
  };
}

function getSessionDir(sessionId: string): string {
  const sessionsDir = resolveStatePath('sessions');
  const sessionDir = sessionsDir ? resolveWithin(sessionsDir, sessionId) : null;
  if (!sessionDir) {
    throw new Error('Session not found');
  }
  return sessionDir;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        if (key !== 'hash') {
          acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        }
        return acc;
      }, {});
  }
  return value;
}

function canonicalize(record: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(record));
}

function hashRecord(record: Record<string, unknown>, prevHash: string): string {
  return crypto
    .createHash('sha256')
    .update(prevHash + canonicalize(record))
    .digest('hex');
}

async function readLastLedgerHash(ledgerPath: string): Promise<string> {
  try {
    const content = await fsp.readFile(ledgerPath, 'utf8');
    const lastLine = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    if (!lastLine) return GENESIS_HASH;
    const lastRecord = JSON.parse(lastLine) as Record<string, unknown>;
    return typeof lastRecord.hash === 'string' ? lastRecord.hash : GENESIS_HASH;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return GENESIS_HASH;
    throw error;
  }
}

function relativeStatePath(sessionId: string, fileName: string): string {
  return `.amber/sessions/${sessionId}/${fileName}`;
}

function getGateId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.gateId === 'string') return record.gateId;
  const data = record.data;
  if (
    data &&
    typeof data === 'object' &&
    typeof (data as Record<string, unknown>).gateId === 'string'
  ) {
    return (data as Record<string, unknown>).gateId as string;
  }
  return undefined;
}

function summarizeLedgerRecord(record: Record<string, unknown>): SessionAuditRecordSummary {
  return {
    kind: typeof record.kind === 'string' ? record.kind : 'unknown',
    gateId: getGateId(record),
    recordedAt: typeof record.recordedAt === 'string' ? record.recordedAt : undefined,
    hash: typeof record.hash === 'string' ? record.hash : undefined,
    prevHash: typeof record.prevHash === 'string' ? record.prevHash : undefined,
  };
}

function summarizeTimelineEvent(event: Record<string, unknown>): SessionAuditEventSummary {
  return {
    type: typeof event.type === 'string' ? event.type : 'unknown',
    gateId: getGateId(event),
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined,
  };
}

async function readLedgerSummary(
  sessionId: string,
  ledgerPath: string,
  gateId?: string,
): Promise<SessionAuditSummary['ledger']> {
  const base = {
    path: relativeStatePath(sessionId, 'ledger.jsonl'),
    exists: false,
    verified: true,
    recordCount: 0,
  };

  let content: string;
  try {
    content = await fsp.readFile(ledgerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return base;
    return {
      ...base,
      verified: false,
      error: error instanceof Error ? error.message : 'Unable to read ledger',
    };
  }

  let expectedPrevHash = GENESIS_HASH;
  let latest: SessionAuditRecordSummary | undefined;
  let latestForGate: SessionAuditRecordSummary | undefined;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (error) {
      return {
        ...base,
        exists: true,
        verified: false,
        recordCount: base.recordCount,
        latest,
        latestForGate,
        error: error instanceof Error ? error.message : 'Ledger contains invalid JSON',
      };
    }

    base.recordCount += 1;
    const summary = summarizeLedgerRecord(record);
    latest = summary;
    if (gateId && summary.gateId === gateId) latestForGate = summary;

    const storedHash = typeof record.hash === 'string' ? record.hash : undefined;
    const storedPrevHash = typeof record.prevHash === 'string' ? record.prevHash : undefined;
    const computedHash = hashRecord(record, expectedPrevHash);
    if (!storedHash || storedPrevHash !== expectedPrevHash || storedHash !== computedHash) {
      return {
        ...base,
        exists: true,
        verified: false,
        latest,
        latestForGate,
        error: 'Ledger hash chain verification failed',
      };
    }
    expectedPrevHash = storedHash;
  }

  return {
    ...base,
    exists: true,
    latest,
    latestForGate,
  };
}

async function readTimelineSummary(
  sessionId: string,
  timelinePath: string,
  gateId?: string,
): Promise<SessionAuditSummary['timeline']> {
  const base = {
    path: relativeStatePath(sessionId, 'timeline.jsonl'),
    exists: false,
    eventCount: 0,
  };

  let content: string;
  try {
    content = await fsp.readFile(timelinePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return base;
    return {
      ...base,
      error: error instanceof Error ? error.message : 'Unable to read timeline',
    };
  }

  let latest: SessionAuditEventSummary | undefined;
  let latestForGate: SessionAuditEventSummary | undefined;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (error) {
      return {
        ...base,
        exists: true,
        eventCount: base.eventCount,
        latest,
        latestForGate,
        error: error instanceof Error ? error.message : 'Timeline contains invalid JSON',
      };
    }

    base.eventCount += 1;
    const summary = summarizeTimelineEvent(event);
    latest = summary;
    if (gateId && summary.gateId === gateId) latestForGate = summary;
  }

  return {
    ...base,
    exists: true,
    latest,
    latestForGate,
  };
}

export async function appendSessionTimelineEvent(
  sessionId: string,
  event: { type: string; data?: Record<string, unknown> },
): Promise<void> {
  const sessionDir = getSessionDir(sessionId);
  const line = `${JSON.stringify({
    ...event,
    timestamp: new Date().toISOString(),
  })}\n`;
  await fsp.appendFile(path.join(sessionDir, 'timeline.jsonl'), line, 'utf8');
}

export async function appendSessionLedgerRecord(
  sessionId: string,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionDir = getSessionDir(sessionId);
  const ledgerPath = path.join(sessionDir, 'ledger.jsonl');
  const prevHash = await readLastLedgerHash(ledgerPath);
  const body = {
    ...record,
    recordedAt: new Date().toISOString(),
    prevHash,
  };
  const full = {
    ...body,
    hash: hashRecord(body, prevHash),
  };
  await fsp.appendFile(ledgerPath, `${JSON.stringify(full)}\n`, 'utf8');
  return full;
}

export async function readSessionAuditSummary(
  sessionId: string,
  gateId?: string,
): Promise<SessionAuditSummary> {
  const sessionDir = getSessionDir(sessionId);
  const [ledger, timeline] = await Promise.all([
    readLedgerSummary(sessionId, path.join(sessionDir, 'ledger.jsonl'), gateId),
    readTimelineSummary(sessionId, path.join(sessionDir, 'timeline.jsonl'), gateId),
  ]);

  return {
    sessionId,
    gateId,
    ledger,
    timeline,
  };
}
