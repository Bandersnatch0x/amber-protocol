/**
 * Asynchronous evidence-job runner for the web console.
 *
 * The CLI surface executes verification synchronously inside
 * scripts/lib/core/evidence-runner.js (spawnSync), which is fine for a CLI
 * process but would freeze the web server event loop for up to the full
 * budget. This service re-implements ONLY the execution layer on top of
 * child_process.spawn; the governance seams are never forked here:
 *
 *   - the deny-wins policy verdict comes through web-adapter's
 *     evaluateVerifyPolicy (which delegates to loop-policy.js — the same call
 *     evidence-runner makes), so built-in destructive/composition denies and
 *     custom verify-rules.json behave byte-identically;
 *   - ledger records are appended through web-adapter's
 *     appendVerificationLedgerRecord (which delegates to loop-ledger.js — the
 *     hash-chain SSOT), so web-written records verify against the same chain
 *     the CLI writes.
 *
 * Job state lives in an in-memory table (jobId -> record) and every terminal
 * state is also persisted under `.amber/tmp/evidence-jobs/` so a client that
 * loses its SSE connection can still recover the result by polling
 * lifecycle.verificationJob.
 */

import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'child_process';
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveStatePath, readJsonSafe } from '../lib/artifact-store';
import { appendSessionTimelineEvent } from '../lib/session-audit-writer';
import { persistCompletedStage } from '../lib/session-writer';
import { sessionEvents } from './session-events';
import type {
  CompletionStatusResult,
  VerifyPolicyVerdict,
  WebAdapter,
} from '../../../../scripts/lib/web-adapter';

const requireCli = createRequire(import.meta.url);

const adapter = requireCli('../../../../scripts/lib/web-adapter.js') as WebAdapter;

// Output caps mirror scripts/lib/core/evidence-runner.js so web-written ledger
// records stay shape-identical to CLI-written ones.
const STDOUT_CAP = 4000;
const STDERR_CAP = 2000;
const DEFAULT_BUDGET_MINUTES = 5;
const JOB_DIR_SEGMENTS = ['tmp', 'evidence-jobs'] as const;
// The in-memory table is a fast path; terminal results are persisted to disk
// before eviction, so the evicted job's disk file is dropped alongside it
// (symmetric cleanup — the dir must not grow without bound).
const MAX_MEMORY_JOBS = 500;
// Concurrent-execution ceiling: verification commands spawn real processes, so
// unbounded parallel runs would multiply CPU/disk load. Requests beyond the
// limit are refused with a clear error; a session+stage already running is
// deduplicated (the in-flight job id is returned, no second process).
export const MAX_CONCURRENT_EVIDENCE_JOBS = 4;
// Terminal job files older than this are removed by the startup harvest.
const STALE_TERMINAL_JOB_MS = 24 * 60 * 60 * 1000;

export type EvidenceJobStatus =
  | 'pending'
  | 'running'
  | 'denied'
  | 'completed'
  | 'failed'
  | 'timeout';

export const EVIDENCE_JOB_TERMINAL_STATUSES: readonly EvidenceJobStatus[] = [
  'denied',
  'completed',
  'failed',
  'timeout',
];

export interface EvidenceJobParams {
  sessionId: string;
  stage: string;
  displayName: string;
  command: string;
  targetRoot: string;
  ledgerPath: string;
  budgetMinutes?: number;
}

/**
 * Result shape returned by the historical synchronous runVerification mutation
 * (passed/failed variants). verificationJob exposes it unchanged as `result`.
 */
export interface EvidenceJobResult {
  status: 'passed' | 'failed';
  sessionId: string;
  stage: string;
  displayName: string;
  command: string;
  executed: true;
  denied: false;
  exitCode: number;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  completedStages?: string[];
  completion?: CompletionStatusResult;
  ledgerRecord: Record<string, unknown>;
}

