# F059 Spec-to-Code Compliance Report

- 日期：2026-08-28
- 规格：`docs/specs/F059-knowledge-decision-map.md`（196 行，拆为 30 条可单独核查需求）
- 方法：5 个域 checker（独立上下文，逐条走 enforcement/Paths/Searched 纪律）→ 3 条分歧交 2 个未参与发现的反驳代理（一个重读代码、一个重读规格），任一方推翻即剔除
- 逐需求记录：`requirements/REQ-01…REQ-30`（与本报告同目录；每条含 verdict、逐字引用、Paths walked、Searched 留痕）
- 交叉参照：运行时/渲染层审计另见 `docs/research/f059-knowledge-map-review.md`（本报告只裁规格符合性）

## 总裁定

**30 条需求：28 implemented · 2 partial（均为轻微）· 0 contradicted · 0 absent · 0 undecidable。**
F059 的实现完成度非常高；两条存活分歧都是 P2 级润色项。

## 裁定表

| REQ | 需求 | Verdict | 置信 | 一句话依据 |
| --- | --- | --- | --- | --- |
| 01 | CLI/web 共享解析器，不 per-request spawn | implemented | high | 单源 `knowledge-graph.js`，`web-adapter.js:L33/L469` re-export，进程内加载；0 处 spawn |
| 02 | 三层 ontology / 六 kind / artifact identity 粒度 | implemented | high | `knowledge-graph.js:L738-806` + schema enum 封死；43/43 contextPage 合并 |
| 03 | 恰四 verb、declarer→declared、anchors 非边 | implemented | high | `EDGE_VERBS L58` + 常量动词调用点；`"anchors"` 作动词全仓 0 命中 |
| 04 | dead-anchor drift 附着节点、携 actualPath、F001/F007 | implemented | high | `buildDrift L622-657`、`detectActualPath L484-527`；live 恰两条逐字段吻合 |
| 05 | schema 校验 + 稳定序 + 重算字节一致 | implemented | high | `validateGraph L831-840` 两路必经；双跑 `cmp` 字节全同（194120 B） |
| 06 | 每边每节点带 provenance | implemented* | high | core/schema/CLI 全带（105/105+92/92）；web DTO 节点字段缺失经反驳裁定为**辖域外**（见下） |
| 07 | 数据源为 projection 输出、切换不改面 | implemented | high | 默认 projection（`knowledge-graph.js:L857-867`）fail-closed；干净克隆 parity 测试 |
| 08 | recentChanges 五源、git argv 白名单只读 | implemented | high | 五源齐备 `knowledge-recent.ts:382-407`；`execFile` 冻结常量无 shell |
| 09 | drift 置顶/倒序/50 行/按需拉取 | implemented | high | `orderAndCapRecentChanges:367-380`；全仓无 knowledge SSE |
| 10 | jump 链接真实 id、占位 id 不可 ship | implemented | high | `attachVerifiedLink:342-365` 比对活体 id 并剥除占位；fixture 零引用 |
| 11 | 单一 LLM primitive + 中性 env（server-only） | implemented | high | 唯一出网点 `knowledge-llm.ts:246`；Vite 无 envPrefix 泄漏；三 facade 全过它 |
| 12 | 无 key→available:false；per-facade 全有或全无 | implemented | high | `getStatus L119-127`；throw-on-first-violation + allSettled 隔离 |
| 13 | prompts 版本化常量 + sha256 入缓存键 | implemented | high | 三 prompt `*-v1` + `sha256(version\0prompt)`；键第 4 组件 |
| 14 | 推断物带标签/虚线/badge、绝不落盘 | implemented | high | 前端四处 + E2E；服务端零写 API + fs spy 零调用 |
| 15 | 缓存六属性 + QA 永不缓存 | implemented | high | 逐属性落行号；QA 直调 `completeWithMetadata`，断言 `llmCache.size===0` |
| 16 | ask 为 query、router 零 mutation、无副作用 | implemented | high | 5/5 procedure `.query`；fs-spy 证零写 |
| 17 | 纯函数 context、2-hop 稳定序、overflow typed error | implemented | high | 双重 deterministic 过滤；四路同抛类型化错误无截断 |
| 18 | citation 语义全链（丢弃/计数/uncitable/superseded） | implemented | high | `knowledge-qa.ts:182-198` + 前端徽标 `KnowledgeMapPage.tsx:756-770` + en/zh 文案 |
| 19 | eval 扫 QA 契约面、非空过、排除 adapter | implemented | high | `instruction-surface-evals.js:122-128` 覆盖四角色；空扫即 finding |
| 20 | 单次无状态交换、无多轮无流式 | implemented | high | 单轮 messages 固定；stream/SSE 全域 0 命中 |
| 21 | DESIGN.md v10：右栏 master-detail、amber/**cobalt**、双主题 | **partial** | high | 结构/双主题成立；**cobalt token 全 src 零使用**（存活分歧 D2，见下） |
| 22 | @xyflow/react v12 + d3-force、DTO renderer-agnostic | implemented | high | 12.11.5/3.0.0 实装；DTO 无坐标/handle 概念 |
| 23 | 详情五要素 + mini graph 1-hop + `+N` | implemented | high | 五要素齐备；截断 8、`+N`=隐藏边数，e2e 实证 `+7` |
| 24 | Ask 右栏切换、chip 选中高亮、**全字符串 i18n** | **partial** | high | 切换/高亮/字典类型强制成立；**`:593` tooltip 硬编码英文**（存活分歧 D3，见下） |
| 25 | CLI seam 四断言 | implemented | high | 库接缝+真实 spawn 双层；31/31 实跑过 |
| 26 | web seam 五断言 | implemented | high | 枚举 + every-query 全称断言；79/79 实跑过 |
| 27 | citation validator 四断言 | implemented | high | 全为精确全对象断言（`omittedCount:2` 等） |
| 28 | eval fixture 必产 finding、零扫即 finding | implemented | high | vendor fixture deepEqual + `AMBER_E_EVAL_EMPTY_SCAN`；21/21 过 |
| 29 | UI 六项真浏览器对 live CLI 数据验证 | implemented | medium | 真 Chrome 逐项断言 + 反 fixture 哨兵；medium：e2e 树为策展复制、本次未本地跑（CI `ci.yml:224-226` 真跑） |
| 30 | Out of Scope 六条负向守卫 | implemented | high | 逐条 Searched 0 命中（无落盘/无新 mutation/无流式/无 tree-sitter/无治理对象入图） |

## 反驳裁定（3 条分歧 → 1 条剔除、2 条存活）

- **D1（REQ-06 节点 provenance 未达 web DTO）→ 剔除（规格侧推翻）**：L88 位于「Deterministic layer」节，辖域是经 schema 校验的图输出；DTO 形状按 L151/L189 留作 renderer-agnostic 实现自由，语义层不产 inferred 节点（L114）使该字段在 web 面为空洞常量；checker 接受 `origin` 改名即已弃字面标准。代码侧反驳者持异议（adaptNode 确实丢字段，`knowledge-graph-reader.ts:L70-90`）——按「任一方推翻即剔除」降为**文档注记**：建议 spec 或 DTO 注释显式说明节点 provenance 止于 CLI 层。
- **D2（REQ-21 cobalt 零使用）→ 存活（部分推翻）**：蓝系已守住「dual accents/no new visual grammar」精神（DESIGN.md §1 Tenet 2）；残余分歧是 token 级保真——页面用 `blue-500/#3b82f6` 而非定义 token `cobalt #2563EB`，且 `index.css:12-27` 的 `--color-accent` 同样零消费。P2。
- **D3（REQ-24 tooltip 硬编码英文）→ 存活（双方维持）**：`KnowledgeMapPage.tsx:593` 的 title 可达用户；仓内惯例不豁免 title（ThemeToggle/LanguageToggle 均走 t()）；减责因素：hash/时间戳值不可译，仅 `inferred`/`prompt` 模板词违反。P2。

## Stronger-than-spec（未记录的更强约束，防回归需留意）

1. **`allowExternal: z.literal(true)`**（`knowledge.ts:43`）——ask 强制显式同意闸门，spec 未提；改动它无文档可依。
2. **缓存键为规格三元组的超集**（+provider/endpoint，`knowledge-llm.ts`）——比 spec 承诺更强的隔离，未记录。

## 反方向（代码有、spec 未提——指针）

运行时行为缺陷不属规格符合性，已在 `docs/research/f059-knowledge-map-review.md` 立案：窗口聚焦整包重拉（L1）、后台页边消失（L2）、迷你图重复卡片（L3）、typecheck 门 no-op（O1）、`hideAttribution`（L6）、evidence 单条上限（B4）等。

## notChecked / unverified

- 30/30 全部核查，无 fan-out 截断。
- REQ-29 为 medium 置信（本地未跑 Playwright，CI 有门；e2e 树为策展复制而非工作树本体）。
- 反驳裁定 D1 存在双方分歧，已按规则剔除并如实记录异议。
