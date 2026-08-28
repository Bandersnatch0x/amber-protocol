# REQ-15 — 缓存契约六属性 + QA 永不缓存

> "Cache: in-process memory only, keyed `(source content hash, promptHash, model)`, no TTL, in-flight request sharing, LRU cap 200, cleared on restart. Cited QA is never cached."
> — F059 spec L117-118

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

逐项：① 介质为进程内内存（无文件/无外部缓存服务）；② 键含三组件（内容哈希、promptHash、model）；③ 无 TTL 过期逻辑；④ 相同键的并发请求共享同一在途 Promise；⑤ LRU 淘汰、容量 200；⑥ 重启即清空；⑦ cited QA 路径完全绕开缓存。

---

## Where enforcement lives

实现全部在 `apps/web/server/lib/knowledge-llm-cache.ts`（65 行，**零 import**——不可能触达 fs/网络/外部存储）：

```ts
const LRU_CAP = 200;                                   // L1
class KnowledgeLRUCache<T = unknown> {
  private readonly map = new Map<string, T>();         // L4  ← ① 内存介质
  private readonly inflight = new Map<string, Promise<T>>(); // L5
  get(key) { ...delete+set 重插... }                   // L7-13  ← LRU 触达提升
  set(key, value) { ...size>=LRU_CAP 时删最老键... }    // L15-23 ← ⑤ LRU 200
  async getOrFetch(key, fetcher) { ...inflight 复用... } // L25-47 ← ④ 在途共享
  clear() { ... }                                      // L49-52
}
export const llmCache = new KnowledgeLRUCache();       // L63 ← 模块级单例 → ⑥ 重启即清
```

- **① 内存介质 / ⑥ 重启清空**：类内只有两个 `Map`；文件无任何导入、无序列化/反序列化路径 → 进程退出即消失，无热恢复。
- **② 键**（`knowledge-llm-prompts.ts:156-164`）：`JSON.stringify([provider, endpoint, model, promptHash, contentHash])`——规格三组件全部在键内：`contentHash`（L236/L254：`sha256Hex(canonicalJson(JSON.stringify(request)))`，请求含 nodes+existingEdges 即"source content hash"）、`promptHash`、`model`；另加 `provider`、`endpoint` 两个组件（超集，见下）。
- **③ 无 TTL**：全文件无时间戳、无 `setTimeout`、无过期字段（grep `TTL|expire|Date.now` 于该文件 → 0 hits）。缓存命中返回首次结果连同首次 provenance timestamp（`knowledge-llm.test.ts:448-455` 断言 hit 的 timestamp 与首次全等——反证无按时失效）。
- **④ 在途共享**：L29-30 命中 inflight 直接返回同一 Promise；成功后 set + 清 inflight（L33-38），失败只清 inflight 不落缓存（L39-42）。测试 L410-421：两并发同键请求 fetcher 只执行 1 次。
- **⑤ LRU cap 200**：L18-21 满 200 淘汰 `map.keys().next().value`（Map 插入序最老），get 重插实现触达提升（L10-12）。测试 L400-408：填满 200 → 触达 key-0 → 插入 key-200 → size 仍 200、key-1 被逐、key-0 存活。另有在途请求数同样封顶 200（L31 `cache-capacity-exceeded`，测试 L423-433）——规格未要求的额外防浪涌界。
- **⑦ QA 永不缓存**：`knowledge-qa.ts` 全文件不导入 `knowledge-llm-cache`（grep `llmCache` → 命中仅 prompts/cache/两测试文件）；`answerKnowledgeQuestion` L223 直调 `completeWithMetadata`。测试 `knowledge-qa.test.ts:248-284`：同一问题连问两次，provider spy 恰被调 2 次，且 `llmCache.size === 0`、`inflightSize === 0`（L282-283）——用例标题即 "uses one stateless uncached exchange per ask"。

消费面唯一：`getOrFetch` 的生产调用点仅 `knowledge-llm-prompts.ts:239,257`（两个可缓存 facade）；无第二个缓存实例被生产代码使用。

本次核查实跑 `knowledge-llm.test.ts` + `knowledge-qa.test.ts`，上述断言全部通过。

---

## Paths walked

- ✓ 冷读路径：miss → inflight 登记 → fetch → set → 返回。
- ✓ 热读路径：hit → LRU 重插 → 返回缓存值（provider 零调用，测试 L448-455）。
- ✓ 并发同键路径：第二请求拿到同一 Promise（L29-30）。
- ✓ 失败路径：reject → inflight 清除、缓存零写入（L39-42，测试 L435-442、L474-487 无毒化）。
- ✓ 溢出路径：第 201 个键逐最老（L18-21）；第 201 个在途抛 `cache-capacity-exceeded`（L31）。
- ✓ QA 路径：完全不经 `llmCache`（导入面 0）。
- ✓ 持久化路径（不可达）：文件零 import；REQ-14 已证 semantic query 全程零 fs 写。

---

## Searched

- `llmCache|KnowledgeLRUCache` 全仓 → 4 文件：cache 本体、prompts（唯一生产消费者）、两个测试。`knowledge-qa.ts` 0 命中 = QA 不缓存的结构性证据。
- `TTL|expiresAt|Date.now|setTimeout` in `knowledge-llm-cache.ts` → 0 hits。
- `redis|memcach|fs\.` in `knowledge-llm-cache.ts` → 0 hits（无外部介质）。
- `getOrFetch` in `apps/web`（排除测试）→ 仅 prompts L239/L257。

---

## How the verdict was reached

六属性 + QA 豁免逐一有实现行号与实跑通过的针对性测试，无失守路径，故不是 partial。键的实际形态是规格三元组的**超集**（多出 provider、endpoint 两组件，`knowledge-llm-prompts.ts:158-164`；`knowledge-llm.test.ts:457-472` 专门测试跨 provider/endpoint 的缓存分区）：三个规格组件全部在键中，附加组件只会使缓存更保守（避免跨供应商/端点串用结果），不削弱任何规格意图，且规格未使用 "keyed exactly by" 措辞——故判 implemented 并把加严记录在此，而非 stronger-than-spec（该 verdict 留给整条需求语义被超越的情形；此处仅键组件超集与在途 200 上限两处局部加严）。

---

## Open questions

- 缓存键的 provider/endpoint 附加组件与在途请求 200 上限均未见于 spec 或 `docs/research/f059-knowledge-map-review.md`（grep "endpoint|cache key" → 0 hits）。属未记录的局部加严，建议补记到 spec 或评审文档。
