import { createRequire } from 'module';
import path from 'path';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { resolveRepoRoot } from '../lib/repo-root';
import { resolveStatePath } from '../lib/artifact-store';
import { readSessionById } from '../lib/session-reader';
import { getRouteById, type RouteStage } from '../lib/route-reader';
import {
  MAX_CONCURRENT_EVIDENCE_JOBS,
  appendEvidenceLedgerRecord,
  evaluateEvidencePolicy,
  getEvidenceJob,
  getInFlightEvidenceJob,
  getRunningEvidenceJobCount,
  startEvidenceJob,
} from '../services/evidence-jobs';
import type { CompletionStatusResult, WebAdapter } from '../../../../scripts/lib/web-adapter';

const requireCli = createRequire(import.meta.url);
const adapter = requireCli('../../../../scripts/lib/web-adapter.js') as WebAdapter;

const nextInputSchema = z
  .object({
    feature: z.string().optional(),
    session: z.string().optional(),
    strict: z.boolean().optional(),
  })
  .optional();

const completionCheckInputSchema = z.object({
  sessionId: z.string(),
  strict: z.boolean().optional(),
});

const runVerificationInputSchema = z.object({
  sessionId: z.string(),
  stage: z.string().trim().min(1).optional(),
  command: z.string().trim().min(1).optional(),
  budgetMinutes: z.number().positive().optional(),
});

function completionStatus(sessionId: string, strict = true): CompletionStatusResult {
  const repoRoot = resolveRepoRoot();
  return adapter.getCompletionStatus(repoRoot, sessionId, { strict });
}

function getRouteId(manifest: Record<string, unknown>): string | null {
  const route = manifest.route;
  if (
    route &&
    typeof route === 'object' &&
    typeof (route as Record<string, unknown>).id === 'string'
  ) {
    return (route as Record<string, unknown>).id as string;
  }
  return null;
}

function resolveStage(
  sessionManifest: Record<string, unknown>,
  stageName: string,
): RouteStage | null {
  const routeId = getRouteId(sessionManifest);
  if (!routeId) return null;
  const route = getRouteById(routeId);
  return route?.stages?.find((stage) => stage.name === stageName) ?? null;
}

function resolveVerificationCommand({
  inputCommand,
  stage,
  stageName,
}: {
  inputCommand?: string;
  stage: RouteStage | null;
  stageName: string;
}): string {
  if (inputCommand) {
    return inputCommand;
  }

  const routeTarget = stage?.target;
  const isCommandStage = stage?.type === 'command' || stageName === 'verify';
  if (isCommandStage && routeTarget) {
    return routeTarget;
  }

  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `No verification command configured for stage: ${stageName}`,
  });
}

function sessionDirFor(sessionId: string): string {
  const sessionDir = resolveStatePath('sessions', sessionId);
  if (!sessionDir) {
    throw new Error('Session not found');
  }
  return sessionDir;
}

