import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeLRUCache, llmCache } from '@server/lib/knowledge-llm-cache';
import {
  NODE_SUMMARY_PROMPT_HASH,
  NODE_SUMMARY_PROMPT_VERSION,
  SEMANTIC_EDGES_PROMPT_HASH,
  SEMANTIC_EDGES_PROMPT_VERSION,
  inferNodeSummaries,
  inferSemanticEdges,
} from '@server/lib/knowledge-llm-prompts';
import {
  complete,
  completeWithMetadata,
  getCacheIdentity,
  getStatus,
} from '@server/lib/knowledge-llm';
import { knowledgeRouter, selectSemanticInputs } from '@server/routers/knowledge';

const ENV_KEYS = [
  'LLM_API_KEY',
  'LLM_PROVIDER',
  'LLM_MODEL',
  'LLM_BASE_URL',
  'LLM_TIMEOUT_MS',
] as const;
const SOURCE_ROOT = path.resolve(process.cwd(), '..', '..');
const nodes = [
  { id: 'adr:0001', kind: 'adr', title: 'Test ADR', body: 'Some body.' },
  { id: 'feature:F001', kind: 'feature', title: 'Test feature', body: 'Feature body.' },
];

function setEnv(key: (typeof ENV_KEYS)[number], value: string) {
  process.env[key] = value;
}

function clearEnv(...keys: readonly string[]) {
  for (const key of keys) delete process.env[key];
}

function useStub(model = 'stub-model') {
  setEnv('LLM_API_KEY', 'stub-key');
  setEnv('LLM_PROVIDER', 'stub');
  setEnv('LLM_MODEL', model);
}

