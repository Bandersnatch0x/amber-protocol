# REQ-14 — 推断产物带 provenance 标注与虚线/badge；绝不落盘

> "Inferred edges and summaries render with provenance labels (model, timestamp) and visually distinct treatment (dashed styling, inferred badges). They are never written to any store, projection, or hash chain."
> — F059 spec L114-116

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

前端：推断边与摘要必须（1）携带并渲染 provenance（model、timestamp）；（2）视觉可区分——虚线样式、inferred badge。
服务端：推断产物只能存在于响应/内存中——不得写入任何持久 store、projection 输入或 hash chain。

---

## Where enforcement lives

### 前端渲染（标注 + 视觉区分）

**DTO 强制携带 provenance**：`knowledge-dto.ts:23`（边 `provenance?: { provider; model; timestamp; promptHash }`）、L52-62（`NodeSummaryDTO` 的 provenance 为必填 + `origin: 'inferred'`）；router 在映射时逐条附上 facade provenance 并强制 `origin: 'inferred'`（`routers/knowledge.ts:100-104, 112-115`）。

**虚线**（`KnowledgeMapPage.tsx`）：
- 主画布边：L507 `className: 'knowledge-edge-inferred'`、L512 `strokeDasharray: e.origin === 'inferred' ? '6 4' : undefined`；
- 迷你上下文图：L346 `strokeDasharray={it.inferred ? '4 3' : undefined}`；
- 图例：L1297-1302 实线 deterministic / 虚线 inferred 对照（i18n `knowledge.legend.deterministic/inferred`，i18n.tsx:45-46）。

**inferred badge / 标签**：
- 边行（L590-597）：`{t('knowledge.inferredLabel')} ({edge.provenance?.provider}/{edge.provenance?.model})`，且 title tooltip 完整携带 `inferred · provider/model · prompt <promptHash> · <timestamp>`（L593）；
- 摘要（L1374-1398）：`data-testid="inferred-summary"`，badge `t('knowledge.semantic.badge')`（= 'inferred'/'推断'，i18n.tsx:94/1093），provenance 行 `t('knowledge.summary.provenance', {provider, model, timestamp})`（= 'inferred by {provider}/{model} · {timestamp}'，i18n.tsx:97）。

**E2E**（`knowledge.spec.ts:404-433`）：断言推断边 path 的 style 匹配 `stroke-dasharray: 6, 4`、详情面板含 `inferred (stub/stub-e2e)`、`inferred-summary` 区含摘要与 provenance 文案。

### 服务端"never written"

**数据流封闭**：facade 结果的唯一出口是 tRPC 响应对象（`routers/knowledge.ts:122-128` return；前端合并注释 L1014 "client-side only; never feeds back into DTO"，`mergedDto` 仅 useMemo 内存合成 L1015-1018）。

**写路径全量排查**：
- grep `writeFile|appendFile|createWriteStream|mkdir|renameSync|rmSync|unlink` 于 `apps/web/server` → 命中仅 `services/evidence-jobs.ts`、`lib/gate-reader.ts:222`、`lib/lens-store.ts`、`lib/regression-evidence.ts`、`lib/runner-ack.ts`、`lib/session-audit-writer.ts`、`lib/session-writer.ts`——**零命中于任何 `knowledge-*` 文件**。
- 消费面封闭：grep `inferSemanticEdges|inferNodeSummaries|completeWithMetadata` → 生产代码仅 `routers/knowledge.ts` 与两个 facade 模块自身；上述任何写盘模块均不导入推断产物。
- 运行时断言：`knowledge-llm.test.ts:504-519` 在完整 semantic query 期间 spy `fs.writeFileSync/appendFileSync/createWriteStream/fs.promises.writeFile`，断言零调用（"observably performs no filesystem writes during a semantic query"）；`knowledge-qa.test.ts:286-299` 对 ask 同样断言。本次核查实跑通过。

**projection / hash chain 隔离**：
- 确定性解析器永不产出 inferred：`scripts/lib/core/knowledge-graph.js:57` `const PROVENANCE = "deterministic"`，节点 L112、边 L386 一律该常量；L41 注释明言 "inferred" is reserved for the web read-time semantic layer。projection/语料写入点（`scripts/lib/core/knowledge-projection.js:269-270`、`scripts/lib/knowledge-commands.js:94-95` 人审样本报告）只消费该确定性解析器与 ADR-0009 管道，与 web facade 无导入关系（scripts/ 目录 grep `knowledge-llm` → 0 hits）。
- hash chain 写入器（`session-audit-writer.ts:276,295` 等 `.amber` ledger）不导入任何 knowledge LLM 符号。
- 反向防护：QA 上下文只收 `origin === 'deterministic'` 边（`knowledge-qa.ts:97,141`），推断产物连"再进入 LLM 上下文"的路径都被封死（`knowledge-qa.test.ts:134` 断言 context 不含 `"origin":"inferred"`）。

---

## Paths walked

- ✓ 推断边渲染路径：semantic query → router 附 provenance/origin → mergedDto → FlowCanvas 虚线 + EdgeRow 标签。
- ✓ 推断摘要渲染路径：summaryByNodeId（L1024-1027）→ 详情面板 badge + provenance 行。
- ✓ 迷你图路径：`inferred: e.origin === 'inferred'`（L274,283）→ 虚线。
- ✓ 服务端写路径（不可达）：semantic/ask 全链路 fs 写 spy 为零；knowledge 模块无写 API 导入。
- ✓ projection 摄入路径（不可达）：解析器 PROVENANCE 常量硬编码 deterministic；graph-reader 仅白名单转换 origin（`knowledge-graph-reader.ts:68,96-98`，未知 provenance 直接 throw）。
- ✗→✓ 边的 timestamp 可见性：边行的可见文本只含 provider/model，timestamp 与 promptHash 在 hover title（L593）中呈现；摘要的 timestamp 直接可见（L1392-1394）。规格要求 "render with provenance labels (model, timestamp)"——timestamp 经 tooltip 渲染成立，粒度弱于摘要，记入 Open questions。

---

## Searched

- fs 写调用 in `apps/web/server` → 20 hits / 7 文件，0 个 knowledge 文件（清单见上）。
- `localStorage|sessionStorage|indexedDB` in `KnowledgeMapPage.tsx` → 0 hits（客户端也无持久化）。
- `knowledge-llm` in `scripts/` → 0 hits（CLI/projection 侧无从触达推断产物）。
- `PROVENANCE` in `scripts/lib/core/knowledge-graph.js` → L57 定义 "deterministic"，L112/L386 使用；无 "inferred" 赋值点。

---

## How the verdict was reached

不是 partial：渲染侧四处视觉区分（主画布/迷你图/边行/摘要）+ 图例齐备并有 E2E 钉住；落盘侧由"写 API 零命中 + 消费面封闭 + 运行时 spy 断言 + 解析器常量"四层独立证据封闭，不存在推断产物到达 store/projection/hash chain 的任何 import 链。不是 contradicted / absent：正反两向均有命中证据。

---

## Open questions

- 推断**边**的 timestamp 只在 hover tooltip（title 属性）中渲染，非常驻可见文本（摘要则常驻可见）。规格 "provenance labels (model, timestamp)" 未规定呈现形态，tooltip 是否算合格的 "label" 属呈现粒度判断，建议产品侧确认。
