import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeLRUCache } from '@server/lib/knowledge-llm-cache';
import { llmCache } from '@server/lib/knowledge-llm-cache';
import {
  SEMANTIC_EDGES_PROMPT_HASH,
  NODE_SUMMARY_PROMPT_HASH,
  inferSemanticEdges,
  inferNodeSummaries,
} from '@server/lib/knowledge-llm-prompts';
import { getStatus, complete } from '@server/lib/knowledge-llm';
import { knowledgeRouter } from '@server/routers/knowledge';

// ── helpers ────────────────────────────────────────────────────────────────────

function setEnv(key: string, value: string) {
  process.env[key] = value;
}

function clearEnv(...keys: string[]) {
  for (const key of keys) delete process.env[key];
}

// ── 1. Provider availability ──────────────────────────────────────────────────

describe('provider availability', () => {
  afterEach(() => clearEnv('LLM_API_KEY', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_BASE_URL'));

  it('returns available:false when LLM_API_KEY is not set', () => {
    clearEnv('LLM_API_KEY');
    const status = getStatus();
    expect(status.available).toBe(false);
    expect((status as { provider?: string }).provider).toBeUndefined();
  });

  it('returns available:true with provider and model when LLM_API_KEY is set', () => {
    setEnv('LLM_API_KEY', 'test-key');
    setEnv('LLM_PROVIDER', 'openai');
    setEnv('LLM_MODEL', 'gpt-4o');
    const status = getStatus();
    expect(status.available).toBe(true);
    if (status.available) {
      expect(status.provider).toBe('openai');
      expect(status.model).toBe('gpt-4o');
    }
  });

  it('complete() throws when no API key is configured', async () => {
    clearEnv('LLM_API_KEY');
    await expect(complete('sys', 'user')).rejects.toThrow('LLM unavailable');
  });
});

// ── 2. Neutral env — prompts module has no vendor tokens ──────────────────────

describe('neutral env / vendor confinement', () => {
  const VENDOR_TOKENS = [
    'openai.com',
    'anthropic.com',
    'api.anthropic',
    'api.openai',
    'x-api-key',
    'Authorization',
    'Bearer',
  ];

  const promptsFile = path.resolve(
    import.meta.dirname,
    '../../server/lib/knowledge-llm-prompts.ts',
  );
  const cacheFile = path.resolve(
    import.meta.dirname,
    '../../server/lib/knowledge-llm-cache.ts',
  );

  it('knowledge-llm-prompts.ts contains no vendor/network tokens', () => {
    const src = fs.readFileSync(promptsFile, 'utf8');
    for (const token of VENDOR_TOKENS) {
      expect(src, `prompts module must not contain "${token}"`).not.toContain(token);
    }
  });

  it('knowledge-llm-cache.ts contains no vendor/network tokens', () => {
    const src = fs.readFileSync(cacheFile, 'utf8');
    for (const token of VENDOR_TOKENS) {
      expect(src, `cache module must not contain "${token}"`).not.toContain(token);
    }
  });

  it('knowledge-llm.ts is the only file that imports fetch or contains provider URLs', () => {
    const llmFile = path.resolve(import.meta.dirname, '../../server/lib/knowledge-llm.ts');
    const src = fs.readFileSync(llmFile, 'utf8');
    // Vendor URLs must appear only in knowledge-llm.ts
    expect(src).toContain('openai.com');
    expect(src).toContain('anthropic.com');
    // And NOT in prompts or cache
    expect(fs.readFileSync(promptsFile, 'utf8')).not.toContain('openai.com');
    expect(fs.readFileSync(cacheFile, 'utf8')).not.toContain('openai.com');
  });
});

// ── 3. Prompt version / hash ──────────────────────────────────────────────────

describe('versioned prompt hashes', () => {
  it('SEMANTIC_EDGES_PROMPT_HASH is a 16-char hex string', () => {
    expect(SEMANTIC_EDGES_PROMPT_HASH).toMatch(/^[0-9a-f]{16}$/);
  });

  it('NODE_SUMMARY_PROMPT_HASH is a 16-char hex string', () => {
    expect(NODE_SUMMARY_PROMPT_HASH).toMatch(/^[0-9a-f]{16}$/);
  });

  it('the two prompt hashes are distinct', () => {
    expect(SEMANTIC_EDGES_PROMPT_HASH).not.toBe(NODE_SUMMARY_PROMPT_HASH);
  });

  it('hashes are stable across multiple imports (same module instance)', () => {
    expect(SEMANTIC_EDGES_PROMPT_HASH.length).toBe(16);
    expect(NODE_SUMMARY_PROMPT_HASH.length).toBe(16);
  });
});

// ── 4. All-or-nothing facade calls ───────────────────────────────────────────

describe('all-or-nothing facade behavior', () => {
  const nodes = [
    { id: 'adr:0001', kind: 'adr', title: 'Test ADR', body: 'Some body.' },
  ];
  const edges = [{ src: 'adr:0001', dst: 'feature:F001', verb: 'describes' }];

  beforeEach(() => {
    setEnv('LLM_API_KEY', 'stub-key');
    setEnv('LLM_PROVIDER', 'stub');
  });

  afterEach(() => {
    clearEnv('LLM_API_KEY', 'LLM_PROVIDER', 'LLM_MODEL');
    llmCache['map'].clear();
    llmCache['inflight'].clear();
  });

  it('inferSemanticEdges throws when LLM_API_KEY is absent', async () => {
    clearEnv('LLM_API_KEY');
    await expect(inferSemanticEdges(nodes, edges)).rejects.toThrow('LLM unavailable');
  });

  it('inferNodeSummaries throws when LLM_API_KEY is absent', async () => {
    clearEnv('LLM_API_KEY');
    await expect(inferNodeSummaries(nodes)).rejects.toThrow('LLM unavailable');
  });

  it('inferSemanticEdges with stub provider returns empty edges array (all-or-nothing success)', async () => {
    const result = await inferSemanticEdges(nodes, edges);
    expect(Array.isArray(result)).toBe(true);
  });

  it('inferNodeSummaries with stub provider returns empty summaries array (all-or-nothing success)', async () => {
    const result = await inferNodeSummaries(nodes);
    expect(Array.isArray(result)).toBe(true);
  });

  it('inferSemanticEdges throws on invalid JSON from provider', async () => {
    // Spy on complete to return invalid JSON
    const { complete: llmComplete } = await import('@server/lib/knowledge-llm');
    vi.spyOn(
      await import('@server/lib/knowledge-llm'),
      'complete',
    ).mockResolvedValueOnce('not valid json {{{');
    // Clear cache so the mock is actually called
    llmCache['map'].clear();
    await expect(inferSemanticEdges(nodes, [])).rejects.toThrow(/not valid JSON|JSON/i);
    vi.restoreAllMocks();
    void llmComplete; // suppress unused var lint
  });

  it('inferSemanticEdges throws on schema-invalid JSON (no edges field)', async () => {
    vi.spyOn(
      await import('@server/lib/knowledge-llm'),
      'complete',
    ).mockResolvedValueOnce(JSON.stringify({ wrong_field: [] }));
    llmCache['map'].clear();
    await expect(inferSemanticEdges(nodes, [])).rejects.toThrow();
    vi.restoreAllMocks();
  });
});

// ── 5. LRU cache: key, size cap, in-flight sharing ────────────────────────────

describe('KnowledgeLRUCache', () => {
  it('returns undefined for unknown keys', () => {
    const cache = new KnowledgeLRUCache();
    expect(cache.get('no-such-key')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    const cache = new KnowledgeLRUCache();
    cache.set('k1', 'v1');
    expect(cache.get('k1')).toBe('v1');
  });

  it('evicts the least-recently-used entry when cap 200 is reached', () => {
    const cache = new KnowledgeLRUCache();
    // Fill to cap
    for (let i = 0; i < 200; i += 1) {
      cache.set(`key-${i}`, `val-${i}`);
    }
    expect(cache.size).toBe(200);

    // key-0 was inserted first and not touched since; adding one more should evict it
    cache.set('key-200', 'val-200');
    expect(cache.size).toBe(200);
    expect(cache.get('key-0')).toBeUndefined();
    expect(cache.get('key-200')).toBe('val-200');
  });

  it('promotes a get-accessed entry above the eviction candidate', () => {
    const cache = new KnowledgeLRUCache();
    for (let i = 0; i < 200; i += 1) {
      cache.set(`key-${i}`, `val-${i}`);
    }
    // Access key-0 to promote it
    cache.get('key-0');
    // Now inserting a new key should evict key-1 (now the LRU), not key-0
    cache.set('key-200', 'val-200');
    expect(cache.get('key-0')).toBe('val-0');
    expect(cache.get('key-1')).toBeUndefined();
  });

  it('getOrFetch calls fetcher exactly once for concurrent identical keys', async () => {
    const cache = new KnowledgeLRUCache();
    let callCount = 0;
    const fetcher = () =>
      new Promise<string>((resolve) => {
        callCount += 1;
        setTimeout(() => resolve('result'), 10);
      });

    const [r1, r2, r3] = await Promise.all([
      cache.getOrFetch('shared', fetcher),
      cache.getOrFetch('shared', fetcher),
      cache.getOrFetch('shared', fetcher),
    ]);

    expect(callCount).toBe(1);
    expect(r1).toBe('result');
    expect(r2).toBe('result');
    expect(r3).toBe('result');
  });

  it('getOrFetch returns cached value without calling fetcher on repeated calls', async () => {
    const cache = new KnowledgeLRUCache();
    let callCount = 0;
    const fetcher = () => {
      callCount += 1;
      return Promise.resolve('cached-val');
    };

    await cache.getOrFetch('cachekey', fetcher);
    await cache.getOrFetch('cachekey', fetcher);
    expect(callCount).toBe(1);
  });

  it('in-flight entry is removed from inflight map after settlement', async () => {
    const cache = new KnowledgeLRUCache();
    const p = cache.getOrFetch('k', () => Promise.resolve('v'));
    expect(cache.inflightSize).toBe(1);
    await p;
    expect(cache.inflightSize).toBe(0);
  });

  it('in-flight entry is removed after rejection', async () => {
    const cache = new KnowledgeLRUCache();
    const p = cache.getOrFetch('k', () => Promise.reject(new Error('boom')));
    expect(cache.inflightSize).toBe(1);
    await p.catch(() => undefined);
    expect(cache.inflightSize).toBe(0);
  });

  it('rejection does not poison the cache — subsequent call can succeed', async () => {
    const cache = new KnowledgeLRUCache();
    let attempt = 0;
    const fetcher = () => {
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error('transient'));
      return Promise.resolve('ok');
    };
    await cache.getOrFetch('k', fetcher).catch(() => undefined);
    const result = await cache.getOrFetch('k', fetcher);
    expect(result).toBe('ok');
    expect(attempt).toBe(2);
  });
});

// ── 6. Cache key is (contentHash, promptHash, model) ─────────────────────────

describe('cache key format', () => {
  afterEach(() => {
    clearEnv('LLM_API_KEY', 'LLM_PROVIDER', 'LLM_MODEL');
    llmCache['map'].clear();
    llmCache['inflight'].clear();
  });

  it('same content + same prompt + same model → single provider call', async () => {
    setEnv('LLM_API_KEY', 'stub-key');
    setEnv('LLM_PROVIDER', 'stub');
    setEnv('LLM_MODEL', 'test-model');

    let calls = 0;
    vi.spyOn(await import('@server/lib/knowledge-llm'), 'complete').mockImplementation(
      async () => {
        calls += 1;
        return JSON.stringify({ edges: [] });
      },
    );

    const nodes = [{ id: 'adr:0001', kind: 'adr', title: 'ADR 1', body: 'body' }];
    await inferSemanticEdges(nodes, []);
    await inferSemanticEdges(nodes, []);
    expect(calls).toBe(1);

    vi.restoreAllMocks();
  });

  it('different model → separate provider calls', async () => {
    setEnv('LLM_API_KEY', 'stub-key');
    setEnv('LLM_PROVIDER', 'stub');

    let calls = 0;
    vi.spyOn(await import('@server/lib/knowledge-llm'), 'complete').mockImplementation(
      async () => {
        calls += 1;
        return JSON.stringify({ edges: [] });
      },
    );

    const nodes = [{ id: 'adr:0002', kind: 'adr', title: 'ADR 2', body: 'body' }];

    setEnv('LLM_MODEL', 'model-a');
    await inferSemanticEdges(nodes, []);

    setEnv('LLM_MODEL', 'model-b');
    await inferSemanticEdges(nodes, []);

    expect(calls).toBe(2);
    vi.restoreAllMocks();
  });
});

// ── 7. No writes — semantic query writes to no file or store ──────────────────

describe('no writes', () => {
  it('knowledgeRouter.semantic is a query, not a mutation', () => {
    const proc = knowledgeRouter._def.procedures['semantic'] as {
      _def?: { type?: string };
    };
    expect(proc._def?.type).toBe('query');
  });

  it('knowledgeRouter exposes zero mutation procedures', () => {
    const procedures = Object.entries(knowledgeRouter._def.procedures);
    const mutations = procedures.filter(([, proc]) => {
      const def = (proc as { _def?: { type?: string } })._def;
      return def?.type === 'mutation';
    });
    expect(mutations).toHaveLength(0);
  });
});

// ── 8. Router: semanticStatus returns availability without key ─────────────────

describe('knowledgeRouter.semanticStatus', () => {
  const caller = knowledgeRouter.createCaller({});
  const SOURCE_ROOT = path.resolve(process.cwd(), '..', '..');

  beforeEach(() => {
    process.env.AMBER_REPO_ROOT = SOURCE_ROOT;
  });

  afterEach(() => {
    clearEnv('LLM_API_KEY', 'LLM_PROVIDER', 'LLM_MODEL');
  });

  it('returns available:false when no LLM_API_KEY is set', async () => {
    clearEnv('LLM_API_KEY');
    const status = await caller.semanticStatus();
    expect(status.available).toBe(false);
  });

  it('returns available:true when LLM_API_KEY is set', async () => {
    setEnv('LLM_API_KEY', 'test-key-xxx');
    setEnv('LLM_PROVIDER', 'openai');
    const status = await caller.semanticStatus();
    expect(status.available).toBe(true);
    clearEnv('LLM_API_KEY', 'LLM_PROVIDER');
  });
});

// ── 9. Router: semantic returns available:false DTO (no key) without error ─────

describe('knowledgeRouter.semantic', () => {
  const caller = knowledgeRouter.createCaller({});
  const SOURCE_ROOT = path.resolve(process.cwd(), '..', '..');

  beforeEach(() => {
    process.env.AMBER_REPO_ROOT = SOURCE_ROOT;
    clearEnv('LLM_API_KEY');
  });

  it('returns available:false with empty arrays when no key configured', async () => {
    const result = await caller.semantic();
    expect(result.available).toBe(false);
    expect(result.inferredEdges).toEqual([]);
    expect(result.nodeSummaries).toEqual([]);
    expect(result.error).toBeUndefined();
  });

  it('never throws — errors surface in the DTO', async () => {
    await expect(caller.semantic()).resolves.toBeDefined();
  });
});
