# F059 知识地图（Knowledge & Decision Map）源码审计报告

- 审计对象：F059 `/knowledge` 页面 + `amber knowledge graph` 全链路（commit 范围约 `ec131b8..63772f1`，"F059 #253/#254" 收尾）
- 审计方式：全文精读主要证据源 + 真实仓库图谱实测（`node scripts/amber.js knowledge graph --target .`）+ 手工演算布局/坐标数学 + 项目级 typecheck 复跑
- 结论标注约定：**实锤** = 代码/实测直接证明；**疑似** = 机制成立但实际影响需浏览器或特定数据触发；**潜在** = 当前数据未触发、增长/边界条件会触发

---

## 1. 概述

F059 在 `apps/web` 增加只读 `/knowledge` 页面：确定性解析器（`scripts/lib/core/knowledge-graph.js`）把仓库知识语料（24 ADR + 10 wiki + 9 architecture + MEMORY.md 各节 + feature_list.json + `.amber/artifacts`）构建成三层（decision / knowledge / implementation）、四动词（`supersedes` / `builds-on` / `references` / `describes`）的图，按 `schemas/knowledge-graph.schema.json` 校验后：

> CLI（`scripts/lib/knowledge-commands.js` `graph` action）与 web server（`apps/web/server/lib/knowledge-graph-reader.ts`，经 `scripts/lib/web-adapter.js` seam）共享同一构建器 → tRPC `knowledge.graph`（`apps/web/server/routers/knowledge.ts`）→ 前端 DTO（`apps/web/src/lib/knowledge-dto.ts`）→ `KnowledgeMapPage.tsx`（@xyflow/react + d3-force 渲染）。

生产数据源不是活树，而是 **git 提交的语料快照** `docs/knowledge-corpus/`（manifest + projection output，`scripts/lib/core/knowledge-projection.js`），43 篇文档过期即 fail-closed；features/MEMORY/artifacts 则总是活读。旁路能力：`knowledge.recentChanges`（五源聚合 Recent & Drift 面板）、`knowledge.semantic`/`semanticStatus`（读时 LLM 推断层）、`knowledge.ask`（带引用 QA）。

实测基线（当前工作树）：105 节点（adr 24 / wiki 10 / architecture 9 / memory 5 / feature 57 / artifact 0——本仓库无 `.amber/artifacts`）、92 边（builds-on 48 / references 31 / describes 10 / supersedes 3）、2 条 drift（F001/F007，与规格一致）；节点 id 无重复、无悬空边、重算字节级一致。

---

## 2. 边/点关系问题

### B1. 节点级 `provenance` 在 server DTO 链路丢失（契约漂移）——实锤，影响低

- 现象：schema 把 `provenance` 列为节点必填（`schemas/knowledge-graph.schema.json:20` `"required": [..., "provenance"]`，`:67`），core 也逐节点输出（`scripts/lib/core/knowledge-graph.js:112` `node.provenance = PROVENANCE`）；但 server 适配器 `adaptNode` 构造返回对象时没有拷贝该字段（`apps/web/server/lib/knowledge-graph-reader.ts:70-90`），前端 `KnowledgeNode` 类型也没有此字段（`apps/web/src/lib/knowledge-dto.ts:3-15`）。
- 规格依据：`docs/specs/F059-knowledge-decision-map.md:88`「Every edge and node carries `provenance: 'deterministic' | 'inferred'`」。边保住了（重命名为 `origin`），节点没保住。
- 影响：确定层今天只发 `deterministic`，功能上无感；但「每个节点带 provenance」的合同在 web 面断裂——若未来推断层真的产出节点（规格保留了该词汇），前端无法区分。
- 置信：实锤（契约不一致本身），实际用户可见影响低。

### B2. 幽灵 kind `'knowledge'` 贯穿 DTO/reader/LLM prompt，真实 kind `wiki` 反而缺跳转映射——实锤

- schema 的 kind 枚举是 6 个：`adr|artifact|wiki|memory|architecture|feature`（`schemas/knowledge-graph.schema.json:29-31`），解析器永远不会发出 `'knowledge'` kind。但：
  - DTO：`kind: 'adr' | 'artifact' | 'wiki' | 'knowledge' | 'memory' | ...`（`apps/web/src/lib/knowledge-dto.ts:5`）；
  - reader 白名单也放行它（`apps/web/server/lib/knowledge-graph-reader.ts:52-60`）；
  - 语义层 prompt 教给 LLM 一个不存在的 kind：`Each node has: id, kind (adr|artifact|wiki|knowledge|memory|architecture|feature)`（`apps/web/server/lib/knowledge-llm-prompts.ts:19`）；
  - 前端 `KIND_LABEL_KEYS` 给 `knowledge` 映射 wiki 标签（`KnowledgeMapPage.tsx:60-68`）。
