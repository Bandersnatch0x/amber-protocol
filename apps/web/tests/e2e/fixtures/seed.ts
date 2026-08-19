import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

// A deterministic, valid UUIDv4-shaped id (gate-reader validates this shape).
// The trailing `e2e5` keeps it recognizable as the e2e fixture.
export const FIXTURE_SESSION_ID = '00000000-0000-4000-8000-00000000e2e5';
export const CONTROL_FIXTURE_SESSION_ID = '00000000-0000-4000-8000-00000000c07a';
export const FIXTURE_GATE_ID = 'e2e-approval-gate';

// Consumable seeds: gate decisions (approve/reject) append records to the
// owning session's ledger/timeline, so consuming tests must never touch the
// baseline session — each consumable gate is bound to its own dedicated
// session id so the baseline evidence (runner_ack etc.) stays pristine.
export const APPROVE_CONSUMABLE_SESSION_ID = '00000000-0000-4000-8000-00000000e2a1';
export const REJECT_CONSUMABLE_SESSION_ID = '00000000-0000-4000-8000-00000000e2b2';
export const COMPLETED_FIXTURE_SESSION_ID = '00000000-0000-4000-8000-00000000c0mp';
export const APPROVE_CONSUMABLE_GATE_ID = 'e2e-approve-consumable-gate';
export const REJECT_CONSUMABLE_GATE_ID = 'e2e-reject-consumable-gate';

const FIXED_TS = '2026-06-20T00:00:00.000Z';
// Activity window end for seeded manifests (task #34): later than the fixture
// transcript's last timestamp (00:20:20Z) so the inferred transcript↔session
// association finds a non-degenerate overlap against the transcript fixture.
const FIXED_LAST_ACTIVITY = '2026-06-20T01:00:00.000Z';
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
  return crypto
    .createHash('sha256')
    .update(prevHash + JSON.stringify(sortKeys(record)))
    .digest('hex');
}

function writeLedger(sessionDir: string, records: Array<Record<string, unknown>>): void {
  let prevHash = GENESIS_HASH;
  const lines = records.map((record) => {
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

function seedSession(
  repoRoot: string,
  sessionId: string,
  goal: string,
  status = 'executing',
): void {
  const sessionDir = path.join(repoRoot, '.amber', 'sessions', sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const manifest = {
    id: sessionId,
    goal,
    status,
    route: { id: 'feature-standard', name: 'Feature Standard' },
    createdAt: FIXED_TS,
    updatedAt: FIXED_LAST_ACTIVITY,
    budget: { maxTokens: 100000, tokensUsed: 1234 },
  };
  fs.writeFileSync(path.join(sessionDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const requestId = `${sessionId.slice(-4)}-runner-request`;
  const events = [
    { type: 'session_created', timestamp: FIXED_TS, data: { sessionId, goal: manifest.goal } },
    { type: 'session_started', timestamp: FIXED_TS, data: { sessionId } },
    {
      type: 'runner_control_requested',
      timestamp: FIXED_TS,
      data: {
        sessionId,
        requestId,
        action: 'start',
        requestedStatus: 'executing',
        source: 'fixture',
      },
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
    {
      type: 'task_progress',
      timestamp: FIXED_TS,
      data: { task: 'fixture progress', progress: 25 },
    },
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
 * Attach a pending gate to an already-seeded session: gate file, a
 * gate_triggered timeline event, and a ledger rewritten with the gate record
 * ahead of the runner handshake records (mirrors the shapes read by
 * server/lib/gate-reader.ts and server/lib/session-audit-writer.ts).
 */
function seedPendingGate(
  repoRoot: string,
  sessionId: string,
  gateId: string,
  description: string,
): void {
  const sessionDir = path.join(repoRoot, '.amber', 'sessions', sessionId);
  const gatesDir = path.join(sessionDir, 'gates');
  fs.mkdirSync(gatesDir, { recursive: true });

  const gate = {
    gateId,
    sessionId,
    type: 'user-approval',
    stage: 'implement',
    description,
    triggeredAt: FIXED_TS,
  };
  fs.writeFileSync(path.join(gatesDir, `${gateId}.gate.json`), JSON.stringify(gate, null, 2));

  const gateEvent = {
    type: 'gate_triggered',
    timestamp: FIXED_TS,
    data: { sessionId, gateId },
  };
  fs.appendFileSync(path.join(sessionDir, 'timeline.jsonl'), `${JSON.stringify(gateEvent)}\n`);
  writeLedger(sessionDir, [
    {
      schemaVersion: 2,
      kind: 'gate_triggered',
      sessionId,
      gateId,
      status: 'pending',
    },
    {
      schemaVersion: 2,
      kind: 'runner_control_requested',
      sessionId,
      requestId: `${sessionId.slice(-4)}-runner-request`,
      action: 'start',
      requestedStatus: 'executing',
      source: 'fixture',
      status: 'executing',
    },
    {
      schemaVersion: 2,
      kind: 'runner_ack',
      sessionId,
      requestId: `${sessionId.slice(-4)}-runner-request`,
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
 *
 * Baseline sessions (FIXTURE_SESSION_ID, CONTROL_FIXTURE_SESSION_ID) must stay
 * pristine — consuming gate decisions are bound to the dedicated consumable
 * sessions seeded below them.
 */
export function seedFixtureSession(repoRoot: string): void {
  seedSession(repoRoot, FIXTURE_SESSION_ID, 'E2E fixture session');
  seedSession(repoRoot, CONTROL_FIXTURE_SESSION_ID, 'E2E control fixture session');
  seedPendingGate(
    repoRoot,
    FIXTURE_SESSION_ID,
    FIXTURE_GATE_ID,
    'E2E fixture gate awaiting approval',
  );

  seedSession(repoRoot, COMPLETED_FIXTURE_SESSION_ID, 'E2E completed fixture session', 'completed');

  seedSession(repoRoot, APPROVE_CONSUMABLE_SESSION_ID, 'E2E approve-consumable fixture session');
  seedPendingGate(
    repoRoot,
    APPROVE_CONSUMABLE_SESSION_ID,
    APPROVE_CONSUMABLE_GATE_ID,
    'E2E consumable gate for approval flows',
  );

  seedSession(repoRoot, REJECT_CONSUMABLE_SESSION_ID, 'E2E reject-consumable fixture session');
  seedPendingGate(
    repoRoot,
    REJECT_CONSUMABLE_SESSION_ID,
    REJECT_CONSUMABLE_GATE_ID,
    'E2E consumable gate for rejection flows',
  );
}

/** Remove the fixture sessions (and only them) — never touches sibling sessions. */
export function removeFixtureSession(repoRoot: string): void {
  for (const sessionId of [
    FIXTURE_SESSION_ID,
    CONTROL_FIXTURE_SESSION_ID,
    COMPLETED_FIXTURE_SESSION_ID,
    APPROVE_CONSUMABLE_SESSION_ID,
    REJECT_CONSUMABLE_SESSION_ID,
  ]) {
    const sessionDir = path.join(repoRoot, '.amber', 'sessions', sessionId);
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
}
