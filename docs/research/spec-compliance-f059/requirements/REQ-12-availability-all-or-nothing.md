# REQ-12 — 无 key 报 available:false；facade 级 all-or-nothing

> "No key configured → the provider reports `available: false`; the deterministic layer renders with zero LLM dependency. Provider failure is all-or-nothing per facade call: no half-rendered inferred edges."
> — F059 spec L110-112

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 未配置 key 时 provider 状态必须是 `available: false`（而非报错/崩溃）。
2. 确定性层（图、面板）在零 LLM 配置下完整渲染，不发起任何 LLM 调用。
3. 单次 facade 调用要么产出全量已验证结果，要么整体失败——不得出现"渲染了一半的推断边"。

---

## Where enforcement lives

**available: false**（`apps/web/server/lib/knowledge-llm.ts:119-127`）：

```ts
export function getStatus(): LLMStatusResult {
  if (!process.env.LLM_API_KEY) return { available: false, reason: 'not-configured' };
  try { ... return { available: true, provider, model }; }
  catch { return { available: false, reason: 'invalid-config' }; }
}
```

`routers/knowledge.ts:67-70`（semantic）与 L134-136（ask）在入口先查 `getStatus()`：无 key 时 semantic 返回 `{available:false, inferredEdges:[], nodeSummaries:[]}`，ask 返回 `{status:'unavailable', reason}`——两者都不触达图读取或 provider。测试：`knowledge-llm.test.ts:62-64`（getStatus）、L497-502（router semantic）、`knowledge-qa.test.ts:234-246`（ask）。

**确定性层零 LLM 依赖**：
- `knowledge.graph`（`routers/knowledge.ts:57-59`）与 `knowledge.recentChanges`（L60）不导入、不调用任何 `knowledge-llm*` 符号（该文件对 LLM 的唯一导入是 L6-7 的 getStatus/两 facade，只被 semantic/ask 使用）。
- 前端：`semanticQuery` 带 `enabled: semanticRequested && semanticStatusQuery.data?.available === true`（`KnowledgeMapPage.tsx:891-897`）——无 key 时该 query 永不发出；地图/面板由 `graph`+`recentChanges` 独立渲染。
- E2E `knowledge.spec.ts:353-384`：无 provider 场景下计数 `/knowledge.semantic?` 请求恒为 0（L367），地图正常渲染，banner 显示 not-configured 文案，"Run" 披露区不出现（L383）。

**per-facade all-or-nothing**：
- 校验器整体拒绝：`validateSemanticEdges`（`knowledge-llm-prompts.ts:192-212`）对未知节点引用/自环/与既有边重复/输出内重复一律 `throw`——任何一条坏边使整个 facade 调用失败，零边落地；`validateSummaries`（L214-225）同理。测试 `knowledge-llm.test.ts:342-396` 逐场景断言 "fails the whole edge facade / whole summary facade"。
- 失败不入缓存：`KnowledgeLRUCache.getOrFetch` 的 reject 分支只清 inflight、不 set（`knowledge-llm-cache.ts:39-42`）；`knowledge-llm.test.ts:435-442`、L474-487（坏 JSON 不毒化缓存，重试成功）。
- router 侧按 facade 汇总（`routers/knowledge.ts:92-120`）：`Promise.allSettled` 两个 facade 各自独立；rejected 的 facade 对应数组保持 `[]` 并追加错误码（L105-108, L117-119）——不存在把部分边混入的路径。edges facade 失败时 summaries 照常返回（`knowledge-llm.test.ts:545-558` 断言 error 码稳定且 `nodeSummaries.length > 0`），符合规格"per facade call"的粒度（失败以单个 facade 为单位，另一 facade 不连坐）。
- E2E `knowledge.spec.ts:438-453`：semantic 传输失败时确定性图保持可见。
- 本次核查实跑上述服务端测试全部通过。

---

## Paths walked

- ✓ 无 key → not-configured 路径（getStatus L120；semantic L67-70；ask L134-136；前端 enabled 门 L896）。
- ✓ 有 key 但配置非法 → invalid-config 路径（getStatus L124-126；前端 `knowledge.semantic.invalidConfig` 分支 L1113-1123）。
- ✓ provider HTTP 失败/超时/超限 → `KnowledgeLLMError`（knowledge-llm.ts:247-256）→ facade reject → router 记 `*-unavailable` 错误码。
- ✓ provider 返回坏 JSON / 坏引用 → 校验器 throw → 整体失败、缓存零写入。
- ✓ 双 facade 一败一成路径：allSettled 隔离（L92-95），无交叉污染。
- ✓ 图读取失败路径：semantic 返回 `error: 'graph-unavailable'` 且空数组（L73-83）——同样无半渲染。

---

## Searched

- `available: false` in `apps/web/server` → knowledge-llm.ts:10,120,125 与 router L69；语义一致。
- `allSettled` in `routers/knowledge.ts` → 1 hit（L92），facade 隔离的唯一汇聚点。
- `slice|filter` 对 facade 输出的部分采纳 → `routers/knowledge.ts:98-120` 仅整组 map，无部分截取。

---

## How the verdict was reached

不是 partial：三个子性质（状态上报/零依赖渲染/整体失败）各有服务端实现点、单测与 E2E；"半渲染"唯一可能来源（校验通过一部分、丢弃另一部分）被校验器的 throw-on-first-violation 设计排除（L200-207 循环内任一违规即 throw）。不是 contradicted：无任何吞错后返回部分边的代码路径。不是 stronger-than-spec：failure 隔离粒度与规格措辞"per facade call"一致。

---

## Open questions

- 无。