- 根因是原型词汇残留：`apps/web/src/features/knowledge/fixture.ts` 的 wiki 节点全用 `knowledge:*` id / `kind: 'knowledge'`（如 `fixture.ts:135` `'knowledge:amber-ontology-mcp'`）。
- 直接后果（见 S3）：节点详情的本地跳转映射表 `KIND_LOCAL_TARGET`（`KnowledgeMapPage.tsx:158-165`）只写了幽灵 `knowledge: 'transcripts'`，**真实的 `wiki` kind 完全缺失**——wiki 节点详情没有任何跳转链接。
- 置信：实锤。

### B3. 边 `evidence.line` 指向 header block 首行而非「命名目标的那一行」——实锤，17/92 边

- schema 对 evidence 的定义：「Where the declaring document names the target」（`schemas/knowledge-graph.schema.json:98`）。
- 实现：`adrHeaderBlocks` 收集多行块后，块内所有目标共用 `block.line`（块首行）作为 evidence（`scripts/lib/core/knowledge-graph.js:394-404` `addEdge(adr.id, dst, block.verb, { path: adr.sourcePath, line: block.line })`）。
- 实测：92 条边中 17 条的 evidence 行内容不含目标 token。例：`adr:0009 -[builds-on]-> adr:0003` 的 evidence 是 `docs/adr/0009-contract-driven-context-distillation.md:5`，但第 5 行是 `**Builds on:** [ADR-0001](...)`，ADR-0003 实际在第 6 行。
- 影响：evidence 行号用于人工核查/跳转时错 1–3 行；不影响边本身正确性。
- 置信：实锤。

### B4. `(src, verb, dst)` 去重丢弃后续 evidence，且每边最多 1 条 evidence——实锤，低危

- `addEdge` 首见即锁定，后续同键出现（同一文档多处引用、或 wiki 正文与 ADR 头部同时命名）不再补充 evidence（`scripts/lib/core/knowledge-graph.js:381-389`；`edge.evidence = [evidence]` 恒为单元素数组）。schema 的 evidence 设计为可多条数组（`minItems: 1`）。展示层每边只有一个出处，多次声明的证据被静默吞掉。

### B5. token 定位与 ADR 引用正则的边界弱点——疑似/理论

- `lineOf` 用 `text.indexOf(needle)` 找**首次出现**（`scripts/lib/core/knowledge-graph.js:88-92`），feature describes 边用它定位（`:407`）。若正文更早处出现子串（如 `F0012` 内含 `F001`，`\bF\d{3}\b` 不会匹配它、`indexOf` 却会命中），行号会指错。当前语料未见触发。
- `ADR_REF = /ADR-(\d{1,4})/g`（`:335`）无右侧边界：`ADR-12345` 会被截成 `ADR-1234` 产出伪引用。理论性。
- `ARCHITECTURE_REF`/`WIKI_REF` 只匹配小写连字符名（`:337-338`）；当前 `docs/architecture/`、wiki 目录全部小写，未触发。

### B6. artifact trace verb 折叠：`refines`/`realizes` → `builds-on`、`decides` → `references`——按规格实现，但与治理图词汇分歧（供辩论）

- 实现：`traceVerb` 映射（`scripts/lib/core/knowledge-graph.js:449-454`）。规格明文如此（`docs/specs/F059-knowledge-decision-map.md` Implementation Decisions「builds-on … artifact `refines` / `realizes` Traces」）；`decides` 是注册 trace 类型（`scripts/lib/core/canonical-artifact-contracts.js:223-236`），映射覆盖完整、无遗漏。
- 但 AGENTS.md 描述治理图（ADR-0021）是「one typed edge per resolved Trace (`refines`/`realizes`/`supersedes`)」——同一条 trace 在治理图与知识图上呈现**不同 verb**（refines 在彼处是 refines，在此处是 builds-on），且 refines/realizes 的类型区分在知识图中不可恢复。这是有意的词汇折叠，不是 bug；是否接受这种跨投影语义漂移值得圆桌辩论。
- 另注：trace 指向未提交 identity 时边被静默丢弃（`addEdge` 的 `nodeIds.has(dst)` 卫）——防悬空正确，但没有任何 drift/警告记录。

### B7. 节点 id 冲突的潜在通道——潜在，当前未触发

- memory 节点 id = `memory:${slugify(title)}`（`scripts/lib/core/knowledge-graph.js:209-215`）：两个 `##` 标题 slug 相同（如 `Foo Bar` 与 `foo-bar`）会产出**两个同 id 节点**，违反 schema 描述的「unique across the graph」（JSON Schema 无法机器强制）。当前 5 节 slug 唯一。
- 同理 ADR 以 4 位数字为 id（`:132` `id: adr:${match[1]}`）：`0007-a.md` 与 `0007-b.md` 并存时撞 id。单测只对当前真实树断言唯一性（`tests/unit/knowledge-graph.test.js:63`），构建器本身无查重防线。

### 实测正面结论（排除项）

