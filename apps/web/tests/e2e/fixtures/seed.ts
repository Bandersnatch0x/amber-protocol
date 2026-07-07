import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

// A deterministic, valid UUIDv4-shaped id (gate-reader validates this shape).
// The trailing `e2e5` keeps it recognizable as the e2e fixture.
export const FIXTURE_SESSION_ID = '00000000-0000-4000-8000-00000000e2e5';
export const CONTROL_FIXTURE_SESSION_ID = '00000000-0000-4000-8000-00000000c07a';
export const FIXTURE_GATE_ID = 'e2e-approval-gate';

const FIXED_TS = '2026-06-20T00:00:00.000Z';
const GENESIS_HASH = '0'.repeat(64);

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

function hashRecord(record: Record<string, unknown>, prevHash: string): string {
  return crypto.createHash('sha256').update(prevHash + JSON.stringify(sortKeys(record))).digest('hex');
}

function writeLedger(sessionDir: string, records: Array<Record<string, unknown>>): void {
  let prevHash = GENESIS_HASH;
  const lines = records.map(record => {
    const body = {
      ...record,
      recordedAt: FIXED_TS,
      prevHash,
    };
    const full = {
      ...body,
      hash: hashRecord(body, prevHash),
    };
    prevHash = full.hash;
    return JSON.stringify(full);
  });
  fs.writeFileSync(path.join(sessionDir, 'ledger.jsonl'), `${lines.join('\n')}\n`);
}

function seedSession(repoRoot: string, sessionId: string, goal: string): void {
  const sessionDir = path.join(repoRoot, '.amber', 'sessions', sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const manifest = {
    id: sessionId,
    goal,
    status: 'executing',
    route: { id: 'feature-standard', name: 'Feature Standard' },
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
    budget: { maxTokens: 100000, tokensUsed: 1234 },
  };
  fs.writeFileSync(
    path.join(sessionDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  const requestId = `${sessionId.slice(-4)}-runner-request`;
  const events = [
    { type: 'session_created', timestamp: FIXED_TS, data: { sessionId, goal: manifest.goal } },
    { type: 'session_started', timestamp: FIXED_TS, data: { sessionId } },
    {
      type: 'runner_control_requested',
      timestamp: FIXED_TS,
      data: { sessionId, requestId, action: 'start', requestedStatus: 'executing', source: 'fixture' },
    },
    {
      type: 'runner_ack',
      timestamp: FIXED_TS,
      data: {
        sessionId,
        requestId,
        action: 'start',
        requestedStatus: 'executing',
        runnerStatus: 'acked',
        source: 'fixture-runner',
        message: 'fixture ACK',
      },
    },
    { type: 'task_progress', timestamp: FIXED_TS, data: { task: 'fixture progress', progress: 25 } },
  ];
  fs.writeFileSync(
    path.join(sessionDir, 'timeline.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
  );

  writeLedger(sessionDir, [
    {
      schemaVersion: 2,
      kind: 'runner_control_requested',
      sessionId,
      requestId,
      action: 'start',
      requestedStatus: 'executing',
      source: 'fixture',
      status: 'executing',
    },
    {
      schemaVersion: 2,
      kind: 'runner_ack',
      sessionId,
      requestId,
      action: 'start',
      requestedStatus: 'executing',
      runnerStatus: 'acked',
      source: 'fixture-runner',
      status: 'executing',
      message: 'fixture ACK',
    },
  ]);
}

/**
 * Write a minimal but reader-valid Amber session under `<repoRoot>/.amber/sessions`
 * so the web viewer's session/timeline/gate pages have real data to render during
 * e2e. Mirrors the shapes consumed by server/lib/session-reader.ts and
 * server/lib/gate-reader.ts. Idempotent: overwrites any existing fixture.
 */
export function seedFixtureSession(repoRoot: string): void {
  seedSession(repoRoot, FIXTURE_SESSION_ID, 'E2E fixture session');
  seedSession(repoRoot, CONTROL_FIXTURE_SESSION_ID, 'E2E control fixture session');

  const sessionDir = path.join(repoRoot, '.amber', 'sessions', FIXTURE_SESSION_ID);
  const gatesDir = path.join(sessionDir, 'gates');
  fs.mkdirSync(gatesDir, { recursive: true });

  const gate = {
    gateId: FIXTURE_GATE_ID,
    sessionId: FIXTURE_SESSION_ID,
    type: 'user-approval',
    stage: 'implement',
    description: 'E2E fixture gate awaiting approval',
    triggeredAt: FIXED_TS,
  };
  fs.writeFileSync(
    path.join(gatesDir, `${FIXTURE_GATE_ID}.gate.json`),
    JSON.stringify(gate, null, 2),
  );

  const gateEvent = {
    type: 'gate_triggered',
    timestamp: FIXED_TS,
    data: { sessionId: FIXTURE_SESSION_ID, gateId: FIXTURE_GATE_ID },
  };
  fs.appendFileSync(path.join(sessionDir, 'timeline.jsonl'), `${JSON.stringify(gateEvent)}\n`);
  writeLedger(sessionDir, [
    {
      schemaVersion: 2,
      kind: 'gate_triggered',
      sessionId: FIXTURE_SESSION_ID,
      gateId: FIXTURE_GATE_ID,
      status: 'pending',
    },
    {
      schemaVersion: 2,
      kind: 'runner_control_requested',
      sessionId: FIXTURE_SESSION_ID,
      requestId: `${FIXTURE_SESSION_ID.slice(-4)}-runner-request`,
      action: 'start',
      requestedStatus: 'executing',
      source: 'fixture',
      status: 'executing',
    },
    {
      schemaVersion: 2,
      kind: 'runner_ack',
      sessionId: FIXTURE_SESSION_ID,
      requestId: `${FIXTURE_SESSION_ID.slice(-4)}-runner-request`,
      action: 'start',
      requestedStatus: 'executing',
      runnerStatus: 'acked',
      source: 'fixture-runner',
      status: 'executing',
      message: 'fixture ACK',
    },
  ]);
}

/** Remove the fixture session (and only it) — never touches sibling sessions. */
export function removeFixtureSession(repoRoot: string): void {
  for (const sessionId of [FIXTURE_SESSION_ID, CONTROL_FIXTURE_SESSION_ID]) {
    const sessionDir = path.join(repoRoot, '.amber', 'sessions', sessionId);
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
}
