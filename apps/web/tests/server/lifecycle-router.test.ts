import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appRouter } from '@server/app-router';
import { lifecycleRouter } from '@server/routers/lifecycle';
import {
  harvestOrphanedEvidenceJobs,
  type EvidenceJobStatus,
} from '@server/services/evidence-jobs';

const ORIGINAL_AMBER_REPO_ROOT = process.env.AMBER_REPO_ROOT;

let repoRoot: string;

const caller = lifecycleRouter.createCaller({});
const appCaller = appRouter.createCaller({});

const TERMINAL_JOB_STATUSES: readonly EvidenceJobStatus[] = [
  'denied',
  'completed',
  'failed',
  'timeout',
];

async function waitForJob(
  jobId: string,
  timeoutMs = 30_000,
): Promise<Awaited<ReturnType<typeof caller.verificationJob>>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = await caller.verificationJob({ jobId });
    if (TERMINAL_JOB_STATUSES.includes(job.status as EvidenceJobStatus)) {
      return job;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Evidence job ${jobId} did not settle within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Narrow the runVerification union response to its accepted branch. */
function acceptedJobId(result: { status: string; jobId?: string }): string {
  if (result.status !== 'accepted' || typeof result.jobId !== 'string') {
    throw new Error(`Expected an accepted evidence job, got status=${result.status}`);
  }
  return result.jobId;
}

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
  return fs
    .readFileSync(timelinePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readLedger(sessionId: string): Array<Record<string, unknown>> {
  const ledgerPath = path.join(repoRoot, '.amber', 'sessions', sessionId, 'ledger.jsonl');
  if (!fs.existsSync(ledgerPath)) return [];
  return fs
    .readFileSync(ledgerPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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
      {
        name: 'implement',
        displayName: 'Implement Feature',
        type: 'pack',
        target: 'tdd-implementation',
      },
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

function seedLiveHandoff(): void {
  // G2: bare manifest.handoff.path is not enough; content must not look like the
  // init scaffold or completion still fails with missing:handoff.
  fs.writeFileSync(
    path.join(repoRoot, 'session-handoff.md'),
    [
      '# Session Handoff',
      '',
      'Command: npm test',
      'Result: pass',
      'Notes: regenerated for lifecycle fixture',
      '',
    ].join('\n'),
    'utf8',
  );
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
    seedLiveHandoff();
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
    expect(result.lifecycle.map((step) => step.id)).toEqual([
      'verify',
      'approve',
      'complete-check',
    ]);
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

    // buildContext defaults strict:true (G1 last-mile: next matches complete-check
    // --strict). Explicit strict:false is the only way to get relaxed semantics.
    const relaxed = await caller.next({ session: 'session-1', strict: false });
    const strict = await caller.next({ session: 'session-1' });

    expect(relaxed.completion?.status).toBe('pass');
    // After last-mile guidance, a passed complete-check still surfaces the
    // terminal `session complete` step until the session is marked completed.
    expect(relaxed.nextStep).toMatchObject({ id: 'session-complete' });
    expect(relaxed.lifecycle.find((step) => step.id === 'verify')).toMatchObject({ done: true });
    expect(strict.completion?.status).toBe('fail');
    expect(strict.completion?.missing).toContain('verification');
    expect(strict.nextStep).toMatchObject({ id: 'verify' });
    expect(strict.lifecycle.find((step) => step.id === 'verify')).toMatchObject({ done: false });
  });

  it('accepts verification as an async job that settles to completed with full audit trail', async () => {
    const accepted = await caller.runVerification({ sessionId: 'session-1' });

    expect(accepted).toMatchObject({
      status: 'accepted',
      sessionId: 'session-1',
      stage: 'verify',
      displayName: 'Run Verification',
      command: 'node -e "process.exit(0)"',
      denied: false,
    });
    const jobId = acceptedJobId(accepted);
    expect(jobId).toEqual(expect.any(String));

    const job = await waitForJob(jobId);
    expect(job.status).toBe('completed');
    expect(job.result).toMatchObject({
      status: 'passed',
      executed: true,
      denied: false,
      stage: 'verify',
      displayName: 'Run Verification',
      command: 'node -e "process.exit(0)"',
      exitCode: 0,
    });
    expect(job.result?.completion?.strict).toBe(true);
    expect(job.result?.completion?.reasons).toContain('verification present');
    expect(job.result?.completedStages).toEqual(['verify']);
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

  it('refuses verification on a route containing verb stages (F062 governed cursor)', async () => {
    // Overwrite the seeded route with one containing a verb stage: the web
    // verification surface writes manifest.completedStages directly
    // (persistCompletedStage), which would diverge the projection from the
    // ledger-owned verb cursor. The refusal is route-level, mirroring the
    // CLI's legacy verify guard in scripts/lib/session-commands.js.
    writeJson(path.join(repoRoot, 'routes', 'feature-standard.route.json'), {
      routeId: 'feature-standard',
      version: '1.0.0',
      displayName: 'Verb Route',
      description: 'Test route with a verb stage',
      stages: [
        {
          name: 'check',
          displayName: 'Check',
          type: 'verb',
          target: 'runner/ci@1.0.0#diagnose.check@1',
        },
      ],
    });

    await expect(caller.runVerification({ sessionId: 'session-1' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('verb stages'),
    });
    // Nothing was written: no manifest projection change, no ledger record.
    expect(readManifest('session-1').completedStages).toEqual([]);
    expect(readLedger('session-1')).toEqual([]);
  });

  it('persists the job result under .amber/tmp so an SSE disconnect cannot lose it', async () => {
    const accepted = await caller.runVerification({ sessionId: 'session-1' });
    const jobId = acceptedJobId(accepted);
    await waitForJob(jobId);

    const jobFile = path.join(repoRoot, '.amber', 'tmp', 'evidence-jobs', `${jobId}.json`);
    expect(fs.existsSync(jobFile)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(jobFile, 'utf8')) as Record<string, unknown>;
    expect(onDisk).toMatchObject({ jobId, status: 'completed' });
  });

  it('surfaces policy denial synchronously without creating a job', async () => {
    const result = await caller.runVerification({ sessionId: 'session-1', command: 'git status' });

    expect(result).toMatchObject({
      status: 'denied',
      executed: false,
      denied: true,
      command: 'git status',
      stage: 'verify',
    });
    expect((result as { jobId?: string }).jobId).toBeUndefined();
    expect((result as { reason?: string }).reason).toEqual(expect.any(String));
    expect(readTimeline('session-1').some((event) => event.type === 'stage_completed')).toBe(false);
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

  it('settles a failing command as a failed job without completing the stage', async () => {
    const accepted = await caller.runVerification({
      sessionId: 'session-1',
      command: 'node -e "process.exit(3)"',
    });
    expect(accepted.status).toBe('accepted');

    const job = await waitForJob(acceptedJobId(accepted));
    expect(job.status).toBe('failed');
    expect(job.result).toMatchObject({
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
    expect(readTimeline('session-1').some((event) => event.type === 'stage_completed')).toBe(false);
    expect(readManifest('session-1').completedStages).toEqual([]);
    expect(readLedger('session-1')).toEqual([
      expect.objectContaining({
        kind: 'verification_failed',
        exitCode: 3,
        sessionId: 'session-1',
        stage: 'verify',
        executesAnything: true,
      }),
    ]);
  });

  it('kills the command and settles the job as timeout when the budget is exhausted', async () => {
    const accepted = await caller.runVerification({
      sessionId: 'session-1',
      command: 'node -e "setTimeout(() => {}, 30000)"',
      budgetMinutes: 0.02, // ~1.2s budget
    });
    expect(accepted.status).toBe('accepted');

    const job = await waitForJob(acceptedJobId(accepted));
    expect(job.status).toBe('timeout');
    // A timed-out verify must never record as passed: same -1 convention as
    // the CLI spawnSync path.
    expect(job.result).toMatchObject({
      status: 'failed',
      exitCode: -1,
    });
    expect(job.error).toMatch(/budget/);
    expect(readTimeline('session-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'verification_failed',
          data: expect.objectContaining({ sessionId: 'session-1', exitCode: -1 }),
        }),
      ]),
    );
    expect(readManifest('session-1').completedStages).toEqual([]);
    expect(readLedger('session-1')).toEqual([
      expect.objectContaining({ kind: 'verification_failed', exitCode: -1 }),
    ]);
  }, 40_000);

  it('rejects unknown job ids with a typed NOT_FOUND error', async () => {
    await expect(caller.verificationJob({ jobId: 'no-such-job' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
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

  it('dedupes concurrent verification runs for the same session+stage', async () => {
    const slowCommand = 'node -e "setTimeout(() => {}, 3000)"';
    const first = await caller.runVerification({ sessionId: 'session-1', command: slowCommand });
    expect(first.status).toBe('accepted');

    // While the first job is still running, a second request for the same
    // session+stage must NOT spawn another process — it is accepted with the
    // existing jobId (no duplicate ledger/timeline audit records).
    const second = await caller.runVerification({
      sessionId: 'session-1',
      command: 'node -e "process.exit(0)"',
    });
    expect(second.status).toBe('accepted');
    expect(acceptedJobId(second)).toBe(acceptedJobId(first));

    const job = await waitForJob(acceptedJobId(first));
    expect(job.status).toBe('completed');
    // Exactly one execution was audited for the session+stage.
    const ledger = readLedger('session-1');
    expect(
      ledger.filter((r) => r.kind === 'verification_passed' || r.kind === 'verification_failed'),
    ).toHaveLength(1);
    expect(readTimeline('session-1').filter((e) => e.type === 'stage_completed')).toHaveLength(1);
    expect(readManifest('session-1').completedStages).toEqual(['verify']);
  }, 40_000);

  it('refuses verification beyond the concurrent job limit until a slot frees', async () => {
    const stages = ['cap-a', 'cap-b', 'cap-c', 'cap-d'];
    const jobIds: string[] = [];
    for (const stage of stages) {
      const accepted = await caller.runVerification({
        sessionId: 'session-1',
        stage,
        command: 'node -e "setTimeout(() => {}, 2500)"',
      });
      jobIds.push(acceptedJobId(accepted));
    }

    await expect(
      caller.runVerification({
        sessionId: 'session-1',
        stage: 'cap-e',
        command: 'node -e "process.exit(0)"',
      }),
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });

    await Promise.all(jobIds.map((id) => waitForJob(id)));

    // Capacity is released once jobs settle — the retry is accepted.
    const retry = await caller.runVerification({
      sessionId: 'session-1',
      stage: 'cap-e',
      command: 'node -e "process.exit(0)"',
    });
    const retried = await waitForJob(acceptedJobId(retry));
    expect(retried.status).toBe('completed');
  }, 60_000);

  it('settles orphaned job files left by a server restart and prunes stale ones', async () => {
    const jobDir = path.join(repoRoot, '.amber', 'tmp', 'evidence-jobs');
    const staleStamp = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const freshStamp = new Date().toISOString();
    writeJson(path.join(jobDir, 'orphan-running.json'), {
      jobId: 'orphan-running',
      sessionId: 'session-1',
      stage: 'verify',
      status: 'running',
      createdAt: staleStamp,
      updatedAt: staleStamp,
    });
    writeJson(path.join(jobDir, 'stale-terminal.json'), {
      jobId: 'stale-terminal',
      sessionId: 'session-1',
      stage: 'verify',
      status: 'completed',
      createdAt: staleStamp,
      updatedAt: staleStamp,
    });
    writeJson(path.join(jobDir, 'fresh-terminal.json'), {
      jobId: 'fresh-terminal',
      sessionId: 'session-1',
      stage: 'verify',
      status: 'completed',
      createdAt: freshStamp,
      updatedAt: freshStamp,
    });

    const summary = harvestOrphanedEvidenceJobs();
    expect(summary.settled).toBe(1);
    expect(summary.removed).toBe(1);

    const settled = JSON.parse(
      fs.readFileSync(path.join(jobDir, 'orphan-running.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(settled.status).toBe('failed');
    expect(settled.error).toBe('server restarted before job completed');
    expect(fs.existsSync(path.join(jobDir, 'stale-terminal.json'))).toBe(false);
    expect(fs.existsSync(path.join(jobDir, 'fresh-terminal.json'))).toBe(true);

    // The settled orphan is served by the normal job query — a client still
    // polling the old jobId gets a terminal answer instead of spinning forever.
    const job = await caller.verificationJob({ jobId: 'orphan-running' });
    expect(job.status).toBe('failed');
    expect(job.error).toBe('server restarted before job completed');
  });
});
