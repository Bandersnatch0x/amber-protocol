# REQ-13 — Prompt 版本化常量 + sha256，hash 进缓存键

> "Prompts are versioned constants with sha256 hashes; the hash is the cache key component."
> — F059 spec L113

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 每个 prompt 是带显式版本号的常量（非运行时拼接的动态文本）。
2. 每个 prompt 有 sha256 哈希。
3. 该哈希是缓存键的组成部分（prompt 变更即缓存失效）。

---

## Where enforcement lives

**版本化常量 + sha256**（`apps/web/server/lib/knowledge-llm-prompts.ts:12-53`）：

```ts
export const SEMANTIC_EDGES_PROMPT_VERSION = 'semantic-edges-v1';
export const NODE_SUMMARY_PROMPT_VERSION = 'node-summary-v1';
const SEMANTIC_EDGES_PROMPT = `You are a knowledge-graph analyst. ...`.trim();   // L15-31
const NODE_SUMMARY_PROMPT = `You are a concise technical writer. ...`.trim();    // L33-40
function hashPrompt(version: string, prompt: string): string {
  return sha256Hex(`${version}\0${prompt}`);                                     // L42-44
}
export const SEMANTIC_EDGES_PROMPT_HASH = hashPrompt(...);                       // L46-49
export const NODE_SUMMARY_PROMPT_HASH = hashPrompt(...);                         // L50-53
```

第三个 prompt（cited QA）在 `apps/web/server/lib/knowledge-qa.ts:16-30`：

```ts
export const CITED_QA_PROMPT_VERSION = 'cited-qa-v1';
export const CITED_QA_PROMPT = `You answer questions only from ...`.trim();
export const CITED_QA_PROMPT_HASH = sha256Hex(`${CITED_QA_PROMPT_VERSION}\0${CITED_QA_PROMPT}`);
```

三个 prompt 全部为模块级 `const`，版本号显式（`*-v1`），哈希把版本与文本一起纳入（`version\0prompt`）——改文本或改版本都会改变哈希。`sha256Hex` 来自 CLI 共享库 `scripts/lib/web-adapter.js:34,471`（`core/context-hash`），真 sha256（`knowledge-qa.test.ts:112-117` 用 `crypto.createHash('sha256')` 独立复算比对）。

**hash 进缓存键**（`knowledge-llm-prompts.ts:149-172`，`cacheIdentity`）：

```ts
key: JSON.stringify([identity.provider, identity.endpoint, identity.model,
  promptHash, contentHash]),
```

两个缓存型 facade 各以自身 prompt hash 作键组件：`inferSemanticEdges` L237 传 `SEMANTIC_EDGES_PROMPT_HASH`，`inferNodeSummaries` L255 传 `NODE_SUMMARY_PROMPT_HASH`，随后 L239/L257 以该 key 进 `llmCache.getOrFetch`。

**hash 进 provenance**：三个 facade 的响应 provenance 均携带 `promptHash`（prompts L165-171；qa L237-243）——前端 tooltip 可见（`KnowledgeMapPage.tsx:593`）。

**测试锚定**（`knowledge-llm.test.ts:251-258`）：断言两个版本号字面量、两个 hash 匹配 `/^[0-9a-f]{64}$/` 且互不相等；`knowledge-qa.test.ts:116-117` 对 QA 版本与 hash 同样断言。本次核查实跑通过。

---

## Paths walked

- ✓ semantic-edges 路径：常量 → hash → cacheIdentity(L237) → 缓存键。
- ✓ node-summaries 路径：常量 → hash → cacheIdentity(L255) → 缓存键。
- ✓ cited-qa 路径：常量 → hash → provenance（L241）。QA 无缓存（REQ-15 规定 "Cited QA is never cached"），故"hash 是缓存键组件"对 QA 无缓存键可言——hash 仍存在且进 provenance，两条规格互洽。
- ✓ prompt 变更失效路径：hash 由 `version\0prompt` 派生，任一变化 → 新键 → 旧缓存条目不再命中（无键碰撞路径）。
- ✓ 动态 prompt 路径（不可达）：`complete(purpose, systemPrompt, ...)` 的 systemPrompt 实参在三个 facade 调用点均为上述常量（prompts L240/L258，qa L223），无插值。

---

## Searched

- `PROMPT_VERSION|PROMPT_HASH` in `apps/web` → 定义于 prompts L12-13/L46-53 与 qa L16/L30；消费于 facade、provenance 与三个测试文件；无未版本化的第四个 prompt。
- `sha256Hex` in `apps/web/server` → prompts L7-8、qa L11-12 两处导入，均来自 CLI 共享 `web-adapter`。
- `` `You ``（prompt 字面量起始）in `apps/web/server` → 3 hits，恰为三个常量；无游离 prompt 文本。

---

## How the verdict was reached

不是 partial：三个 prompt 全部满足"版本化常量 + sha256"；两个可缓存 facade 的键均含 promptHash（L158-164 数组第 4 元）。不是 undecidable：规格单句三断言均可落到行号。QA prompt 的 hash 不进缓存键是 REQ-15 "never cached" 的直接推论，不构成本条的失守。

---

## Open questions

- 无。
