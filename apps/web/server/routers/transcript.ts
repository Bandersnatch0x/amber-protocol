import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import {
  listTranscripts,
  readTranscript,
  saveDigest,
  proposeRegressions,
} from '../lib/transcript-service';

export const transcriptRouter = router({
  list: publicProcedure.query(() => {
    return listTranscripts();
  }),

  read: publicProcedure
    .input(z.object({ id: z.string(), limit: z.number().optional() }))
    .query(({ input }) => {
      const detail = readTranscript(input.id, { limit: input.limit });
      if (!detail) {
        throw new Error('Transcript not found');
      }
      return detail;
    }),

  // On-demand persistence: writes a redacted digest under .amber/lens/
  // (git-ignored). Ephemeral by default — only called on explicit user action.
  save: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const result = saveDigest(input.id);
      if (!result) {
        throw new Error('Transcript not found');
      }
      return result;
    }),

  // Propose regression tests from failed tool calls. Writes reviewable
  // evidence under .amber/executions/ for `amber maintenance propose`;
  // never modifies the test suite.
  proposeRegressions: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      return proposeRegressions(input.id);
    }),
});