- 无重复节点 id、无悬空边、无自环；边/节点/drift 排序稳定，CLI 重算字节一致（`tests/unit/knowledge-graph.test.js:54-69` + 本次实测 `BYTE-IDENTICAL`）。
- F001（`scaffolding.js` → `scaffold.js` rename）与 F007（`loops/` → `loops.js` collapse）两条 drift 与规格、真实树完全一致。
- reader 对未知 kind/layer/verb/provenance 抛错 fail-closed（`knowledge-graph-reader.ts:71-98`），无静默降级。

---

## 3. 渲染问题（文字、像素）

### R1. MiniContextGraph 所有箭头被节点矩形遮挡——实锤（几何推导），需浏览器确认观感

- 连线端点取的是节点盒**中心**而非盒边界：`const x1 = it.dir === 'out' ? items.cx : it.x; ... const x2 = it.dir === 'out' ? it.x : items.cx;`（`apps/web/src/features/knowledge/KnowledgeMapPage.tsx:331-335`），`markerEnd="url(#mini-arrow)"`（`:347`）的箭头三角（6×6，refX=7）落在线终点=对方盒中心。
- 绘制顺序：先画所有线（`:330-360`），再画中心矩形（`:361-382`，不透明 `fill-amber-100 dark:fill-amber-950/60`），最后画卫星矩形（`:383-415`，不透明 `fill-white dark:fill-obsidian-elevated`）。出边箭头被卫星盒盖住、入边箭头被中心盒盖住 → **1-hop 迷你图的方向指示全部不可见**，方向只剩 verb 文字，而 verb 文字不含方向。规格明确要求 mini graph 带 verb 标注呈现邻域关系（spec:152-154），方向性是 declarer → declared 语义的一半。
- 修正参照：线段应裁剪到矩形边界（或箭头 refX 按盒半宽偏移）。

### R2. 迷你图卫星盒水平方向溢出 viewBox 1px——实锤，微小

- 椭圆布点 `cx=160, rx=118`（`:291-298`），盒宽 `w = 86`（`:387`）：最右卫星盒右缘 = 160+118+43 = **321 > 320**（`viewBox="0 0 320 168"`，`:312`），最左 = -1 < 0。左右极角各被裁 1px。

### R3. 标签按「字符数」截断，不按像素宽——疑似（CJK 必溢出，当前语料为英文标题）

- 中心标题 `center.title.length > 24 ? slice(0, 23)…`（`:380`）配 116px 宽盒 + fontSize 9.5：24 个拉丁字符 ≈ 114px 勉强贴边，宽字形（全大写、W/M 多）会溢出；卫星 `slice(0, 16)…`（`:385-386`）配 86px 盒 + fontSize 8.5：16 个 CJK 字符 ≈ 136px，**必然溢出盒外**。i18n 到 zh 后若节点标题本地化（当前语料标题是英文，暂未触发），迷你图文字将压过邻盒。SVG `<text>` 无 clip，无 `textLength` 约束。
- 主画布节点卡片用 `line-clamp-2` + `truncate`（`:648-651`）是安全的；问题只在 SVG 迷你图。

### R4. 主画布 Handle 固定 Left→Right，边不落在朝向对端的节点边界——疑似（视觉质量）

- 每个节点只有一个 target Handle（左侧）与一个 source Handle（右侧）（`KnowledgeMapPage.tsx:619-630`）。力导向布局里 src 在 dst 右侧/上方时，边仍从 src 右缘出发绕回 dst 左缘，产生长回绕 bezier 与节点穿越。这是 xyflow 已知需要 floating-edge 处理的场景；当前 105 节点 92 边的绕行程度需浏览器实测。

### R5. layered 布局的层带溢出：任一层 >56 节点即与下一层**精确重叠**——数学实锤，当前未触发

- `layerY = { decision: -480, knowledge: 0, implementation: 480 }`，`col = i % 14`，`row = Math.floor(i / 14)`，`y = layerY + row * 120`（`KnowledgeMapPage.tsx:99-107`）。层带高度只有 4 行（4×120=480）：第 57 个节点（row=4）的 y 恰好等于下一层带 row=0 的 y，且 x 网格公式相同 → **节点逐格精确堆叠**（不是近似重叠）。
- 当前计数：decision 24、knowledge 24、implementation 57（implementation 在最底层向下无界，暂无碰撞）。decision 层一旦开始提交 canonical artifacts（本仓库 artifact 数为 0，治理常态下会增长），或 knowledge 层文档扩张过 56，立即触发。无任何防线或测试覆盖此界。

### R6. 副标题在合并推断边后仍宣称「deterministic parse」——实锤，文案失实

