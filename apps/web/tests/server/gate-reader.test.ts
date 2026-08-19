import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// We test the exported functions against a real temp directory.
// getSessionsPath() resolves to ../../.amber/sessions from cwd.
// We create that structure in a temp dir and change cwd for each test.

const originalRepoRoot = process.env.AMBER_REPO_ROOT;
let testRoot: string;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function createTestSetup(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-gate-test-'));
  const amberSessions = path.join(root, '.amber', 'sessions');
  ensureDir(amberSessions);
  return root;
}

// Since gate-reader's getSessionsPath uses process.cwd() + '../../.amber/sessions',
// we set cwd to apps/web (simulating the server's working directory) and create
// a real .amber/sessions structure relative to it.

describe('gate-reader', () => {
  let sessionsDir: string;

  beforeEach(() => {
    testRoot = createTestSetup();
    // Create the structure so that from apps/web, ../../.amber/sessions exists
    // getSessionsPath() = cwd/../../.amber/sessions
    // If cwd = apps/web, then ../../.amber = repoRoot/.amber
    // We mimic this: testRoot/.amber/sessions
    sessionsDir = path.join(testRoot, '.amber', 'sessions');
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

  describe('getGate', () => {
    it('rejects invalid session IDs', async () => {
      const { getGate } = await import('@server/lib/gate-reader');
      await expect(getGate('not-a-uuid', 'my-gate')).rejects.toThrow('Invalid session ID');
    });

    it('rejects invalid gate IDs with path traversal', async () => {
      const { getGate } = await import('@server/lib/gate-reader');
      await expect(getGate('00000000-0000-0000-0000-000000000001', '../evil')).rejects.toThrow(
        'Invalid gate ID',
      );
    });

    it('rejects gate IDs with special characters', async () => {
      const { getGate } = await import('@server/lib/gate-reader');
      await expect(getGate('00000000-0000-0000-0000-000000000001', 'gate/../evil')).rejects.toThrow(
        'Invalid gate ID',
      );
    });
  });

  describe('writeGateDecision', () => {
    it('rejects invalid session IDs', async () => {
      const { writeGateDecision } = await import('@server/lib/gate-reader');
      await expect(writeGateDecision('bad-id', 'my-gate', 'approved', 'ok')).rejects.toThrow(
        'Invalid session ID',
      );
    });

    it('rejects invalid gate IDs', async () => {
      const { writeGateDecision } = await import('@server/lib/gate-reader');
      await expect(
        writeGateDecision('00000000-0000-0000-0000-000000000001', '../evil', 'approved'),
      ).rejects.toThrow('Invalid gate ID');
    });
  });

  describe('writeGateDecision reviewer identity', () => {
    const sessionId = '00000000-0000-4000-8000-000000000002';

    function seedGate(gateId: string): void {
      const gatesDir = path.join(sessionsDir, sessionId, 'gates');
      ensureDir(gatesDir);
      writeJson(path.join(gatesDir, `${gateId}.gate.json`), {
        gateId,
        sessionId,
        type: 'user-approval',
        stage: 'implement',
        description: 'reviewer test gate',
        triggeredAt: '2026-06-20T00:00:00.000Z',
      });
    }

    function decisionPath(gateId: string): string {
      return path.join(sessionsDir, sessionId, 'gates', `${gateId}.decision.json`);
    }

    it('records the supplied reviewer as resolvedBy', async () => {
      const { writeGateDecision } = await import('@server/lib/gate-reader');
      seedGate('reviewer-gate');

      await writeGateDecision(sessionId, 'reviewer-gate', 'approved', 'ok', 'alice@team');

      const decision = JSON.parse(fs.readFileSync(decisionPath('reviewer-gate'), 'utf8'));
      expect(decision.decision).toBe('approved');
      expect(decision.resolvedBy).toBe('alice@team');
    });

    it('defaults resolvedBy to web:anonymous when no reviewer is supplied', async () => {
      const { writeGateDecision } = await import('@server/lib/gate-reader');
      seedGate('anonymous-gate');

      await writeGateDecision(sessionId, 'anonymous-gate', 'rejected', 'needs work');

      const decision = JSON.parse(fs.readFileSync(decisionPath('anonymous-gate'), 'utf8'));
      expect(decision.resolvedBy).toBe('web:anonymous');
    });

    it('rejects invalid reviewer identifiers without writing a decision', async () => {
      const { writeGateDecision } = await import('@server/lib/gate-reader');
      seedGate('bad-reviewer-gate');

      await expect(
        writeGateDecision(sessionId, 'bad-reviewer-gate', 'approved', undefined, 'bad<script>'),
      ).rejects.toThrow('Invalid reviewer identifier');

      expect(fs.existsSync(decisionPath('bad-reviewer-gate'))).toBe(false);
    });

    it('surfaces the recorded resolvedBy when reading the gate back', async () => {
      const { writeGateDecision, getGate } = await import('@server/lib/gate-reader');
      seedGate('readback-gate');

      await writeGateDecision(sessionId, 'readback-gate', 'approved', undefined, 'web:carol');

      const gate = await getGate(sessionId, 'readback-gate');
      expect(gate?.status).toBe('approved');
      expect(gate?.resolvedBy).toBe('web:carol');
    });
  });

  describe('approveGate and rejectGate', () => {
    it('approveGate delegates to writeGateDecision', async () => {
      const { approveGate } = await import('@server/lib/gate-reader');
      // Invalid session — passes validation but will fail on fs (gate not found)
      // The gate doesn't exist yet, so we expect an error about missing gate
      await expect(
        approveGate('00000000-0000-0000-0000-000000000001', 'nonexistent'),
      ).rejects.toThrow();
    });

    it('rejectGate delegates to writeGateDecision', async () => {
      const { rejectGate } = await import('@server/lib/gate-reader');
      await expect(
        rejectGate('00000000-0000-0000-0000-000000000001', 'nonexistent'),
      ).rejects.toThrow();
    });
  });

  describe('listGates', () => {
    it('returns empty array when sessions dir does not exist', async () => {
      fs.rmSync(sessionsDir, { recursive: true, force: true });

      const { listGates } = await import('@server/lib/gate-reader');

      const gates = await listGates();
      expect(gates).toEqual([]);
    });

    it('filters by status', async () => {
      const { listGates } = await import('@server/lib/gate-reader');
      const gates = await listGates({ status: 'pending' });
      expect(Array.isArray(gates)).toBe(true);
      for (const gate of gates) {
        expect(gate.status).toBe('pending');
      }
    });
  });
});