beforeEach(() => {
  clearEnv(...ENV_KEYS);
  llmCache.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  clearEnv(...ENV_KEYS);
  llmCache.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('provider configuration and network bounds', () => {
  it('reports no-key configuration as unavailable', () => {
    expect(getStatus()).toEqual({ available: false, reason: 'not-configured' });
  });

  it('accepts only the openai, anthropic, and stub providers', async () => {
    setEnv('LLM_API_KEY', 'secret');
    setEnv('LLM_PROVIDER', 'azure');
    expect(getStatus()).toEqual({ available: false, reason: 'invalid-config' });
    await expect(complete('semantic-edges', 'system', '{}')).rejects.toThrow('invalid-provider');
  });

  it.each([
    ['blank', '   '],
    ['character-oversized', 'm'.repeat(257)],
    ['byte-oversized', '界'.repeat(171)],
  ])('rejects %s model configuration before fetch or provenance exposure', async (_name, model) => {
    setEnv('LLM_API_KEY', 'secret');
    setEnv('LLM_PROVIDER', 'openai');
    setEnv('LLM_MODEL', model);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    expect(getStatus()).toEqual({ available: false, reason: 'invalid-config' });
    expect(() => getCacheIdentity()).toThrow('invalid-model');
    await expect(complete('semantic-edges', 'system', '{}')).rejects.toThrow('invalid-model');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    'http://provider.example/v1',
    'ftp://provider.example/v1',
    'https://user:password@provider.example/v1',
    'file:///tmp/provider',
  ])('rejects unsafe or credential-bearing base URL %s', async (baseUrl) => {
    setEnv('LLM_API_KEY', 'secret');
    setEnv('LLM_PROVIDER', 'openai');
    setEnv('LLM_BASE_URL', baseUrl);
    expect(getStatus()).toEqual({ available: false, reason: 'invalid-config' });
    await expect(complete('semantic-edges', 'system', '{}')).rejects.toThrow('invalid-base-url');
  });

  it.each(['https://trusted.example/v1', 'http://127.0.0.1:11434/v1', 'http://localhost:11434/v1'])(
    'accepts HTTPS and loopback HTTP endpoint %s',
    (baseUrl) => {
      setEnv('LLM_API_KEY', 'secret');
      setEnv('LLM_PROVIDER', 'openai');
      setEnv('LLM_BASE_URL', baseUrl);
      expect(getCacheIdentity().endpoint).toContain(baseUrl.replace(/\/$/, ''));
    },
  );

  it('returns metadata from the same config used for the provider request', async () => {
    setEnv('LLM_API_KEY', 'secret');
    setEnv('LLM_PROVIDER', 'openai');
    setEnv('LLM_MODEL', 'model-before');
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        expect(body.model).toBe('model-before');
        setEnv('LLM_MODEL', 'model-after');
        return Promise.resolve(
          Response.json({ choices: [{ message: { content: '{"edges":[]}' } }] }),
        );
      }),
    );

    const exchange = await completeWithMetadata('semantic-edges', 'system', '{}');
    expect(exchange.output).toBe('{"edges":[]}');
    expect(exchange.identity.model).toBe('model-before');
    expect(exchange.identity.provider).toBe('openai');
    expect(exchange.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('aborts a stalled provider call at the configured bounded timeout', async () => {
    setEnv('LLM_API_KEY', 'secret');
    setEnv('LLM_PROVIDER', 'openai');
    setEnv('LLM_TIMEOUT_MS', '5');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );

    await expect(complete('semantic-edges', 'system', '{}')).rejects.toThrow('provider-timeout');
  });

  it('keeps the timeout active while reading the provider response body', async () => {
    setEnv('LLM_API_KEY', 'secret');
    setEnv('LLM_PROVIDER', 'openai');
    setEnv('LLM_TIMEOUT_MS', '5');
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        const body = new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      }),
    );

    await expect(complete('semantic-edges', 'system', '{}')).rejects.toThrow('provider-timeout');
  });

  it('honors a caller AbortSignal', async () => {
    setEnv('LLM_API_KEY', 'secret');
    setEnv('LLM_PROVIDER', 'openai');
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        if (init?.signal?.aborted) return Promise.reject(new Error('aborted'));
        return Promise.reject(new Error('unexpected'));
      }),
    );

    await expect(complete('semantic-edges', 'system', '{}', controller.signal)).rejects.toThrow(
      'provider-aborted',
    );
  });

  it('rejects oversized provider responses before parsing', async () => {
    setEnv('LLM_API_KEY', 'secret');
    setEnv('LLM_PROVIDER', 'openai');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(128 * 1024 + 1) },
        }),
      ),
    );

    await expect(complete('semantic-edges', 'system', '{}')).rejects.toThrow('response-too-large');
  });

  it('rejects oversized streamed responses without a content-length header', async () => {
    setEnv('LLM_API_KEY', 'secret');
    setEnv('LLM_PROVIDER', 'openai');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('x'.repeat(128 * 1024 + 1), { status: 200 })),
    );

    await expect(complete('semantic-edges', 'system', '{}')).rejects.toThrow('response-too-large');
  });

  it('uses explicit facade purpose for non-empty valid stub results', async () => {
    useStub();
    const request = JSON.stringify({ nodes, existingEdges: [] });
    const edges = JSON.parse(await complete('semantic-edges', 'system', request));
    const summaries = JSON.parse(await complete('node-summaries', 'system', request));
    expect(edges.edges).toEqual([{ src: 'adr:0001', dst: 'feature:F001', verb: 'references' }]);
    expect(summaries.summaries[0]).toMatchObject({ nodeId: 'adr:0001' });
  });
});

describe('vendor confinement', () => {
  it('confines provider-specific tokens to knowledge-llm.ts across the semantic server surface', () => {
    const serverRoot = path.resolve(import.meta.dirname, '../../server');
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(absolute);
        else if (/knowledge.*\.(?:ts|tsx|mts)$/.test(entry.name)) files.push(absolute);
      }
    };
    visit(serverRoot);

    const vendorTokens = ['api.openai.com', 'api.anthropic.com', 'x-api-key'];
    const violations = files.filter((file) => {
      if (file.endsWith(`${path.sep}knowledge-llm.ts`)) return false;
      const source = fs.readFileSync(file, 'utf8');
      return vendorTokens.some((token) => source.includes(token));
    });
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(violations).toEqual([]);
  });
});

