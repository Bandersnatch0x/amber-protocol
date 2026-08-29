import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeGraphDTO } from '@/lib/knowledge-dto';
import { llmCache } from '@server/lib/knowledge-llm-cache';
import {
  CITED_QA_PROMPT_HASH,
  CITED_QA_PROMPT_VERSION,
  KnowledgeAskError,
  assembleKnowledgeContext,
  validateCitedAnswer,
} from '@server/lib/knowledge-qa';
import { knowledgeRouter } from '@server/routers/knowledge';

const SOURCE_ROOT = path.resolve(process.cwd(), '..', '..');
const ENV_KEYS = ['LLM_API_KEY', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_BASE_URL'] as const;

const snapshot: KnowledgeGraphDTO = {
  schemaVersion: '1',
  nodes: [
    {
      id: 'node:a',
      kind: 'adr',
      layer: 'decision',
      title: 'A',
      sourcePath: 'a.md',
      body: 'A body',
    },
    {
      id: 'node:b',
      kind: 'wiki',
      layer: 'knowledge',
      title: 'B',
      sourcePath: 'b.md',
      body: 'B body',
    },
    {
      id: 'node:c',
      kind: 'feature',
      layer: 'implementation',
      title: 'C',
      sourcePath: 'feature_list.json',
      body: 'C body',
    },
    {
      id: 'node:d',
      kind: 'adr',
      layer: 'decision',
      title: 'D',
      sourcePath: 'd.md',
      body: 'D body',
    },
    {
      id: 'node:e',
      kind: 'wiki',
      layer: 'knowledge',
      title: 'E',
      sourcePath: 'e.md',
      body: 'E body',
    },
  ],
  edges: [
    { src: 'node:b', dst: 'node:c', verb: 'references', origin: 'deterministic' },
    { src: 'node:a', dst: 'node:b', verb: 'builds-on', origin: 'deterministic' },
    { src: 'node:c', dst: 'node:d', verb: 'describes', origin: 'deterministic' },
    { src: 'node:a', dst: 'node:d', verb: 'references', origin: 'inferred' },
    { src: 'node:e', dst: 'node:c', verb: 'supersedes', origin: 'deterministic' },
    { src: 'node:d', dst: 'node:c', verb: 'supersedes', origin: 'deterministic' },
  ],
  drift: [
    { nodeId: 'node:c', kind: 'dead-anchor', path: 'missing-c', detail: 'missing c' },
    { nodeId: 'node:d', kind: 'dead-anchor', path: 'missing-d', detail: 'missing d' },
  ],
  recentChanges: [],
};

function useStub() {
  process.env.LLM_API_KEY = 'stub-key';
  process.env.LLM_PROVIDER = 'stub';
  process.env.LLM_MODEL = 'stub-model';
}

beforeEach(() => {
  process.env.AMBER_REPO_ROOT = SOURCE_ROOT;
  for (const key of ENV_KEYS) delete process.env[key];
  llmCache.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  delete process.env.AMBER_REPO_ROOT;
  llmCache.clear();
  vi.restoreAllMocks();
});

describe('cited QA context assembly', () => {
  it('is byte-stable across input ordering and records the full sha256 digest', () => {
    const first = assembleKnowledgeContext(snapshot, undefined);
    const reordered = assembleKnowledgeContext(
      {
        ...snapshot,
        nodes: [...snapshot.nodes].reverse(),
        edges: [...snapshot.edges].reverse(),
        drift: [...snapshot.drift].reverse(),
      },
      undefined,
    );

    expect(reordered.context).toBe(first.context);
    expect(first.contextDigest).toBe(
      crypto.createHash('sha256').update(first.context, 'utf8').digest('hex'),
    );
    expect(first.contextDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(CITED_QA_PROMPT_VERSION).toBe('cited-qa-v1');
    expect(CITED_QA_PROMPT_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses exactly the stable deterministic two-hop neighborhood', () => {
    const assembled = assembleKnowledgeContext(snapshot, 'node:a');
    const context = JSON.parse(assembled.context) as {
      nodes: Array<{ id: string }>;
      edges: Array<{ src: string; dst: string }>;
      drift: Array<{ nodeId: string }>;
    };

    expect(context.nodes.map((node) => node.id)).toEqual(['node:a', 'node:b', 'node:c']);
    expect(context.edges).toEqual([
      { src: 'node:a', dst: 'node:b', verb: 'builds-on' },
      { src: 'node:b', dst: 'node:c', verb: 'references' },
    ]);
    expect(context.drift.map((finding) => finding.nodeId)).toEqual(['node:c']);
    expect(assembled.context).not.toContain('"origin":"inferred"');
    expect(assembled.context).not.toContain('node:a\",\"dst\":\"node:d');
  });

  it('rejects unknown focus ids and count or byte overflow without truncation', () => {
    expect(() => assembleKnowledgeContext(snapshot, 'missing')).toThrow('invalid-focus-node');

    const tooManyNodes: KnowledgeGraphDTO = {
      ...snapshot,
      nodes: Array.from({ length: 257 }, (_, index) => ({
        id: `node:${index}`,
        kind: 'wiki' as const,
        layer: 'knowledge' as const,
        title: 'Node',
        sourcePath: 'node.md',
      })),
      edges: [],
      drift: [],
    };
    expect(() => assembleKnowledgeContext(tooManyNodes, undefined)).toThrow('context-overflow');

    const tooManyBytes: KnowledgeGraphDTO = {
      ...snapshot,
      nodes: Array.from({ length: 256 }, (_, index) => ({
        id: `node:${index}`,
        kind: 'wiki' as const,
        layer: 'knowledge' as const,
        title: 'Node',
        sourcePath: 'node.md',
        body: '界'.repeat(1_000),
      })),
      edges: [],
      drift: [],
    };
    expect(() => assembleKnowledgeContext(tooManyBytes, undefined)).toThrow('context-overflow');
  });
});

describe('cited answer validation', () => {
  it('removes invalid ids, drops uncited segments, and counts only dropped segments', () => {
    const result = validateCitedAnswer(
      JSON.stringify({
        segments: [
          { text: 'Mixed.', citations: ['missing', 'node:a', 'node:a'] },
          { text: 'Invalid.', citations: ['missing'] },
          { text: 'Empty.', citations: [] },
        ],
      }),
      snapshot,
    );

    expect(result).toEqual({
      segments: [{ text: 'Mixed.', citations: ['node:a'] }],
      omittedCount: 2,
      supersededBy: {},
    });
  });

  it('raises the stable uncitable-answer error when every segment is dropped', () => {
    expect(() =>
      validateCitedAnswer(
        JSON.stringify({ segments: [{ text: 'Unsupported.', citations: ['missing'] }] }),
        snapshot,
      ),
    ).toThrowError(new KnowledgeAskError('uncitable-answer'));
  });

  it('accepts snapshot-valid citations outside the focused context', () => {
    const assembly = assembleKnowledgeContext(snapshot, 'node:a');
    expect(assembly.nodeIds.has('node:d')).toBe(false);

    expect(
      validateCitedAnswer(
        JSON.stringify({ segments: [{ text: 'Snapshot-scoped.', citations: ['node:d'] }] }),
        snapshot,
      ),
    ).toEqual({
      segments: [{ text: 'Snapshot-scoped.', citations: ['node:d'] }],
      omittedCount: 0,
      supersededBy: {},
    });
  });

  it('keeps citations to superseded nodes valid and preserves every superseder', () => {
    expect(
      validateCitedAnswer(
        JSON.stringify({ segments: [{ text: 'Historical.', citations: ['node:c'] }] }),
        snapshot,
      ),
    ).toEqual({
      segments: [{ text: 'Historical.', citations: ['node:c'] }],
      omittedCount: 0,
      supersededBy: { 'node:c': ['node:d', 'node:e'] },
    });
  });
});

describe('knowledge.ask query', () => {
  const caller = knowledgeRouter.createCaller({});

  it('returns unavailable without a key and remains query-only', async () => {
    await expect(
      caller.ask({ allowExternal: true, question: 'What is current?' }),
    ).resolves.toEqual({
      status: 'unavailable',
      reason: 'not-configured',
    });
    expect(
      Object.values(knowledgeRouter._def.procedures).every(
        (procedure) => procedure._def.type === 'query',
      ),
    ).toBe(true);
  });

  // Two router asks rebuild the real-repo schemaVersion 2 graph, and the F060
  // code extraction makes each cold build seconds-scale under full-suite
  // load; the subject here is digest plumbing, never extraction speed.
  it(
    'uses one stateless uncached exchange per ask and sends the digested context',
    { timeout: 30_000 },
    async () => {
      useStub();
      const llm = await import('@server/lib/knowledge-llm');
      const completeSpy = vi.spyOn(llm, 'completeWithMetadata');

      const first = await caller.ask({ allowExternal: true, question: 'What exists?' });
      const second = await caller.ask({ allowExternal: true, question: 'What exists?' });

      expect(first.status).toBe('ok');
      expect(second.status).toBe('ok');
      expect(completeSpy).toHaveBeenCalledTimes(2);
      for (const call of completeSpy.mock.calls) {
        expect(call[0]).toBe('cited-qa');
        const userMessage = call[2];
        const request = JSON.parse(userMessage) as { question: string; context: string };
        expect(request.question).toBe('What exists?');
        const contextDigest = crypto
          .createHash('sha256')
          .update(request.context, 'utf8')
          .digest('hex');
        const questionDigest = crypto
          .createHash('sha256')
          .update(request.question, 'utf8')
          .digest('hex');
        const exchangeDigest = crypto
          .createHash('sha256')
          .update(userMessage, 'utf8')
          .digest('hex');
        expect(first.status === 'ok' && first.contextDigest).toBe(contextDigest);
        expect(first.status === 'ok' && first.questionDigest).toBe(questionDigest);
        expect(first.status === 'ok' && first.exchangeDigest).toBe(exchangeDigest);
        expect(first.status === 'ok' && first.request).toEqual({ question: 'What exists?' });
        expect(first.status === 'ok' && first.provenance).toMatchObject({
          provider: 'stub',
          model: 'stub-model',
        });
      }
      expect(llmCache.size).toBe(0);
      expect(llmCache.inflightSize).toBe(0);
    },
  );

  it('performs no filesystem writes', async () => {
    useStub();
    const writeFile = vi.spyOn(fs, 'writeFileSync');
    const appendFile = vi.spyOn(fs, 'appendFileSync');
    const createWriteStream = vi.spyOn(fs, 'createWriteStream');
    const promiseWriteFile = vi.spyOn(fs.promises, 'writeFile');

    const result = await caller.ask({ allowExternal: true, question: 'What exists?' });
    expect(result.status).toBe('ok');
    expect(writeFile).not.toHaveBeenCalled();
    expect(appendFile).not.toHaveBeenCalled();
    expect(createWriteStream).not.toHaveBeenCalled();
    expect(promiseWriteFile).not.toHaveBeenCalled();
  });

  it('rejects absent or false external acknowledgement before graph or provider work', async () => {
    useStub();
    const graphReader = await import('@server/lib/knowledge-graph-reader');
    const graphSpy = vi.spyOn(graphReader, 'readKnowledgeGraphSnapshot');
    const exchangeSpy = vi.spyOn(await import('@server/lib/knowledge-llm'), 'completeWithMetadata');
    const callAsk = caller.ask as (input: unknown) => Promise<unknown>;

    await expect(callAsk({ question: 'What exists?' })).rejects.toThrow();
    await expect(callAsk({ question: 'What exists?', allowExternal: false })).rejects.toThrow();
    expect(graphSpy).not.toHaveBeenCalled();
    expect(exchangeSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid inputs and invalid focus before provider invocation', async () => {
    useStub();
    const completeSpy = vi.spyOn(await import('@server/lib/knowledge-llm'), 'completeWithMetadata');

    await expect(caller.ask({ allowExternal: true, question: '' })).rejects.toThrow();
    await expect(
      caller.ask({ allowExternal: true, question: 'Question', focusNodeId: 'missing' }),
    ).rejects.toThrow('invalid-focus-node');
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it('redacts malformed provider JSON behind a stable error', async () => {
    useStub();
    vi.spyOn(
      await import('@server/lib/knowledge-llm'),
      'completeWithMetadata',
    ).mockResolvedValueOnce({
      output: 'not-json secret-provider-payload',
      identity: { provider: 'stub', model: 'stub-model', endpoint: 'stub://local' },
      timestamp: '2026-08-28T00:00:00.000Z',
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const error = await caller
      .ask({ allowExternal: true, question: 'What exists?' })
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({ message: 'knowledge-answer-unavailable' });
    expect(JSON.stringify(error)).not.toContain('secret-provider-payload');
  });

  it('redacts provider failures behind a stable error', async () => {
    useStub();
    vi.spyOn(
      await import('@server/lib/knowledge-llm'),
      'completeWithMetadata',
    ).mockRejectedValueOnce(new Error('secret-token https://private.example'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      caller.ask({ allowExternal: true, question: 'What exists?' }),
    ).rejects.toMatchObject({
      message: 'knowledge-answer-unavailable',
    });
  });
});