- 副标题计数用 `mergedDto`（含语义层推断边）：`t('knowledge.subtitle', { ..., edges: mergedDto.edges.length, ... })`（`KnowledgeMapPage.tsx:1182-1187`），而文案是 `'{visible}/{total} nodes · {edges} edges · {drift} drift findings · deterministic parse of committed artifacts'`（`apps/web/src/lib/i18n.tsx:35-36`；zh `:1039-1040`「提交工件的确定性解析」）。运行语义分析后 `{edges}` 含推断边，与「确定性解析」标签矛盾；且取消勾选「inferred edges」只影响画布过滤（`FlowCanvas` 的 `showInferred`），不影响副标题计数。
- 另：文案说「committed artifacts」，但图内容主体是语料文档+features，本仓库 artifact 节点为 0——措辞本身也不准确。

### R7. STATUS_DOT 只识别 4 个字面量，真实 ADR status 大量落灰——实锤，小

- `STATUS_DOT = { passing, accepted, Accepted, committed }`（`KnowledgeMapPage.tsx:53-58`）。真实 ADR status 实测分布：`Accepted` ×15、`Accepted (2026-08-26)` ×4、`Accepted (P0–P2 implemented; …)` ×1、`Accepted (2026-08-25 — the five open questions …` ×1 等——带尾注的 7 篇全部落到默认灰点，语义上它们同样是 Accepted。status 原样长串还会进入详情卡头部一行（`:1352-1356`，无截断）与搜索匹配。

### R8. 颜色 token 偏离：knowledge 层用 blue-500 而非设计系统 cobalt——疑似（可能有意，但 token 未被使用）

- 规格要求「amber/cobalt dual accents」（spec:148-150）；设计 token `cobalt = #2563EB`（`apps/web/tailwind.config.js:32-37`、`.stitch/DESIGN.md:28`）。页面 knowledge 层用 `bg-blue-500` / `stroke: '#3b82f6'`（`KnowledgeMapPage.tsx:41-45`），且整个 `apps/web/src` **无任何 `*-cobalt-*` class 使用**。#3b82f6 vs #2563EB 差一档；hardcode hex 也绕开了主题 token。
- 另一 hardcode：hover 边标签底色 `labelBgStyle: { fill: '#fffbeb' }`、字色 `#b45309`（`:516-517`）在暗色主题不换色（浅黄底签浮在暗色画布上）。

### R9. EdgeRow 方向文案歧义/易读反——疑似 UX

- 出边行渲染为 `<对端标题> <verb> →`、入边行 `→ <verb> <对端标题>`（`KnowledgeMapPage.tsx:572-589`）。出边的自然读法「OtherTitle supersedes →」把主语读成了**对端**，而实际是「选中节点 supersedes 对端」——方向语义与视觉排布相反。无 tooltip 说明。

### R10. React key 冲突与索引 id——潜在

- 迷你图卫星 `key={`node:${it.other.id}`}`（`:390`）：同一对端节点与中心存在双向两条边时（数据允许：A references B 且 B describes A），两个卫星 key 重复 → React 警告/协调异常。边线的 key 含 dir+verb（`:338`）没这个问题。
- 主画布边 id 用数组下标 `id: \`e${i}\``（`:504`），过滤/开关推断边时 id 漂移指向不同边，xyflow 复用动画状态可能闪烁。低危。

### R11–R12. 文字细节——实锤，微小

- Recent 行无日期时（drift 项 `time: ''`）日期列渲染 source 文本 `'drift'`（`:1571` `{r.time ? r.time.slice(0, 10) : r.source}`），与其它行的 `YYYY-MM-DD` 列不齐。
- zh 文案标点混排：`'…锚点与关联;悬停可高亮…'` 半角分号（`i18n.tsx:1065`）；`'决策层(ADR / 工件)'` 等半角括号（`:1046-1048`）。
- 4 个死 i18n 键（en/zh 双份定义、无引用）：`knowledge.recent`、`knowledge.drift`、`knowledge.noDrift`、`knowledge.semantic.provenance`。

---

## 4. 来源 / provenance 问题

### S1. 生产数据源是 git 提交的语料快照，且与活读源混合成图——设计使然，需知悉的时点混合

- `readKnowledgeBaseProjection` **只读** `docs/knowledge-corpus/knowledge-context-manifest.json` + `knowledge-base.output.json`（`scripts/lib/core/knowledge-projection.js:320-366`，注释明言「the production reader reads exclusively here」）；43 篇文档任何一篇的 normHash 与快照不符即抛 `AMBER_E_KNOWLEDGE_SOURCE_STALE` fail-closed（`:386-410`），CLI 与 `/knowledge` 页面整体不可用，直至运行 `amber knowledge context-sync`。
- 同一张图里 features / MEMORY.md / artifacts 却是**活读当前树**（`buildKnowledgeGraphFromSources`，`knowledge-graph.js:732-736`）。即：编辑 MEMORY.md → 图即时变化；编辑任一 ADR → 图整体拒绝服务。fail-closed 是规格立场，但「43 文档=提交快照、其余=工作树现状」的混合时点值得在报告中明示——图并不是单一时点的一致快照。
- 快照哈希用 normHash（空白归一化，`:388-401` 注释解释了 Windows CRLF 动机）：纯空白/换行差异不会触发 stale，即服务出的 `body` 可能与工作树在空白上不一致。微小。
- 附带：`EXPECTED_COUNTS = { adr: 24, wiki: 10, architecture: 9, total: 43 }` 硬门（`:22`，deliberate gate）——新增第 25 篇 ADR 需要改常量 + 重跑 sync，否则整个知识面失效。见 O3。

