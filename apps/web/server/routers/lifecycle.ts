import { createRequire } from 'module';
import path from 'path';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { resolveRepoRoot } from '../lib/repo-root';
import { resolveStatePath } from '../lib/artifact-store';
import { readSessionById } from '../lib/session-reader';
import { getRouteById, type RouteStage } from '../lib/route-reader';
import { appendSessionTimelineEvent } from '../lib/session-audit-writer';
import { persistCompletedStage } from '../lib/session-writer';
import type { CompletionStatusResult, WebAdapter } from '../../../../scripts/lib/web-adapter';

const requireCli = createRequire(import.meta.url);
const adapter = requireCli('../../../../scripts/lib/web-adapter.js') as WebAdapter;

const nextInputSchema = z.object({
  feature: z.string().optional(),
  session: z.string().optional(),
  strict: z.boolean().optional(),
}).optional();

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
  if (route && typeof route === 'object' && typeof (route as Record<string, unknown>).id === 'string') {
    return (route as Record<string, unknown>).id as string;
  }
  return null;
}

function resolveStage(sessionManifest: Record<string, unknown>, stageName: string): RouteStage | null {
  const routeId = getRouteId(sessionManifest);
  if (!routeId) return null;
  const route = getRouteById(routeId);
  return route?.stages?.find(stage => stage.name === stageName) ?? null;
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
  next: publicProcedure
    .input(nextInputSchema)
    .query(({ input }) => {
      const repoRoot = resolveRepoRoot();
      return adapter.evaluateLifecycleNext(repoRoot, input ?? {});
    }),

  completionCheck: publicProcedure
    .input(completionCheckInputSchema)
    .query(({ input }) => {
      return completionStatus(input.sessionId, input.strict ?? true);
    }),

  runVerification: publicProcedure
    .input(runVerificationInputSchema)
    .mutation(async ({ input }) => {
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
      const command = resolveVerificationCommand({
        inputCommand: input.command,
        stage,
        stageName: actualStageName,
      });

      const repoRoot = resolveRepoRoot();
      const ledgerPath = path.join(sessionDirFor(input.sessionId), 'ledger.jsonl');
      const evidence = adapter.runEvidenceCommand({
        target: repoRoot,
        command,
        ledgerPath,
        budgetMinutes: input.budgetMinutes,
        subject: { sessionId: input.sessionId, stage: actualStageName },
      });

      if (evidence.denied) {
        return {
          status: 'denied' as const,
          sessionId: input.sessionId,
          stage: actualStageName,
          displayName,
          command,
          executed: false,
          denied: true,
          reason: evidence.reason,
          ledgerRecord: evidence.ledgerRecord,
        };
      }

      if (evidence.exitCode !== 0) {
        await appendSessionTimelineEvent(input.sessionId, {
          type: 'verification_failed',
          data: {
            sessionId: input.sessionId,
            stage: actualStageName,
            displayName,
            command,
            exitCode: evidence.exitCode,
            durationMs: evidence.durationMs,
          },
        });
        return {
          status: 'failed' as const,
          sessionId: input.sessionId,
          stage: actualStageName,
          displayName,
          command,
          executed: true,
          denied: false,
          exitCode: evidence.exitCode,
          durationMs: evidence.durationMs,
          stdoutTail: evidence.stdoutTail,
          stderrTail: evidence.stderrTail,
          ledgerRecord: evidence.ledgerRecord,
        };
      }

      await appendSessionTimelineEvent(input.sessionId, {
        type: 'stage_completed',
        data: {
          sessionId: input.sessionId,
          executed: true,
          stage: actualStageName,
          displayName,
          command,
          result: 'passed',
          exitCode: 0,
          durationMs: evidence.durationMs,
        },
      });
      const updatedSession = await persistCompletedStage(input.sessionId, actualStageName);

      return {
        status: 'passed' as const,
        sessionId: input.sessionId,
        stage: actualStageName,
        displayName,
        command,
        executed: true,
        denied: false,
        exitCode: 0,
        durationMs: evidence.durationMs,
        stdoutTail: evidence.stdoutTail,
        stderrTail: evidence.stderrTail,
        completedStages: updatedSession.manifest.completedStages,
        completion: completionStatus(input.sessionId, true),
        ledgerRecord: evidence.ledgerRecord,
      };
    }),
});