export const lifecycleRouter = router({
  next: publicProcedure.input(nextInputSchema).query(({ input }) => {
    const repoRoot = resolveRepoRoot();
    return adapter.evaluateLifecycleNext(repoRoot, input ?? {});
  }),

  completionCheck: publicProcedure.input(completionCheckInputSchema).query(({ input }) => {
    return completionStatus(input.sessionId, input.strict ?? true);
  }),

  runVerification: publicProcedure.input(runVerificationInputSchema).mutation(async ({ input }) => {
    const session = readSessionById(input.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status === 'completed' || session.status === 'aborted') {
      throw new Error(`Cannot run verification for ${session.status} session: ${input.sessionId}`);
    }

    const stageName = input.stage ?? 'verify';
    const stage = resolveStage(session.manifest, stageName);
    const actualStageName = stage?.name ?? stageName;
    const displayName = stage?.displayName ?? actualStageName;

    // F062 boundary: on a route containing verb stages the cursor is owned by
    // the session ledger and advances only through `amber session run`/
    // `session settle`. This mutation writes manifest.completedStages directly
    // (persistCompletedStage), which would diverge the projection from the
    // ledger-owned cursor — refuse the whole route, exactly as the CLI's
    // legacy verify guard does (scripts/lib/session-commands.js).
    const routeId = getRouteId(session.manifest);
    const route = routeId ? getRouteById(routeId) : null;
    if (route?.stages?.some((entry) => entry?.type === 'verb')) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          `Route ${routeId} contains verb stages; their cursor advances only through the governed seam. ` +
          `Use: amber session run --session ${input.sessionId} [--execute] and amber session settle --session ${input.sessionId} --request-id <id> ...`,
      });
    }

    const command = resolveVerificationCommand({
      inputCommand: input.command,
      stage,
      stageName: actualStageName,
    });

    const repoRoot = resolveRepoRoot();
    const ledgerPath = path.join(sessionDirFor(input.sessionId), 'ledger.jsonl');

    // Concurrency dedup: a verification already pending/running for this
    // session+stage is returned as-is (same jobId, still `accepted`) — no
    // second spawn, no duplicate ledger/timeline audit records.
    const inFlight = getInFlightEvidenceJob(input.sessionId, actualStageName);
    if (inFlight) {
      return {
        status: 'accepted' as const,
        jobId: inFlight.jobId,
        sessionId: input.sessionId,
        stage: actualStageName,
        displayName,
        command,
        executed: false,
        denied: false,
      };
    }

    // Global concurrency ceiling: refuse instead of spawning unbounded
    // verification processes (startEvidenceJob enforces the same limit).
    if (getRunningEvidenceJobCount() >= MAX_CONCURRENT_EVIDENCE_JOBS) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message:
          `Too many concurrent verification jobs (limit: ${MAX_CONCURRENT_EVIDENCE_JOBS}); ` +
          'wait for a running job to settle and retry.',
      });
    }

    // Deny-wins policy gate before any job exists (SSOT: the CLI
    // loop-policy.js seam — the same verdict evidence-runner enforces).
    // Refusals return synchronously and never create a job.
    const verdict = evaluateEvidencePolicy(repoRoot, command);
    if (!verdict.allowed) {
      const ledgerRecord = appendEvidenceLedgerRecord(ledgerPath, {
        schemaVersion: 2,
        kind: 'verification_denied',
        command,
        reason: verdict.reason,
        recordedAt: new Date().toISOString(),
        executesAnything: false,
        sessionId: input.sessionId,
        stage: actualStageName,
      });
      return {
        status: 'denied' as const,
        sessionId: input.sessionId,
        stage: actualStageName,
        displayName,
        command,
        executed: false,
        denied: true,
        reason: verdict.reason,
        ledgerRecord,
      };
    }

    // Execution is async now: the mutation accepts the job and returns
    // immediately instead of blocking the server event loop for up to the
    // command budget. Audit writes (timeline + ledger) happen when the job
    // settles; progress flows over the `evidence-job-changed` SSE event and
    // the lifecycle.verificationJob query.
    const job = startEvidenceJob({
      sessionId: input.sessionId,
      stage: actualStageName,
      displayName,
      command,
      targetRoot: repoRoot,
      ledgerPath,
      budgetMinutes: input.budgetMinutes,
    });

    return {
      status: 'accepted' as const,
      jobId: job.jobId,
      sessionId: input.sessionId,
      stage: actualStageName,
      displayName,
      command,
      executed: false,
      denied: false,
    };
  }),

  verificationJob: publicProcedure
    .input(z.object({ jobId: z.string().trim().min(1) }))
    .query(({ input }) => {
      const job = getEvidenceJob(input.jobId);
      if (!job) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Evidence job not found: ${input.jobId}`,
        });
      }
      return {
        jobId: job.jobId,
        status: job.status,
        ...(job.result ? { result: job.result } : {}),
        ...(job.error ? { error: job.error } : {}),
      };
    }),
});
