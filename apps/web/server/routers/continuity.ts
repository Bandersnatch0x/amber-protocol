import { createRequire } from 'module';
import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { resolveRepoRoot } from '../lib/repo-root';
import type { WebAdapter } from '../../../../scripts/lib/web-adapter';

const requireCli = createRequire(import.meta.url);
const adapter = requireCli('../../../../scripts/lib/web-adapter.js') as WebAdapter;

const optionalSessionInputSchema = z
  .object({
    sessionId: z.string().trim().min(1).optional(),
  })
  .optional();

const governanceSummaryInputSchema = z
  .object({
    featureId: z.string().trim().min(1).optional(),
  })
  .optional();

const completionNextActionsInputSchema = z.object({
  sessionId: z.string().trim().min(1),
});

// Read-only continuity surface: handoff status/preview, governance summary,
// and completion next-actions. Every procedure is a query over the web-adapter
// folds — no mutations, no CLI forking, nothing written.
export const continuityRouter = router({
  handoff: router({
    status: publicProcedure.input(optionalSessionInputSchema).query(({ input }) => {
      const repoRoot = resolveRepoRoot();
      return adapter.getHandoffStatus(repoRoot, input?.sessionId);
    }),

    preview: publicProcedure.input(optionalSessionInputSchema).query(({ input }) => {
      const repoRoot = resolveRepoRoot();
      return adapter.getHandoffPreview(repoRoot, input?.sessionId);
    }),
  }),

  governance: router({
    summary: publicProcedure.input(governanceSummaryInputSchema).query(({ input }) => {
      const repoRoot = resolveRepoRoot();
      return adapter.getGovernanceSummary(repoRoot, input);
    }),
  }),

  completion: router({
    nextActions: publicProcedure.input(completionNextActionsInputSchema).query(({ input }) => {
      const repoRoot = resolveRepoRoot();
      return adapter.getCompletionNextActions(repoRoot, input.sessionId);
    }),
  }),
});
