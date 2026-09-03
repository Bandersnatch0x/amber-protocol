import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { resolveRepoRoot } from '../lib/repo-root';
import {
  applySuggestionById,
  dismissSuggestion,
  listSuggestions,
  readSuggestion,
  snoozeSuggestion,
  undoSuggestionById,
} from '../lib/suggestions/service';
import type { SuggestionMutationResult } from '../lib/suggestions/types';

function repoOpts() {
  return { repoRoot: resolveRepoRoot() };
}

function unwrap(result: SuggestionMutationResult) {
  if (!result.ok) {
    throw new Error(`${result.code}: ${result.message}`);
  }
  return result.suggestion;
}

export const suggestionsRouter = router({
  list: publicProcedure.query(() => {
    return listSuggestions(repoOpts());
  }),

  read: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const card = readSuggestion(input.id, repoOpts());
    if (!card) {
      throw new Error('Suggestion not found');
    }
    return card;
  }),

  dismiss: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    return unwrap(dismissSuggestion(input.id, repoOpts()));
  }),

  snooze: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    return unwrap(snoozeSuggestion(input.id, repoOpts()));
  }),

  applyCard: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    return unwrap(applySuggestionById(input.id, repoOpts()));
  }),

  undo: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    return unwrap(undoSuggestionById(input.id, repoOpts()));
  }),
});
