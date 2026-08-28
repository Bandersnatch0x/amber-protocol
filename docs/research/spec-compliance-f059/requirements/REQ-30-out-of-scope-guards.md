# REQ-30 — Out of Scope 负向守卫（六条排除项）

> "- LLM products written to any persistent store (context pages, projections, hash chain) — the
>   semantic layer is always read-time computation.
> - LLM authoring of deterministic edges: file-evidence edges always come from deterministic parsing.
> - Code-level architecture auto-analysis (tree-sitter / source dependency graphs).
> - The governance object graph (sessions, routes, gates) as map content.
> - Any new web mutation whitelist entry.
> - Multi-turn QA conversation, answer streaming, or answer persistence."
>
> — F059 spec L174-182（Out of Scope 全节）

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

负向需求：代码**不得**包含六类行为。核查方式以 Searched（模式→命中）为主，辅以关键文件通读。发现任一越界即 contradicted。

---

## Where enforcement lives

**① LLM 产物零持久化 — 未越界**

- 缓存为进程内 `Map`：`apps/web/server/lib/knowledge-llm-cache.ts:1-64`（`KnowledgeLRUCache`，LRU_CAP 200，无任何 I/O import）。
- QA 结果只作为响应对象返回：`knowledge-qa.ts:216-244`（`answerKnowledgeQuestion` 不触 llmCache、不触 fs）；测试 `tests/server/knowledge-qa.test.ts:248` "uses one stateless uncached exchange per ask"。
- 客户端合并推断边仅在 `useMemo` 内存中：`KnowledgeMapPage.tsx:1014-1018`，代码注释原文 "client-side only; never feeds back into DTO"；页面无 localStorage 使用。
- provider 适配层只发 HTTP 读响应：`knowledge-llm.ts` 全文无 fs import。

**② LLM 不作者确定性边 — 未越界**

- 推断门面输出被 router 强制打标：`server/routers/knowledge.ts:100-104` `origin: 'inferred' as const`（summaries 同 :112-116）。
- 确定性流唯一来源是 CLI 解析器：`knowledge-graph-reader.ts:121-130`（`buildKnowledgeGraph`）；provenance 越界即抛错 fail-closed（:96-98）。
- 解析器侧声明：`scripts/lib/core/knowledge-graph.js:42` 注释原文 "read-time LLM layer, which never enters this stream"。
- QA 上下文只收确定性边：`knowledge-qa.ts:97` `edges.filter((edge) => edge.origin === 'deterministic')`。

**③ 无 tree-sitter/源码依赖分析 — 未越界**

解析器数据源为 markdown（ADR/wiki/memory/architecture）、`feature_list.json`、`.amber/artifacts/`（knowledge-graph.js:280, :296）；节点 kind 白名单不含代码文件（knowledge-graph-reader.ts:52-60），与 spec L79-80 "Code files are not nodes" 一致。

**④ 治理对象图不进地图内容 — 未越界**

- 地图内容（nodes/edges）kind 固定 7 种：`knowledge-dto.ts:5`（adr/artifact/wiki/knowledge/memory/architecture/feature）；reader 白名单校验 :52-60，未知 kind 抛错。
- sessions/gates/transcripts/routes 仅出现在 Recent 面板的**跳转链接校验**：`knowledge-recent.ts:392-400`（`LiveLinkSources` 用于 `attachVerifiedLink` :342-365），不生成任何节点或边；详情面板的 `KIND_LOCAL_TARGET` 跳链（KnowledgeMapPage.tsx:158-165）是 spec User Story 4（L47-48）明确要求的导航，不属地图内容。

**⑤ 无新 mutation whitelist 条目 — 未越界**

- knowledge router 四个 procedure 全为 `.query`：`server/routers/knowledge.ts:56-165`（graph/recentChanges/semanticStatus/semantic/ask），零 `.mutation`。
- ADR-0007 允许表仍为五项（session.start/pause/resume/abort、runVerification），无 knowledge 行：`docs/adr/0007-web-viewer-role.md:44-52`。
- 回归测试双保险：`tests/server/knowledge-router.test.ts:45-52`（"exposes zero mutation procedures"）、`tests/server/knowledge-qa.test.ts:241-245`（每个 procedure `_def.type === 'query'`）。

**⑥ 无多轮/流式/答案持久化 — 未越界**