### S2. fixture 与真实语料严重漂移，且自身类型不成立（未泄漏产线，但已失去参照价值）——实锤

- 泄漏排查：`apps/web/src`、客户端测试均**无任何 import** 指向 `features/knowledge/fixture.ts`（grep 全库验证），e2e 还有反哨兵断言（`apps/web/tests/e2e/knowledge.spec.ts:92-100` `expect(page.locator('text=/fixture/i')).not.toBeVisible()`）。**fixture 不会进入生产路径**（是死文件，规格 Further Notes 称其为「DTO-shape reference only」）。
- 但作为参照物它已失真：
  - 词汇错位：wiki 节点全用 `knowledge:*` id / `kind: 'knowledge'`（`fixture.ts:135` 等），与 schema 的 `wiki:*`/`wiki` 冲突（幽灵 kind 的源头，见 B2）；
  - 内容捏造：fixture `adr:0022 = 'Program authority documents'`、`adr:0024 = 'Principal registry'`（`fixture.ts:117-127`），真实为 `# ADR-0022: 2.0 Pilot Is Governance-Only with Admissible External Evidence`、`# ADR-0024: Legacy and External Records Migrate through Read-Only Adapters`；fixture 边 evidence 指向不存在的文件（如 `det('adr:0024', 'feature:F050', 'describes', 'docs/adr/0024-principal-registry.md', 48)`）；
  - 类型不成立：推断边 `provenance` 缺 DTO 必填的 `provider` 字段（`fixture.ts` 内 `provenance: { model: 'stub-model', timestamp: …, promptHash: … }` vs `knowledge-dto.ts:23` `provenance?: { provider: string; … }`），且整文件 10 个 `TS2304: Cannot find name 'KnowledgeNode'`（用了 `export type {...} from './types'` 只再导出、没 import 本地名字）——见 O1，这些错误从未被 CI 拦下；
  - recentChanges 里保留占位 id（`linkId: 's-422cd8e'`、`'drift-scan-0824'`），规格明文「Placeholder ids are a prototype-only affordance and are not shippable」（spec:100-103）——因文件未被引用而不违规，但擦边。

### S3. 节点详情「来源跳转」映射错位：wiki 无映射、architecture/memory 映射到死分支——实锤

- `KIND_LOCAL_TARGET = { feature: 'gates', adr: 'governance', artifact: 'governance', knowledge: 'transcripts', architecture: 'transcripts', memory: 'transcripts' }`（`KnowledgeMapPage.tsx:158-165`）：
  - 真实 kind `wiki` **缺失** → wiki 节点详情无跳转（幽灵 `knowledge` 占了它的位）；
  - `architecture`/`memory` → `'transcripts'`，但 `LocalJumpLink` 的 transcripts 分支要求 `linkId`（`:194-207` `if (linkTo === 'transcripts' && linkId)`），而详情面板只给 feature kind 传 linkId（`:1417` `linkId={selected.kind === 'feature' ? selected.id.split(':')[1] : undefined}`）→ 分支恒 null，**architecture/memory 节点同样没有任何跳转渲染**。
  - 即整个映射表里只有 feature（→/gates）和 adr/artifact（→/governance）活着；把「文档节点跳到 transcript」这个目标本身也语义可疑（原型遗留）。
- 对照：Recent 面板的跳转链路是健康的——server 端 `attachVerifiedLink` 只发真实存在的 id，router 测试逐一校验（`apps/web/tests/server/knowledge-router.test.ts:116-140`），e2e 逐链接请求并断言 2xx（`apps/web/tests/e2e/knowledge.spec.ts:294-322`）。

### S4. Recent 面板链接归属是启发式子串匹配——疑似（设计权衡）

- `attachVerifiedLink` 在 `title + linkLabel` 里按 `[sessions, gates, transcripts, routes, governance]` 顺序找**字典序第一个**命中的活 id（`apps/web/server/lib/knowledge-recent.ts:342-365`，`[...ids].sort().find(...)`）。后果：一条 commit 同时提及 F050 与 F059 时恒链到 F050；route id（如 `feature-standard`）出现在 commit 标题时会先于 governance 抢占归属。id 都真实（有测试兜底），但**归属对象可能不是最相关的那一个**。
- 另有小问题：`collectMaintenanceChanges` 的 `regression:${text(finding.taskId) ?? items.length}` 用可变的 `items.length` 当回退 key（`:305`），同 key → 同 `stableId` → 前端 `key={r.id}` 冲突的理论通道。

