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
      await expect(getGate('00000000-0000-0000-0000-000000000001', '../evil')).rejects.toThrow('Invalid gate ID');
    });

    it('rejects gate IDs with special characters', async () => {
      const { getGate } = await import('@server/lib/gate-reader');
      await expect(getGate('00000000-0000-0000-0000-000000000001', 'gate/../evil')).rejects.toThrow('Invalid gate ID');
    });
  });

  describe('writeGateDecision', () => {
    it('rejects invalid session IDs', async () => {
      const { writeGateDecision } = await import('@server/lib/gate-reader');
      await expect(
        writeGateDecision('bad-id', 'my-gate', 'approved', 'ok')
      ).rejects.toThrow('Invalid session ID');
    });

    it('rejects invalid gate IDs', async () => {
      const { writeGateDecision } = await import('@server/lib/gate-reader');
      await expect(
        writeGateDecision('00000000-0000-0000-0000-000000000001', '../evil', 'approved')
      ).rejects.toThrow('Invalid gate ID');
    });
  });

  describe('approveGate and rejectGate', () => {
    it('approveGate delegates to writeGateDecision', async () => {
      const { approveGate } = await import('@server/lib/gate-reader');
      // Invalid session — passes validation but will fail on fs (gate not found)
      // The gate doesn't exist yet, so we expect an error about missing gate
      await expect(
        approveGate('00000000-0000-0000-0000-000000000001', 'nonexistent')
      ).rejects.toThrow();
    });

    it('rejectGate delegates to writeGateDecision', async () => {
      const { rejectGate } = await import('@server/lib/gate-reader');
      await expect(
        rejectGate('00000000-0000-0000-0000-000000000001', 'nonexistent')
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
