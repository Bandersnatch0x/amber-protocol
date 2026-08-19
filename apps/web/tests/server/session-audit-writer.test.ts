import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  appendSessionLedgerRecord,
  appendSessionTimelineEvent,
  readSessionAuditSummary,
} from '@server/lib/session-audit-writer';

const originalRepoRoot = process.env.AMBER_REPO_ROOT;
let testRoot: string;

function sessionDir(sessionId: string): string {
  return path.join(testRoot, '.amber', 'sessions', sessionId);
}

describe('session-audit-writer', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-session-audit-'));
    process.env.AMBER_REPO_ROOT = testRoot;
  });

  afterEach(() => {
    if (originalRepoRoot === undefined) {
      delete process.env.AMBER_REPO_ROOT;
    } else {
      process.env.AMBER_REPO_ROOT = originalRepoRoot;
    }
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('summarizes timeline events and verifies the ledger hash chain', async () => {
    const id = '00000000-0000-0000-0000-000000000001';
    fs.mkdirSync(sessionDir(id), { recursive: true });

    await appendSessionTimelineEvent(id, {
      type: 'gate_passed',
      data: { sessionId: id, gateId: 'gate-1' },
    });
    const firstLedgerRecord = await appendSessionLedgerRecord(id, {
      schemaVersion: 2,
      kind: 'gate_passed',
      sessionId: id,
      gateId: 'gate-1',
    });
    const secondLedgerRecord = await appendSessionLedgerRecord(id, {
      schemaVersion: 2,
      kind: 'gate_failed',
      sessionId: id,
      gateId: 'gate-2',
      reason: 'needs work',
    });

    const summary = await readSessionAuditSummary(id, 'gate-1');

    expect(summary.ledger).toMatchObject({
      path: `.amber/sessions/${id}/ledger.jsonl`,
      exists: true,
      verified: true,
      recordCount: 2,
      latest: {
        kind: 'gate_failed',
        gateId: 'gate-2',
        hash: secondLedgerRecord.hash,
      },
      latestForGate: {
        kind: 'gate_passed',
        gateId: 'gate-1',
        hash: firstLedgerRecord.hash,
      },
    });
    expect(summary.timeline).toMatchObject({
      path: `.amber/sessions/${id}/timeline.jsonl`,
      exists: true,
      eventCount: 1,
      latestForGate: {
        type: 'gate_passed',
        gateId: 'gate-1',
      },
    });
  });

  it('marks a tampered ledger as unverified', async () => {
    const id = '00000000-0000-0000-0000-000000000002';
    fs.mkdirSync(sessionDir(id), { recursive: true });
    await appendSessionLedgerRecord(id, {
      schemaVersion: 2,
      kind: 'gate_passed',
      sessionId: id,
      gateId: 'gate-1',
    });

    const ledgerPath = path.join(sessionDir(id), 'ledger.jsonl');
    const [line] = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
    const tampered = { ...JSON.parse(line), kind: 'gate_failed' };
    fs.writeFileSync(ledgerPath, `${JSON.stringify(tampered)}\n`);

    const summary = await readSessionAuditSummary(id, 'gate-1');

    expect(summary.ledger).toMatchObject({
      exists: true,
      verified: false,
      recordCount: 1,
      error: 'Ledger hash chain verification failed',
    });
  });

  it('does not let a session id escape the sessions directory', async () => {
    const escapedDir = path.join(testRoot, '.amber', 'evil');
    fs.mkdirSync(escapedDir, { recursive: true });

    await expect(appendSessionTimelineEvent('../evil', { type: 'gate_passed' })).rejects.toThrow(
      'Session not found',
    );
    await expect(readSessionAuditSummary('../evil')).rejects.toThrow('Session not found');
    expect(fs.existsSync(path.join(escapedDir, 'timeline.jsonl'))).toBe(false);
  });
});