### S5. ADR `Date:` 行解析在两处正则不一致——实锤，低

- 图构建器：`/^\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/m`（`knowledge-graph.js:134`，无行尾锚）；Recent 聚合：`/^\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})\s*$/m`（`knowledge-recent.ts:236`，要求整行）。`**Date:** 2026-08-07 (updated)` 这类行会出现「图上有 updated、Recent 面板却没有该 ADR 行」的分叉。当前 24 篇 Date 行都是干净格式，未触发。

### S6. QA `contextDigest` 依赖 `localeCompare`，与 core 的字节序纪律相悖——机制实锤，触发依环境

- `knowledge-qa.ts` 的 `stable()` 用 `key(left).localeCompare(key(right))` 排序 nodes/edges/drift 后生成 `contextDigest = sha256(context)`（`apps/web/server/lib/knowledge-qa.ts:88-90, 128-165`）。`localeCompare` 是 ICU/locale 敏感的（大小写、标点权重随环境 locale 变），而 core 明文承诺「plain byte comparison, no locale」（`knowledge-graph.js:37-39`）。规格要求「`contextDigest` (sha256) records exactly what was fed」（spec:133）——同一 snapshot 在不同 locale 的服务器上可能产出不同 digest，破坏跨环境可复现性/可审计性。`validateSemanticEdges`/`validateSummaries` 的排序同样用 localeCompare（`knowledge-llm-prompts.ts:209-211, 224`，只影响展示顺序，无 digest 后果）。

### S7. 语义层 provenance 语义正确（排除项）

- 缓存命中返回**首次推断时**的 provenance（含 timestamp）——`cacheIdentity` 的新 timestamp 只在 fetch 路径被使用（`knowledge-llm-prompts.ts:149-172, 239-245`），符合「标注推断发生时刻」的语义。cited QA 不进缓存（直接 `completeWithMetadata`，`knowledge-qa.ts:223`），符合规格。推断边/摘要经严格校验（未知节点、自环、与既有边重复、重复项全部整体拒绝），符合「per-facade all-or-nothing」。

---

## 5. 其他发现（供圆桌辩论）

### O1. `apps/web` 的 typecheck 门是 no-op；F059 页面自身无法通过项目级 typecheck——实锤，最值得辩论

- `apps/web/package.json` 的 `build` = `tsc --noEmit && vite build`，但根 `apps/web/tsconfig.json` 是 `{ "files": [], "references": [...] }`——`tsc --noEmit` 对这种 solution-style 配置**检查 0 个文件、恒 exit 0**（vite build 用 esbuild 也不做类型检查）。
- 实跑 `npx tsc --noEmit -p tsconfig.app.json --ignoreDeprecations 6.0`：全项目 42 个错误，其中 **F059 自己的文件占 20 个**：
  - `KnowledgeMapPage.tsx` 10 个：缺 `@types/d3-force`（TS7016，`strict` 下 d3 全 any）、CSS side-effect import 无声明（TS2882）、d3 力函数里访问 `n.x/n.y`（TS2339，`:134-135, 145`——节点类型未与 d3 SimulationNodeDatum 合并，配合 `nodes as never[]`、`f as unknown as d3.Force<...>` 双重强转把类型系统整体绕开）；
  - `fixture.ts` 10 个 TS2304（见 S2）。
- 含义：F059「落地即绿」的构建证据里不包含真实类型检查；上面 B1/B2 这类 DTO 漂移正是类型门失效下容易溜进来的品类。

### O2. `contextPagesBySource` 死代码——实锤

- `scripts/lib/core/knowledge-graph.js:291-331` 定义了从 `.amber/context/pages` 建映射的完整函数，但树读取路径已改用 `committedContextPagesBySource`（`:663-687`），全库无调用点。旧 seam 遗留，读者会误以为 `.amber` 页面参与树读取。

### O3. 43 篇硬编码 census + fail-closed 的运维摩擦——设计决定，建议辩论量级

- `EXPECTED_COUNTS` 固定 24/10/9（`knowledge-projection.js:17-23`，注释自称 deliberate gate）。任何文档增删 → manifest census 错误；任何文档编辑 → stale 拒服。知识面的可用性与文档演进强耦合：写一篇新 ADR 的代价 = 编辑 + 改常量 + `context-sync` + 提交再生成的语料快照（`docs/knowledge-corpus/*.json`，全文冗余入库）。fail-closed 与「知识地图鼓励文档演进」目标之间存在张力。

### O4. 规模上限一览——潜在

- QA 无 focus 时全图入 context：`MAX_CONTEXT_NODES = 256`（`knowledge-qa.ts:32`）；语义层输入 `MAX_INPUT_NODES = 256`（`knowledge-llm-prompts.ts:55`，超限直接 zod 抛错 → 全 facade 失效）。当前 105 节点，feature+文档自然增长到 256 后：ask（无 focus）恒 `context-overflow`、semantic 恒失败。layered 布局 >56/层重叠（R5）比这些更早到来。
- `computeLayout` 力仿真 320 tick 同步跑在主线程（`KnowledgeMapPage.tsx:143`），每次 dto/layout 模式变化重跑；105 节点尚可，数百节点会卡首帧。