export interface EvidenceJobRecord {
  jobId: string;
  sessionId: string;
  stage: string;
  status: EvidenceJobStatus;
  createdAt: string;
  updatedAt: string;
  result?: EvidenceJobResult;
  error?: string;
}

interface SpawnOutcome {
  exitCode: number;
  timedOut: boolean;
  stdoutTail: string;
  stderrTail: string;
}

const jobs = new Map<string, EvidenceJobRecord>();

// Dedup index: `sessionId\u0000stage` → jobId of the currently running job.
// Concurrent runVerification calls for the same session+stage return the
// in-flight job instead of spawning a second process (which would also double
// the ledger/timeline audit records). Entries are released the moment their
// job settles, so a finished run never blocks a rerun.
const inFlightJobs = new Map<string, string>();

function inFlightKey(sessionId: string, stage: string): string {
  return `${sessionId}\u0000${stage}`;
}

/** Number of evidence jobs currently pending/running (global, across sessions). */
export function getRunningEvidenceJobCount(): number {
  return inFlightJobs.size;
}

/**
 * Return the still-running job for a session+stage, or null when none is in
 * flight (never returns a terminal record).
 */
export function getInFlightEvidenceJob(sessionId: string, stage: string): EvidenceJobRecord | null {
  const jobId = inFlightJobs.get(inFlightKey(sessionId, stage));
  if (!jobId) return null;
  const job = jobs.get(jobId);
  if (!job || EVIDENCE_JOB_TERMINAL_STATUSES.includes(job.status)) return null;
  return job;
}

function releaseInFlightJob(job: EvidenceJobRecord): void {
  const key = inFlightKey(job.sessionId, job.stage);
  // Only clear our own slot: a later job (after an eviction window) must not
  // be unregistered by a stale settlement.
  if (inFlightJobs.get(key) === job.jobId) {
    inFlightJobs.delete(key);
  }
}

/**
 * Deny-wins verification policy gate. Delegates to web-adapter's
 * evaluateVerifyPolicy — the exact call evidence-runner makes before spawning
 * — so the web surface can neither relax nor fork the gate.
 */
export function evaluateEvidencePolicy(targetRoot: string, command: string): VerifyPolicyVerdict {
  return adapter.evaluateVerifyPolicy(targetRoot, command);
}

/** Append one hash-chained ledger record through web-adapter's appendVerificationLedgerRecord. */
export function appendEvidenceLedgerRecord(
  ledgerPath: string,
  record: Record<string, unknown>,
): Record<string, unknown> {
  return adapter.appendVerificationLedgerRecord(ledgerPath, record);
}

function jobFilePath(jobId: string): string | null {
  // resolveStatePath applies the shared traversal guard (resolveWithin), so a
  // hostile jobId is treated exactly like a missing job rather than reaching
  // outside `.amber/tmp/evidence-jobs/`.
  return resolveStatePath(...JOB_DIR_SEGMENTS, `${jobId}.json`);
}