- 输入 schema 仅 `{question, focusNodeId?, allowExternal}`：`knowledge.ts:23-44`——无 history/conversation/messages 字段，无会话 id。
- 每次 ask 恰好一次 provider 交换：`knowledge-qa.ts:223`（单次 `completeWithMetadata`）。
- 无流式：knowledge 相关文件零 subscription/EventSource/event-stream 命中；provider 响应经 `readBoundedResponse` 全量缓冲后一次性返回（`knowledge-llm.ts:262-295`），非向客户端转发流。
- 客户端 `staleTime: 0, gcTime: 0`（KnowledgeMapPage.tsx:1005-1012），答案不留缓存。

---

## Paths walked

- semantic 门面走缓存路径（`llmCache.getOrFetch`，knowledge-llm-prompts.ts:239, :257）→ 内存 Map，无落盘 ✓
- ask 路径绕过缓存（knowledge-qa.ts:216-244 无 llmCache 引用）✓
- graph read 失败路径（knowledge.ts:73-83, :139-147）→ 仅 console.warn 事件名 + 类型化错误，无写盘 ✓
- 推断边进入客户端主图路径（mergedDto useMemo）→ 不回流任何 query input ✓
- Recent 面板触 sessions/gates/routes 路径 → 只读列表做 id 校验，产物是 linkTo/linkId 属性，非节点 ✗（不进地图内容）
- e2e 语义 stub 路径（package.json:14 `AMBER_E2E_SEMANTIC_STUB`）→ stub 在 knowledge-llm.ts:172-233 内存构造 ✓

---

## Searched（负向核查主体）

- `writeFile|appendFile|createWriteStream`（apps/web/server，glob `**/knowledge*`）→ **0 命中**。
- `writeFile|appendFile|mkdir|createWriteStream|unlink|rename|LLM|llm`（scripts/lib/core/knowledge-graph.js）→ 无写 API 命中；LLM 仅 :42 的排除性注释。
- knowledge-recent.ts 的 `fs` 使用 → `readFileSync`（:203, :235）、`readdirSync`（:226），全为读。
- `tree-sitter|treesitter`（apps/web 全仓；scripts/ 全目录，忽略大小写）→ **0 命中**。
- `subscription|event-stream|EventSource`（apps/web，glob `**/knowledge*`）→ **0 命中**。
- `whitelist|mutation`（apps/web/server，忽略大小写）→ `.mutation(` 命中仅 gate.ts:164/:182/:331、lifecycle.ts:114、session-control.ts:339/:390/:413/:445、transcript.ts:37/:48——全部为既有非 knowledge router，F059 触及的 knowledge* 文件零命中。
- `session|route|gate|\.amber`（knowledge-graph.js）→ 命中仅 `.amber/artifacts/`（:280, :296，artifact:* 节点属 spec L78-79 决策层本体）。
- `cache`（QA 路径）→ answerKnowledgeQuestion 无 llmCache 引用；对照 spec L118 "Cited QA is never cached" 成立。

---

## How the verdict was reached

六条排除项逐条以"模式搜索 0 命中 + 关键文件通读 + 既有回归测试"三源交叉验证：无 LLM 产物落盘路径、确定性流有 fail-closed 打标校验、无代码分析依赖、地图内容 kind 白名单不含治理对象、knowledge router 零 mutation 且 ADR-0007 允许表未增行、QA 单轮无流式无持久化。负向需求全部确认不含被排除行为 → implemented。

---

## Open questions

1. Out-of-scope 第一条与 Solution 4 的边界解读：ADR-0009 蒸馏管线确实会产出持久 context pages（spec L119-121 明确授权，人审 manifest），本记录按 spec 自身口径（"the **semantic layer** is always read-time computation"）把蒸馏归入确定性层数据源工程、不判越界——该管线本身的 LLM 使用是否越界属 spec 解释问题，留给规格作者确认。
2. gate.ts/transcript.ts 的既有 mutations 超出 ADR-0007 决策表五项（表列于 :44-52，gate/transcript mutations 由后续修正案背书与否未在本核查范围内验证）——与 F059 无关（非 knowledge 文件），但若做全仓 whitelist 审计需另行核对。
3. `console.warn` 输出（knowledge.ts:76/:106/:118/:142/:158）仅含固定事件名、不含模型输出内容；若部署环境将 stdout 落盘归档，日志中也不会出现 LLM 产物——按"代码不写持久存储"口径判定通过，运行时日志采集策略需运维侧确认。