describe('versioned prompt hashes', () => {
  it('exports explicit versions and full sha256 hashes', () => {
    expect(SEMANTIC_EDGES_PROMPT_VERSION).toBe('semantic-edges-v1');
    expect(NODE_SUMMARY_PROMPT_VERSION).toBe('node-summary-v1');
    expect(SEMANTIC_EDGES_PROMPT_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(NODE_SUMMARY_PROMPT_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(SEMANTIC_EDGES_PROMPT_HASH).not.toBe(NODE_SUMMARY_PROMPT_HASH);
  });
});

describe('bounded all-or-nothing facades', () => {
  beforeEach(() => useStub());

  it('bounds input node and edge counts and strings before provider invocation', async () => {
    const completeSpy = vi.spyOn(await import('@server/lib/knowledge-llm'), 'complete');
    const tooManyNodes = Array.from({ length: 257 }, (_, index) => ({
      id: `adr:${index}`,
      kind: 'adr',
      title: 'title',
    }));
    const tooManyEdges = Array.from({ length: 513 }, (_, index) => ({
      src: 'adr:0001',
      dst: 'feature:F001',
      verb: `verb-${index}`,
    }));

    await expect(inferSemanticEdges(tooManyNodes, [])).rejects.toThrow();
    await expect(inferSemanticEdges(nodes, tooManyEdges)).rejects.toThrow();
    await expect(
      inferNodeSummaries([{ id: 'adr:1', kind: 'adr', title: 'x'.repeat(513) }]),
    ).rejects.toThrow();
    expect(completeSpy).not.toHaveBeenCalled();
  });

  it('bounds body excerpts before calling the provider', async () => {
    const messages: Record<string, string> = {};
    vi.spyOn(await import('@server/lib/knowledge-llm'), 'complete').mockImplementation(
      async (purpose, _systemPrompt, userMessage) => {
        messages[purpose] = userMessage;
        return purpose === 'semantic-edges'
          ? JSON.stringify({ edges: [] })
          : JSON.stringify({ summaries: [] });
      },
    );
    const longBodyNodes = nodes.map((node) => ({ ...node, body: 'x'.repeat(10_000) }));

    await inferSemanticEdges(longBodyNodes, []);
    await inferNodeSummaries(longBodyNodes);
    const edgeRequest = JSON.parse(messages['semantic-edges']) as {
      nodes: Array<{ body: string }>;
    };
    const summaryRequest = JSON.parse(messages['node-summaries']) as {
      nodes: Array<{ body: string }>;
    };
    expect(edgeRequest.nodes.every((node) => node.body.length === 300)).toBe(true);
    expect(summaryRequest.nodes.every((node) => node.body.length === 600)).toBe(true);
  });

  it('enforces output cardinality in Zod schemas', async () => {
    const manyNodes = Array.from({ length: 32 }, (_, index) => ({
      id: `adr:${index}`,
      kind: 'adr',
      title: `ADR ${index}`,
    }));
    vi.spyOn(await import('@server/lib/knowledge-llm'), 'complete').mockResolvedValueOnce(
      JSON.stringify({
        edges: Array.from({ length: 31 }, (_, index) => ({
          src: 'adr:0',
          dst: `adr:${index + 1}`,
          verb: 'references',
        })),
      }),
    );
    await expect(inferSemanticEdges(manyNodes, [])).rejects.toThrow();

    const summaryNodes = Array.from({ length: 256 }, (_, index) => ({
      id: `wiki:${index}`,
      kind: 'wiki',
      title: `Wiki ${index}`,
    }));
    vi.spyOn(await import('@server/lib/knowledge-llm'), 'complete').mockResolvedValueOnce(
      JSON.stringify({
        summaries: Array.from({ length: 257 }, (_, index) => ({
          nodeId: `wiki:${index % 256}`,
          summary: 'summary',
        })),
      }),
    );
    await expect(inferNodeSummaries(summaryNodes)).rejects.toThrow();
  });

  it.each([
    {
      name: 'unknown node',
      output: { edges: [{ src: 'adr:0001', dst: 'missing:id', verb: 'references' }] },
    },
    {
      name: 'self edge',
      output: { edges: [{ src: 'adr:0001', dst: 'adr:0001', verb: 'references' }] },
    },
    {
      name: 'duplicate edge',
      output: {
        edges: [
          { src: 'adr:0001', dst: 'feature:F001', verb: 'references' },
          { src: 'adr:0001', dst: 'feature:F001', verb: 'references' },
        ],
      },
    },
  ])('fails the whole edge facade for $name references', async ({ output }) => {
    vi.spyOn(await import('@server/lib/knowledge-llm'), 'complete').mockResolvedValueOnce(
      JSON.stringify(output),
    );
    await expect(inferSemanticEdges(nodes, [])).rejects.toThrow();
  });

  it('fails the whole edge facade when the provider repeats an existing edge', async () => {
    vi.spyOn(await import('@server/lib/knowledge-llm'), 'complete').mockResolvedValueOnce(
      JSON.stringify({
        edges: [{ src: 'adr:0001', dst: 'feature:F001', verb: 'describes' }],
      }),
    );
    await expect(
      inferSemanticEdges(nodes, [{ src: 'adr:0001', dst: 'feature:F001', verb: 'describes' }]),
    ).rejects.toThrow('existing-edge-reference');
  });

  it.each([
    {
      summaries: [
        { nodeId: 'adr:0001', summary: 'Valid.' },
        { nodeId: 'missing:id', summary: 'Unknown.' },
      ],
    },
    {
      summaries: [
        { nodeId: 'adr:0001', summary: 'First.' },
        { nodeId: 'adr:0001', summary: 'Duplicate.' },
      ],
    },
  ])('fails the whole summary facade for unknown or duplicate references', async (output) => {
    vi.spyOn(await import('@server/lib/knowledge-llm'), 'complete').mockResolvedValueOnce(
      JSON.stringify(output),
    );
    await expect(inferNodeSummaries(nodes)).rejects.toThrow();
  });
});

describe('KnowledgeLRUCache', () => {
  it('preserves LRU-200 and promotes accessed entries', () => {
    const cache = new KnowledgeLRUCache<string>();
    for (let index = 0; index < 200; index += 1) cache.set(`key-${index}`, `value-${index}`);
    expect(cache.get('key-0')).toBe('value-0');
    cache.set('key-200', 'value-200');
    expect(cache.size).toBe(200);
    expect(cache.get('key-1')).toBeUndefined();
    expect(cache.get('key-0')).toBe('value-0');
  });

  it('shares in-flight work and clears the entry after success', async () => {
    const cache = new KnowledgeLRUCache<string>();
    const fetcher = vi.fn(async () => 'result');
    const [first, second] = await Promise.all([
      cache.getOrFetch('shared', fetcher),
      cache.getOrFetch('shared', fetcher),
    ]);
    expect(first).toBe('result');
    expect(second).toBe('result');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.inflightSize).toBe(0);
  });

  it('caps distinct in-flight requests at 200', async () => {
    const cache = new KnowledgeLRUCache<string>();
    const pending = new Promise<string>(() => undefined);
    for (let index = 0; index < 200; index += 1) {
      void cache.getOrFetch(`key-${index}`, () => pending);
    }
    expect(cache.inflightSize).toBe(200);
    await expect(cache.getOrFetch('overflow', () => pending)).rejects.toThrow(
      'cache-capacity-exceeded',
    );
  });

  it('does not cache rejected work', async () => {
    const cache = new KnowledgeLRUCache<string>();
    await cache
      .getOrFetch('key', async () => Promise.reject(new Error('failure')))
      .catch(() => undefined);
    expect(cache.size).toBe(0);
    expect(cache.inflightSize).toBe(0);
  });
});

describe('validated cache identity and provenance', () => {
  beforeEach(() => useStub());

  it('caches canonical typed results and preserves original provenance on hits', async () => {
    const completeSpy = vi.spyOn(await import('@server/lib/knowledge-llm'), 'complete');
    const first = await inferSemanticEdges(nodes, []);
    const second = await inferSemanticEdges(nodes, []);
    expect(second).toEqual(first);
    expect(second.provenance.timestamp).toBe(first.provenance.timestamp);
    expect(completeSpy).toHaveBeenCalledTimes(1);
  });

  it('partitions cache across provider and endpoint identities', async () => {
    const completeSpy = vi
      .spyOn(await import('@server/lib/knowledge-llm'), 'complete')
      .mockResolvedValue(JSON.stringify({ edges: [] }));

    setEnv('LLM_PROVIDER', 'openai');
    setEnv('LLM_BASE_URL', 'https://one.example/v1');
    await inferSemanticEdges(nodes, []);
    setEnv('LLM_BASE_URL', 'https://two.example/v1');
    await inferSemanticEdges(nodes, []);
    setEnv('LLM_PROVIDER', 'anthropic');
    setEnv('LLM_BASE_URL', 'https://two.example');
    await inferSemanticEdges(nodes, []);

    expect(completeSpy).toHaveBeenCalledTimes(3);
  });

  it('does not poison cache on malformed HTTP-200 output and retries successfully', async () => {
    const completeSpy = vi
      .spyOn(await import('@server/lib/knowledge-llm'), 'complete')
      .mockResolvedValueOnce('not-json')
      .mockResolvedValueOnce(
        JSON.stringify({ edges: [{ src: 'adr:0001', dst: 'feature:F001', verb: 'references' }] }),
      );

    await expect(inferSemanticEdges(nodes, [])).rejects.toThrow('invalid-json');
    const result = await inferSemanticEdges(nodes, []);
    expect(result.items).toHaveLength(1);
    expect(completeSpy).toHaveBeenCalledTimes(2);
    expect(llmCache.size).toBe(1);
  });
});

describe('knowledge semantic router', () => {
  const caller = knowledgeRouter.createCaller({});

  beforeEach(() => {
    process.env.AMBER_REPO_ROOT = SOURCE_ROOT;
  });

  it('returns unavailable without a key and remains a query-only surface', async () => {
    const result = await caller.semantic();
    expect(result).toEqual({ available: false, inferredEdges: [], nodeSummaries: [] });
    const procedures = Object.values(knowledgeRouter._def.procedures);
    expect(procedures.every((procedure) => procedure._def.type === 'query')).toBe(true);
  });

  it('observably performs no filesystem writes during a semantic query', async () => {
    useStub();
    const writeFile = vi.spyOn(fs, 'writeFileSync');
    const appendFile = vi.spyOn(fs, 'appendFileSync');
    const createWriteStream = vi.spyOn(fs, 'createWriteStream');
    const promiseWriteFile = vi.spyOn(fs.promises, 'writeFile');

    const result = await caller.semantic();
    expect(result.available).toBe(true);
    expect(result.inferredEdges.length).toBeGreaterThan(0);
    expect(result.nodeSummaries.length).toBeGreaterThan(0);
    expect(writeFile).not.toHaveBeenCalled();
    expect(appendFile).not.toHaveBeenCalled();
    expect(createWriteStream).not.toHaveBeenCalled();
    expect(promiseWriteFile).not.toHaveBeenCalled();
  });

  it('keeps every document kind semantic-eligible and excludes Code Nodes and their edges (F060)', () => {
    const kinds = [
      'adr',
      'artifact',
      'wiki',
      'knowledge',
      'memory',
      'architecture',
      'feature',
    ] as const;
    const documentNodes = kinds.map((kind) => ({
      id: `${kind}:test`,
      kind,
      layer: 'knowledge' as const,
      title: kind,
      sourcePath: `${kind}.md`,
      body: `${kind} body`,
    }));
    const codeNode = {
      id: 'code:scripts/lib/core/example.js',
      kind: 'code' as const,
      layer: 'implementation' as const,
      title: 'example.js',
      sourcePath: 'scripts/lib/core/example.js',
      body: 'never summarised',
    };
    const edges = [
      { src: 'adr:test', dst: 'feature:test', verb: 'describes', origin: 'deterministic' as const },
      { src: 'feature:test', dst: codeNode.id, verb: 'anchors', origin: 'deterministic' as const },
      { src: codeNode.id, dst: codeNode.id, verb: 'imports', origin: 'deterministic' as const },
    ];

    const selected = selectSemanticInputs([...documentNodes, codeNode], edges);
    expect(selected.edgeNodes.map((node) => node.kind)).toEqual(kinds);
    expect(selected.summaryNodes.map((node) => node.kind)).toEqual(kinds);
    expect(selected.existingEdges).toEqual([
      { src: 'adr:test', dst: 'feature:test', verb: 'describes' },
    ]);
  });

  it('returns bounded stable facade errors without leaking provider details', async () => {
    useStub();
    const promptModule = await import('@server/lib/knowledge-llm-prompts');
    vi.spyOn(promptModule, 'inferSemanticEdges').mockRejectedValueOnce(
      new Error('secret-token https://private.example/'.repeat(100)),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await caller.semantic();
    expect(result.error).toBe('semantic-edges-unavailable');
    expect(result.error?.length).toBeLessThan(64);
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(result.nodeSummaries.length).toBeGreaterThan(0);
  });
});
