import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import {
  listTranscripts,
  readTranscript,
  saveDigest,
  proposeRegressions,
  candidatesForSession,
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

  // Inferred transcript↔session association (task #34). Read-only query:
  // cwd match + time-window overlap, honestly labeled via `basis`. Missing
  // manifests/transcripts degrade to an empty candidate list, never an error.
  candidatesForSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      return candidatesForSession(input.sessionId);
    }),

  // On-demand persistence: writes a redacted digest under .amber/lens/
  // (git-ignored). Ephemeral by default — only called on explicit user action.
  save: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const result = saveDigest(input.id);
    if (!result) {
      throw new Error('Transcript not found');
    }
    return result;
  }),

  // Propose regression tests from failed tool calls. Writes reviewable
  // evidence under .amber/executions/ for `amber maintenance propose`;
  // never modifies the test suite.
  proposeRegressions: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    return proposeRegressions(input.id);
  }),
});