### O5. 测试几何盲区——与 R1/R5 直接相关

- 客户端测试把 `@xyflow/react` 整体 mock 成按钮列表（`apps/web/tests/client/KnowledgeMapPage.test.tsx:42-91`），`computeLayout`/`MiniContextGraph` 的坐标数学**零单测**；e2e 只断言可见性与计数（`knowledge.spec.ts:325-350` 断到 `+N` 文本为止），不断言坐标/遮挡/重叠。R1、R5 这类问题在现有测试体系下永远绿灯。

### O6. `graph` DTO 携带恒空的 `recentChanges: []`——实锤，微小

- `readKnowledgeGraphSnapshot` 恒返回 `recentChanges: []`（`knowledge-graph-reader.ts:128`），真数据走独立 query。DTO 字段成为陷阱（router 测试还专门断言它为空，`knowledge-router.test.ts:82-86`）；fixture 却在该字段塞满占位数据。类型上应拆出去。

---

## 6. 未验证 / 需浏览器实测的点

1. **R1 箭头遮挡的实际观感**：几何上箭头落在盒中心必被盖住；需截图确认是否有部分露出（strokeWidth/marker 溢出）。选中任一有出入边的节点看迷你图。
2. **R4 主画布反向边形态**：力布局下 src 位于 dst 右侧时的回绕 bezier 是否显著穿越节点/交叉（105 节点 92 边规模）。
3. **暗色主题**：hover 边标签 `#fffbeb` 浅底签在暗色画布上的观感（R8）；drift 红 ring 在暗色下的对比度。
4. **force 布局密度**：`forceCollide(108)` vs 节点实际渲染尺寸（宽 128–190px）在聚簇中心的重叠程度；`minZoom={0.05}` 下缩小时文字可读性。
5. **R6 复现**：配置 `LLM_PROVIDER=stub` + `LLM_API_KEY`，运行语义分析后观察副标题 edges 计数上涨且仍标「deterministic parse」。
6. **R7 长 status 换行**：选中 `adr:0022`（status 为长句）看详情卡头部布局是否被挤坏。
7. **S3 复现**：选中任一 wiki / architecture / memory 节点，确认详情「source」行右侧无跳转链接；对照 feature/adr 节点有。
8. **zh 模式**：`聚簇/分层` 按钮、迷你图 verb 英文单词（verb 不翻译，`{it.verb}` 直渲染——en 词汇出现在 zh 界面，是否接受）；副标题「提交工件的确定性解析」措辞。
9. **Ask 长答案**：24 段 × 12 引用上限时右栏滚动与 citation chip 换行。
10. **引用点击选中被过滤节点**：开 kind 过滤后点 citation chip——节点详情出现但画布上无对应节点高亮（`setSelectedId` 不清过滤器）。

---

## 7. 浏览器实测补充（2026-08-28，dev server @ 127.0.0.1:5175，另一路独立实测）

静态审计之外的前台实测（React 19 dev + StrictMode；浏览器标签页中途失焦，失焦态结论已标注）。

### L1. `knowledge.graph` 查询缺 refetch 抑制：窗口每次聚焦整包重拉 167KB——实锤，网络日志证据

- `trpc.knowledge.graph.useQuery()` 无任何选项（`KnowledgeMapPage.tsx:877`），而相邻三个查询全部配置 `refetchOnWindowFocus: false` + `staleTime: Infinity`（`:878-896`）。React Query 默认 `refetchOnWindowFocus: true` → 单次页面会话实测同一批量请求 `knowledge.graph,knowledge.semanticStatus` 发出 **9 次**（截图/切窗即触发）。
- payload 实测 167,374 字节，其中 **69%（114,673 字节）是 105 个节点的 `body` markdown 全文**——重拉的还是最重的查询。与本仓库既往「Live Activity Feed 轮询性能」缺陷同类。

### L2. 聚焦重拉引发整图重建；后台标签页中 92 条边全部不渲染——实锤（机制推断中高，现象实测）

- dto 引用变化 → `flowNodes` 全量重建（`:455-488`）→ xyflow v12 重新测量节点；`document.visibilityState === 'hidden'` 时 ResizeObserver 不触发，节点永不 measured → **边一条都不渲染**。实测：105 节点全部可见（kind 过滤已清空）状态下 `.react-flow__edge` 数量为 **0**。
- fitView 用 `duration: 400` 动画（`:491`，rAF 驱动）在后台页同样不执行，transform 冻结在旧值。
- 用户可感知形态：切走再切回标签页 → 聚焦 refetch → 图重建，边短暂消失/闪烁、视图跳变。可见态的闪烁时长需人眼确认（遗留）。
- 控制台伴随证据：`[React Flow] error#004 容器需要宽高` ×2、`error#015 拖拽未初始化节点` ×2。

