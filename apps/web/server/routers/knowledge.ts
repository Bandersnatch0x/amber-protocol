import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { listRecentChanges } from '../lib/knowledge-recent';
import { resolveRepoRoot } from '../lib/repo-root';
import { getStatus } from '../lib/knowledge-llm';
import { inferSemanticEdges, inferNodeSummaries } from '../lib/knowledge-llm-prompts';
import { readKnowledgeGraphSnapshot } from '../lib/knowledge-graph-reader';
import { answerKnowledgeQuestion, KnowledgeAskError } from '../lib/knowledge-qa';
import type {
  KnowledgeAskResultDTO,
  KnowledgeNode,
  KnowledgeGraphDTO,
  KnowledgeEdgeDTO,
  LLMStatusDTO,
  SemanticResultDTO,
  NodeSummaryDTO,
} from '../../src/lib/knowledge-dto';

const MAX_QUESTION_BYTES = 8 * 1024;
const MAX_FOCUS_NODE_ID_BYTES = 1024;

const askInputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1)
    .max(2_000)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= MAX_QUESTION_BYTES,
      'question-too-large',
    ),
  focusNodeId: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .refine(
      (value) => Buffer.byteLength(value, 'utf8') <= MAX_FOCUS_NODE_ID_BYTES,
      'focus-node-id-too-large',
    )
    .optional(),
  allowExternal: z.literal(true),
});

export function selectSemanticInputs(nodes: KnowledgeNode[]): {
  edgeNodes: KnowledgeNode[];
  summaryNodes: KnowledgeNode[];
} {
  return {
    edgeNodes: nodes,
    summaryNodes: nodes.filter((node) => node.body),
  };
}

export const knowledgeRouter = router({
  graph: publicProcedure.query((): KnowledgeGraphDTO => {
    return readKnowledgeGraphSnapshot(resolveRepoRoot());
  }),
  recentChanges: publicProcedure.query(() => listRecentChanges(resolveRepoRoot())),

  semanticStatus: publicProcedure.query((): LLMStatusDTO => {
    return getStatus();
  }),

  semantic: publicProcedure.query(async (): Promise<SemanticResultDTO> => {
    const status = getStatus();
    if (!status.available) {
      return { available: false, inferredEdges: [], nodeSummaries: [] };
    }

    let snapshot: KnowledgeGraphDTO;
    try {
      snapshot = readKnowledgeGraphSnapshot(resolveRepoRoot());
    } catch {
      console.warn('[knowledge.semantic] graph read failed');
      return {
        available: true,
        inferredEdges: [],
        nodeSummaries: [],
        error: 'graph-unavailable',
      };
    }

    const semanticInputs = selectSemanticInputs(snapshot.nodes);
    const existingEdges = snapshot.edges.map((edge) => ({
      src: edge.src,
      dst: edge.dst,
      verb: edge.verb,
    }));

    const [edgeOutcome, summaryOutcome] = await Promise.allSettled([
      inferSemanticEdges(semanticInputs.edgeNodes, existingEdges),
      inferNodeSummaries(semanticInputs.summaryNodes),
    ]);
    const errors: string[] = [];

    let inferredEdges: KnowledgeEdgeDTO[] = [];
    if (edgeOutcome.status === 'fulfilled') {
      inferredEdges = edgeOutcome.value.items.map((edge) => ({
        ...edge,
        origin: 'inferred' as const,
        provenance: edgeOutcome.value.provenance,
      }));
    } else {
      console.warn('[knowledge.semantic] semantic-edges facade failed');
      errors.push('semantic-edges-unavailable');
    }

    let nodeSummaries: NodeSummaryDTO[] = [];
    if (summaryOutcome.status === 'fulfilled') {
      nodeSummaries = summaryOutcome.value.items.map((summary) => ({
        ...summary,
        provenance: summaryOutcome.value.provenance,
        origin: 'inferred' as const,
      }));
    } else {
      console.warn('[knowledge.semantic] node-summaries facade failed');
      errors.push('node-summaries-unavailable');
    }

    return {
      available: true,
      inferredEdges,
      nodeSummaries,
      providerModel: status.model,
      ...(errors.length > 0 ? { error: errors.join(',') } : {}),
    };
  }),

  ask: publicProcedure
    .input(askInputSchema)
    .query(async ({ input }): Promise<KnowledgeAskResultDTO> => {
      const status = getStatus();
      if (!status.available)
        return { status: 'unavailable', reason: status.reason ?? 'invalid-config' };

      let snapshot: KnowledgeGraphDTO;
      try {
        snapshot = readKnowledgeGraphSnapshot(resolveRepoRoot());
      } catch {
        console.warn('[knowledge.ask] graph read failed');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'knowledge-graph-unavailable',
        });
      }

      try {
        return await answerKnowledgeQuestion(snapshot, input.question, input.focusNodeId);
      } catch (error) {
        if (error instanceof KnowledgeAskError) {
          throw new TRPCError({
            code: error.code === 'uncitable-answer' ? 'UNPROCESSABLE_CONTENT' : 'BAD_REQUEST',
            message: error.code,
          });
        }
        console.warn('[knowledge.ask] cited QA unavailable');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'knowledge-answer-unavailable',
        });
      }
    }),
});
