import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  seedFixtureSession,
  removeFixtureSession,
  FIXTURE_SESSION_ID,
  FIXTURE_GATE_ID,
} from '../e2e/fixtures/seed';

// Validates the fixture writes structures the server readers consume, without
// depending on cwd — the e2e globalSetup wires cwd; here we pass an explicit root.
describe('e2e seed fixture', () => {
  let tmpRoot: string;

  afterEach(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function sessionPath(...segs: string[]): string {
    return path.join(tmpRoot, '.amber', 'sessions', FIXTURE_SESSION_ID, ...segs);
  }

  it('writes a manifest with the fields session-reader reads', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-e2e-seed-'));
    seedFixtureSession(tmpRoot);

    const manifest = JSON.parse(fs.readFileSync(sessionPath('manifest.json'), 'utf8'));
    expect(manifest.goal).toBeTruthy();
    expect(manifest.status).toBeTruthy();
    expect(manifest.route.id).toBeTruthy();
    expect(manifest.route.name).toBeTruthy();
    expect(manifest.createdAt).toBeTruthy();
  });

  it('writes a non-empty timeline.jsonl with one JSON object per line', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-e2e-seed-'));
    seedFixtureSession(tmpRoot);

    const lines = fs
      .readFileSync(sessionPath('timeline.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it('writes a pending gate (gate file present, no decision file)', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-e2e-seed-'));
    seedFixtureSession(tmpRoot);

    const gate = JSON.parse(fs.readFileSync(sessionPath('gates', `${FIXTURE_GATE_ID}.gate.json`), 'utf8'));
    expect(gate.gateId).toBe(FIXTURE_GATE_ID);
    expect(gate.sessionId).toBe(FIXTURE_SESSION_ID);
    expect(gate.triggeredAt).toBeTruthy();
    expect(fs.existsSync(sessionPath('gates', `${FIXTURE_GATE_ID}.decision.json`))).toBe(false);
  });

  it('uses a session id that passes the gate-reader UUID guard', () => {
    expect(FIXTURE_SESSION_ID).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('removeFixtureSession deletes the fixture directory', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-e2e-seed-'));
    seedFixtureSession(tmpRoot);
    removeFixtureSession(tmpRoot);
    expect(fs.existsSync(sessionPath())).toBe(false);
  });
});