### L3. R10 升级为实锤：双向边邻居在迷你图重复卡片 + React 重复 key，已 DOM 复现

- 数据前提成立：`adr:0007 -[supersedes]-> architecture:web-viewer` 与 `architecture:web-viewer -[references]-> adr:0007` 双向共存（另有 `adr:0020↔F040`、`adr:0020↔F041` 两对）。
- 选中 `architecture:web-viewer` 后 DOM 实测：迷你图渲染 3 个 rect = 1 中心 + **2 张 `Web console role…` 卡片**（y=12 与 y=136，同一节点画成两个"不同"节点），控制台报 `Encountered two children with the same key, node:adr:0007` ×2（StrictMode 双渲）。
- 根因：邻居遍历按边推入、无按 `other.id` 去重（`:268-288`），key 只含 id（`:390`）。边线 key（`:338`）含 dir+verb 无此问题。方向语义本身正确（supersedes 入、references 出的箭头方向与数据一致）。

### L4. 迷你图 8 邻居时相邻卡片必然互相遮挡——几何推算，中高置信

- 椭圆布点 `rx=118, ry=62`（`:291-298`）配 86px 宽卡片：8 邻居时相邻卡片中心距最小 ≈ 56px（左右两侧相邻角对），横向重叠约 30px。与 R2（±1px 溢出 viewBox）同源but更显著。高连接度中心节点（如 `adr:0003`）可复现，未逐一 DOM 验证。

### L5. 布局切换不触发 fitView——代码实锤，行为需可见视口复测

- fitView effect 依赖数组仅 `[fitView, visibleIds]`（`:490-493`），`layout`/`layoutMode` 变化不重新适配视口。聚簇 → 分层后（分层 y 跨度实测约 -480…960）视图停留在聚簇时代的 transform，图可能大幅偏出视口。后台页无法确证观感，列为待复测。

### L6. `proOptions={{ hideAttribution: true }}` 未订阅 Pro 即隐藏 xyflow 署名——实锤，第三方署名合规

- `KnowledgeMapPage.tsx:547`；控制台警告原文「Please only do this when you are subscribed to React Flow Pro」。库许可为 MIT，但官方将移除 attribution 限定为 Pro 订阅者权益；治理协议仓库对外部作品署名边界应从严。建议恢复 attribution 或订阅。

### L7. 实测正面结论（排除项，补充 §2 排除清单）

- 105/105 `sourcePath` 与 92/92 `evidence.path` 在真实树存在；`evidence.line` 全部未越界（行号语义偏移见 B3，另账）。
- drift 无漏报：7 个「缺失锚点」中 5 个为 glob 模式，全部有真实匹配文件；仅 F001/F007 两条真缺失，与 drift 输出一致。
- i18n `knowledge.*` 键 zh/en 完全对称（83 键 × 恰好 2 次出现）。
- 暗色主题切换 html.dark 生效、节点卡片配色随主题（部分回答 §6-3；hover 边标签 `#fffbeb` 硬编码问题 R8 仍待可见态观感确认）。
- kind 过滤链路正常（点选「架构」→ 计数 9/105、flowNodes=9、复点恢复 105/105——会话中一次 9/105 状态经排查为外部误触点击 chip，非自发状态漂移）。
- 数据层复核与 §2 结论一致：无悬空边、无自环、无 `(src,dst,verb)` 重复；63/105 节点零连接（60% 孤立——数据覆盖特征，供辩论定性）。

### §6 待测点状态更新

| §6 条目 | 状态 |
| --- | --- |
| 1 R1 箭头遮挡观感 | 未测（失焦无法截图）；L3 已证卡片遮挡链路 |
| 2 R4 反向边形态 | 部分：首屏截图可见明显缠绕/交叉，未量化 |
| 3 暗色主题 | 部分完成（L7）；`#fffbeb` 标签观感未测 |
| 4 force 密度/minZoom 可读性 | 首屏 scale≈0.144 时节点文字实测不可读（预期内的缩放行为，标签无 zoom 感知降级） |
| 5-10 | 未测（失焦限制 / 需 LLM stub 配置），移交修复后验证 |



```text
nodes 105  edges 92  drift 2
byKind {"adr":24,"architecture":9,"feature":57,"memory":5,"wiki":10}   # artifact: 0（本仓库无 .amber/artifacts）
byLayer {"decision":24,"knowledge":24,"implementation":57}
verbs {"builds-on":48,"supersedes":3,"describes":10,"references":31}
dupNodeIds []   dangling 0   recompute BYTE-IDENTICAL
drift = F001 scaffolding.js→scaffold.js (rename) ; F007 loops/→loops.js (collapsed)
edge evidence 行内容与目标不符：17/92（全部为多行 header block 首行问题，见 B3）
```