function persistJob(job: EvidenceJobRecord): void {
  const filePath = jobFilePath(job.jobId);
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(job, null, 2)}\n`, 'utf8');
  } catch (error) {
    // The in-memory table still serves live queries; a disk failure must not
    // take the job (or the mutation) down.
    console.error(`Failed to persist evidence job ${job.jobId}:`, error);
  }
}

function updateJob(job: EvidenceJobRecord, patch: Partial<EvidenceJobRecord>): void {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  persistJob(job);
}

function evictOldestTerminalJob(): void {
  if (jobs.size < MAX_MEMORY_JOBS) return;
  let oldestId: string | null = null;
  let oldestAt = '';
  for (const [id, record] of jobs) {
    if (!EVIDENCE_JOB_TERMINAL_STATUSES.includes(record.status)) continue;
    if (oldestId === null || record.createdAt < oldestAt) {
      oldestId = id;
      oldestAt = record.createdAt;
    }
  }
  if (!oldestId) return;
  jobs.delete(oldestId);
  // Symmetric with the memory eviction: drop the persisted file too, so
  // `.amber/tmp/evidence-jobs/` does not grow without bound. (Missing files
  // are fine — persistence is best-effort.)
  const filePath = jobFilePath(oldestId);
  if (filePath) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore — the file may already be gone (harvest / manual cleanup)
    }
  }
}

/**
 * Look up a job by id: in-memory table first, then the on-disk snapshot under
 * `.amber/tmp/evidence-jobs/` (survives SSE disconnects and server restarts
 * within a repo). Returns null for unknown or path-escaping ids.
 */
export function getEvidenceJob(jobId: string): EvidenceJobRecord | null {
  const inMemory = jobs.get(jobId);
  if (inMemory) return inMemory;

  const filePath = jobFilePath(jobId);
  if (!filePath) return null;
  const { value, error } = readJsonSafe(filePath);
  if (error || !value || typeof value !== 'object') return null;
  const record = value as EvidenceJobRecord;
  if (typeof record.jobId !== 'string' || typeof record.status !== 'string') return null;
  return record;
}

/**
 * Register a policy-approved verification as an async job and start it. The
 * caller returns `{ jobId, status: 'accepted' }` immediately; completion is
 * observed via getEvidenceJob and the `evidence-job-changed` SSE event.
 *
 * Concurrency semantics:
 *  - a session+stage with a job already pending/running returns THAT job
 *    (same jobId, no second spawn, no duplicate audit records);
 *  - above MAX_CONCURRENT_EVIDENCE_JOBS running jobs the request is refused
 *    with a clear error instead of queueing unbounded processes.
 */
export function startEvidenceJob(params: EvidenceJobParams): EvidenceJobRecord {
  const key = inFlightKey(params.sessionId, params.stage);
  const existingId = inFlightJobs.get(key);
  if (existingId) {
    const existing = jobs.get(existingId);
    if (existing && !EVIDENCE_JOB_TERMINAL_STATUSES.includes(existing.status)) {
      return existing;
    }
    // Stale slot (record evicted or settled without release) — drop it.
    inFlightJobs.delete(key);
  }
  if (inFlightJobs.size >= MAX_CONCURRENT_EVIDENCE_JOBS) {
    throw new Error(
      `Too many concurrent verification jobs (limit: ${MAX_CONCURRENT_EVIDENCE_JOBS}); ` +
        'wait for a running job to settle and retry.',
    );
  }

  const now = new Date().toISOString();
  const job: EvidenceJobRecord = {
    jobId: crypto.randomUUID(),
    sessionId: params.sessionId,
    stage: params.stage,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.jobId, job);
  inFlightJobs.set(key, job.jobId);
  evictOldestTerminalJob();
  persistJob(job);
  // Fire-and-forget: the mutation must not block on execution. Errors inside
  // runEvidenceJob always settle the job (never throw out of the handler).
  void runEvidenceJob(job, params);
  return job;
}

/**
 * Startup harvest for `.amber/tmp/evidence-jobs/` (mounted lazily from the
 * server boot path — see server/index.ts — so it never blocks startup):
 *
 *  - non-terminal records (pending/running) are leftovers of a server that
 *    died mid-job; settle them as `failed` ("server restarted before job
 *    completed") so clients stop polling and the verify button re-enables;
 *  - terminal records older than 24h are unlinked (the dir only ever grows
 *    otherwise); corrupt files are dropped for the same reason.
 *
 * Jobs still running in THIS process are skipped defensively. Returns the
 * number of settled orphans and removed files.
 */
export function harvestOrphanedEvidenceJobs(): { settled: number; removed: number } {
  const dir = resolveStatePath(...JOB_DIR_SEGMENTS);
  if (!dir) return { settled: 0, removed: 0 };

  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return { settled: 0, removed: 0 };
  }

  const now = Date.now();
  let settled = 0;
  let removed = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(dir, file);

    const { value, error } = readJsonSafe(filePath);
    if (error || !value || typeof value !== 'object') {
      try {
        fs.unlinkSync(filePath);
        removed += 1;
      } catch {
        // ignore — next harvest retries
      }
      continue;
    }
    const record = value as EvidenceJobRecord;
    if (typeof record.jobId !== 'string' || typeof record.status !== 'string') {
      try {
        fs.unlinkSync(filePath);
        removed += 1;
      } catch {
        // ignore
      }
      continue;
    }

    if (!EVIDENCE_JOB_TERMINAL_STATUSES.includes(record.status)) {
      const inMemory = jobs.get(record.jobId);
      if (inMemory && !EVIDENCE_JOB_TERMINAL_STATUSES.includes(inMemory.status)) {
        continue; // legitimately running in this process
      }
      const reaped: EvidenceJobRecord = {
        ...record,
        status: 'failed',
        error: 'server restarted before job completed',
        updatedAt: new Date().toISOString(),
      };
      try {
        fs.writeFileSync(filePath, `${JSON.stringify(reaped, null, 2)}\n`, 'utf8');
        settled += 1;
      } catch (writeError) {
        console.error(`Failed to settle orphaned evidence job ${record.jobId}:`, writeError);
      }
      continue;
    }

    // Terminal record: prune once it outlives the retention window.
    const stamp = record.updatedAt || record.createdAt;
    const ageMs = now - Date.parse(stamp);
    if (!Number.isNaN(ageMs) && ageMs > STALE_TERMINAL_JOB_MS) {
      try {
        fs.unlinkSync(filePath);
        removed += 1;
      } catch {
        // ignore
      }
    }
  }
  return { settled, removed };
}

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // shell:true spawns cmd.exe; killing only the shell would orphan the real
    // command on Windows. taskkill /T walks the tree (pid is a Node-provided
    // number, so no injection surface).
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return;
    } catch {
      // fall through to the plain kill below
    }
  }
  child.kill('SIGKILL');
}

function spawnEvidenceCommand(
  command: string,
  cwd: string,
  budgetMinutes: number,
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        timedOut,
        stdoutTail: stdout.slice(-STDOUT_CAP),
        stderrTail: stderr.slice(-STDERR_CAP),
      });
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, { shell: true, cwd, windowsHide: true });
    } catch (error) {
      resolve({
        exitCode: -1,
        timedOut: false,
        stdoutTail: '',
        stderrTail: String(error instanceof Error ? error.message : error).slice(-STDERR_CAP),
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, budgetMinutes * 60_000);
    // The timer must not keep the server alive once everything else settled.
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // Keep only the tail so a chatty command cannot grow memory without bound.
    child.stdout.on('data', (chunk) => {
      stdout = (stdout + chunk).slice(-STDOUT_CAP);
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-STDERR_CAP);
    });
    child.on('error', (error) => {
      stderr = (stderr + String(error.message)).slice(-STDERR_CAP);
      finish(-1);
    });
    // A null code means the process was killed (signal); treat it as failure
    // (-1) so a timed-out verify never records as passed — same convention as
    // evidence-runner's spawnSync path. A budget kill is normalized to -1 too:
    // on Windows the shell reports 1 after taskkill, which would otherwise
    // look like an ordinary command failure instead of a timeout.
    child.on('close', (code) => finish(timedOut ? -1 : code === null ? -1 : code));
  });
}

async function runEvidenceJob(job: EvidenceJobRecord, params: EvidenceJobParams): Promise<void> {
  try {
    updateJob(job, { status: 'running' });
    sessionEvents.emitEvidenceJobChanged(params.sessionId, job.jobId, 'running');

    const budgetMinutes = params.budgetMinutes ?? DEFAULT_BUDGET_MINUTES;
    const startedAt = Date.now();

    let exec: SpawnOutcome;
    try {
      exec = await spawnEvidenceCommand(params.command, params.targetRoot, budgetMinutes);
    } catch (error) {
      exec = {
        exitCode: -1,
        timedOut: false,
        stdoutTail: '',
        stderrTail: String(error instanceof Error ? error.message : error).slice(-STDERR_CAP),
      };
    }
    const durationMs = Date.now() - startedAt;

    try {
      // Same hash-chained record evidence-runner writes, so CLI and web evidence
      // verify against one chain.
      const ledgerRecord = appendEvidenceLedgerRecord(params.ledgerPath, {
        schemaVersion: 2,
        kind: exec.exitCode === 0 ? 'verification_passed' : 'verification_failed',
        command: params.command,
        exitCode: exec.exitCode,
        durationMs,
        stdoutTail: exec.stdoutTail,
        stderrTail: exec.stderrTail,
        recordedAt: new Date().toISOString(),
        executesAnything: true,
        sessionId: params.sessionId,
        stage: params.stage,
      });

      if (exec.exitCode === 0) {
        // Persist the stage completion BEFORE writing the stage_completed
        // audit event: if persistence throws, the catch below settles the job
        // as failed WITHOUT the timeline already claiming the stage passed —
        // the state on disk and the audit chain can never disagree.
        const updatedSession = await persistCompletedStage(params.sessionId, params.stage);
        await appendSessionTimelineEvent(params.sessionId, {
          type: 'stage_completed',
          data: {
            sessionId: params.sessionId,
            executed: true,
            stage: params.stage,
            displayName: params.displayName,
            command: params.command,
            result: 'passed',
            exitCode: 0,
            durationMs,
          },
        });
        const rawCompletedStages = updatedSession.manifest.completedStages;
        const result: EvidenceJobResult = {
          status: 'passed',
          sessionId: params.sessionId,
          stage: params.stage,
          displayName: params.displayName,
          command: params.command,
          executed: true,
          denied: false,
          exitCode: 0,
          durationMs,
          stdoutTail: exec.stdoutTail,
          stderrTail: exec.stderrTail,
          completedStages: Array.isArray(rawCompletedStages)
            ? (rawCompletedStages as string[])
            : [],
          completion: adapter.getCompletionStatus(params.targetRoot, params.sessionId, {
            strict: true,
          }),
          ledgerRecord,
        };
        updateJob(job, { status: 'completed', result });
        sessionEvents.emitEvidenceJobChanged(params.sessionId, job.jobId, 'completed');
        return;
      }

      await appendSessionTimelineEvent(params.sessionId, {
        type: 'verification_failed',
        data: {
          sessionId: params.sessionId,
          stage: params.stage,
          displayName: params.displayName,
          command: params.command,
          exitCode: exec.exitCode,
          durationMs,
        },
      });
      const result: EvidenceJobResult = {
        status: 'failed',
        sessionId: params.sessionId,
        stage: params.stage,
        displayName: params.displayName,
        command: params.command,
        executed: true,
        denied: false,
        exitCode: exec.exitCode,
        durationMs,
        stdoutTail: exec.stdoutTail,
        stderrTail: exec.stderrTail,
        ledgerRecord,
      };
      const status: EvidenceJobStatus = exec.timedOut ? 'timeout' : 'failed';
      updateJob(job, {
        status,
        result,
        ...(exec.timedOut
          ? { error: `Verification command exceeded the ${budgetMinutes} minute budget` }
          : {}),
      });
      sessionEvents.emitEvidenceJobChanged(params.sessionId, job.jobId, status);
    } catch (error) {
      // Audit/persistence failure after execution: the command did run, but the
      // job must settle visibly instead of hanging in 'running'. Because the
      // stage persistence happens before the audit writes (see above), a
      // failure here never leaves a stage_completed event ahead of the state.
      const message = error instanceof Error ? error.message : String(error);
      updateJob(job, { status: 'failed', error: message });
      sessionEvents.emitEvidenceJobChanged(params.sessionId, job.jobId, 'failed');
    }
  } finally {
    // Terminal by construction: every path above settles the job, so the
    // session+stage slot is always released for reruns.
    releaseInFlightJob(job);
  }
}
