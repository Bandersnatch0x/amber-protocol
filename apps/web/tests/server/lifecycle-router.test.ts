import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@server/app-router';
import { lifecycleRouter } from '@server/routers/lifecycle';

const ORIGINAL_AMBER_REPO_ROOT = process.env.AMBER_REPO_ROOT;

let repoRoot: string;

const caller = lifecycleRouter.createCaller({});
const appCaller = appRouter.createCaller({});

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function appendTimeline(sessionId: string, event: Record<string, unknown>): void {
  const timelinePath = path.join(repoRoot, '.amber', 'sessions', sessionId, 'timeline.jsonl');
  fs.mkdirSync(path.dirname(timelinePath), { recursive: true });
  fs.appendFileSync(timelinePath, `${JSON.stringify(event)}\n`, 'utf8');
}

function readTimeline(sessionId: string): Array<Record<string, unknown>> {
  const timelinePath = path.join(repoRoot, '.amber', 'sessions', sessionId, 'timeline.jsonl');
  if (!fs.existsSync(timelinePath)) return [];
  return fs.readFileSync(timelinePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

function readLedger(sessionId: string): Array<Record<string, unknown>> {
  const ledgerPath = path.join(repoRoot, '.amber', 'sessions', sessionId, 'ledger.jsonl');
  if (!fs.existsSync(ledgerPath)) return [];
  return fs.readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

function readManifest(sessionId: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.amber', 'sessions', sessionId, 'manifest.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function seedRoute(target: string | null = 'node -e "process.exit(0)"'): void {
  const verifyStage: Record<string, unknown> = {
    name: 'verify',
    displayName: 'Run Verification',
    type: 'command',
  };
  if (target !== null) {
    verifyStage.target = target;
  }

  writeJson(path.join(repoRoot, 'routes', 'feature-standard.route.json'), {
    routeId: 'feature-standard',
    version: '1.0.0',
    displayName: 'Standard Feature Development',
    description: 'Test route',
    stages: [
      { name: 'implement', displayName: 'Implement Feature', type: 'pack', target: 'tdd-implementation' },
      verifyStage,
    ],
    gates: [{ id: 'user-approval-implement', type: 'user-approval', description: 'Proceed?' }],
  });
}

function seedVerifyPolicy(): void {
  writeJson(path.join(repoRoot, '.amber', 'governance', 'verify-rules.json'), {
    schemaVersion: 1,
    defaultAction: 'deny',
    rules: [{ id: 'allow-node', action: 'allow', match: 'prefix', pattern: 'node ' }],
  });
}

function seedSession(sessionId: string, overrides: Record<string, unknown> = {}): void {
  const now = '2026-07-08T00:00:00.000Z';
  writeJson(path.join(repoRoot, '.amber', 'sessions', sessionId, 'manifest.json'), {
    sessionId,
    schemaVersion: '1.0.0-rc.1',
    createdAt: now,
    updatedAt: now,
    route: { id: 'feature-standard', version: '1.0.0' },
    goal: 'test the lifecycle broker',
    status: 'executing',
    completedStages: [],
    handoff: { path: 'session-handoff.md' },
    ...overrides,
  });
}

describe('lifecycleRouter', () => {
  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'amber-web-lifecycle-'));
    process.env.AMBER_REPO_ROOT = repoRoot;
    writeJson(path.join(repoRoot, 'package.json'), { name: 'amber-protocol' });
    seedRoute();
    seedVerifyPolicy();
    seedSession('session-1');
    appendTimeline('session-1', {
      type: 'session_started',
      timestamp: '2026-07-08T00:00:01.000Z',
      data: { sessionId: 'session-1' },
    });
  });

  afterEach(() => {
    if (ORIGINAL_AMBER_REPO_ROOT === undefined) {
      delete process.env.AMBER_REPO_ROOT;
    } else {
      process.env.AMBER_REPO_ROOT = ORIGINAL_AMBER_REPO_ROOT;
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('is mounted on the app router', async () => {
    const result = await appCaller.lifecycle.completionCheck({ sessionId: 'session-1' });

    expect(result.strict).toBe(true);
  });

  it('returns the next lifecycle step for the fixed server repo root', async () => {
    const result = await caller.next({ session: 'session-1' });

    expect(result.focus).toMatchObject({ type: 'session', id: 'session-1', autoSelected: false });
    expect(result.nextStep).toMatchObject({ id: 'verify' });
    expect(result.lifecycle.map(step => step.id)).toEqual(['verify', 'approve', 'complete-check']);
    expect(result.completion?.status).toBe('fail');
  });

  it('defaults completion checks to strict mode', async () => {
    appendTimeline('session-1', {
      type: 'stage_completed',
      timestamp: '2026-07-08T00:00:02.000Z',
      data: { sessionId: 'session-1', stage: 'verify', executed: false },
    });

    const result = await caller.completionCheck({ sessionId: 'session-1' });

    expect(result.strict).toBe(true);
    expect(result.status).toBe('fail');
    expect(result.missing).toContain('verification');
  });

  it('can evaluate the lifecycle checklist with strict completion semantics', async () => {
    appendTimeline('session-1', {
      type: 'stage_completed',
      timestamp: '2026-07-08T00:00:02.000Z',
      data: { sessionId: 'session-1', stage: 'verify', executed: false },
    });
    appendTimeline('session-1', {
      type: 'gate_passed',
      timestamp: '2026-07-08T00:00:03.000Z',
      data: { sessionId: 'session-1' },
    });

    const relaxed = await caller.next({ session: 'session-1' });
    const strict = await caller.next({ session: 'session-1', strict: true });

    expect(relaxed.completion?.status).toBe('pass');
    expect(relaxed.nextStep).toBeNull();
    expect(relaxed.lifecycle.find(step => step.id === 'verify')).toMatchObject({ done: true });
    expect(strict.completion?.status).toBe('fail');
    expect(strict.completion?.missing).toContain('verification');
    expect(strict.nextStep).toMatchObject({ id: 'verify' });
    expect(strict.lifecycle.find(step => step.id === 'verify')).toMatchObject({ done: false });
  });

  it('runs the route verify command, records executed stage completion, and updates the manifest', async () => {
    const result = await caller.runVerification({ sessionId: 'session-1' });

    expect(result).toMatchObject({
      status: 'passed',
      executed: true,
      denied: false,
      stage: 'verify',
      displayName: 'Run Verification',
      command: 'node -e "process.exit(0)"',
      exitCode: 0,
    });
    expect(result.completion.strict).toBe(true);
    expect(result.completion.reasons).toContain('verification present');
    expect(readTimeline('session-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'stage_completed',
          data: expect.objectContaining({
            sessionId: 'session-1',
            stage: 'verify',
            displayName: 'Run Verification',
            command: 'node -e "process.exit(0)"',
            result: 'passed',
            executed: true,
            exitCode: 0,
          }),
        }),
      ]),
    );
    expect(readManifest('session-1').completedStages).toEqual(['verify']);
    expect(readLedger('session-1')).toEqual([
      expect.objectContaining({
        kind: 'verification_passed',
        command: 'node -e "process.exit(0)"',
        sessionId: 'session-1',
        stage: 'verify',
        exitCode: 0,
        executesAnything: true,
      }),
    ]);
  });

  it('surfaces policy denial without completing the stage', async () => {
    const result = await caller.runVerification({ sessionId: 'session-1', command: 'git status' });

    expect(result).toMatchObject({
      status: 'denied',
      executed: false,
      denied: true,
      command: 'git status',
      stage: 'verify',
    });
    expect(readTimeline('session-1').some(event => event.type === 'stage_completed')).toBe(false);
    expect(readManifest('session-1').completedStages).toEqual([]);
    expect(readLedger('session-1')).toEqual([
      expect.objectContaining({
        kind: 'verification_denied',
        command: 'git status',
        sessionId: 'session-1',
        stage: 'verify',
        executesAnything: false,
      }),
    ]);
  });

  it('records failed verification without completing the stage', async () => {
    const result = await caller.runVerification({
      sessionId: 'session-1',
      command: 'node -e "process.exit(3)"',
    });

    expect(result).toMatchObject({
      status: 'failed',
      executed: true,
      denied: false,
      exitCode: 3,
      stage: 'verify',
    });
    expect(readTimeline('session-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'verification_failed',
          data: expect.objectContaining({
            sessionId: 'session-1',
            stage: 'verify',
            displayName: 'Run Verification',
            command: 'node -e "process.exit(3)"',
            exitCode: 3,
          }),
        }),
      ]),
    );
    expect(readTimeline('session-1').some(event => event.type === 'stage_completed')).toBe(false);
    expect(readManifest('session-1').completedStages).toEqual([]);
  });

  it('rejects terminal sessions before executing verification', async () => {
    seedSession('session-1', { status: 'completed' });

    await expect(caller.runVerification({ sessionId: 'session-1' })).rejects.toThrow(
      'Cannot run verification for completed session: session-1',
    );
    expect(readLedger('session-1')).toEqual([]);
  });

  it('raises a typed validation error when no verification command is available', async () => {
    seedRoute(null);

    await expect(caller.runVerification({ sessionId: 'session-1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'No verification command configured for stage: verify',
    });
  });
});
