# REQ-06 — 每个节点与每条边携带 provenance；文件证据边恒为确定性解析，LLM 输出不进此流

> "Every edge and node carries `provenance: 'deterministic' | 'inferred'`. File-evidence edges are always deterministic-parsed; LLM output never enters this stream."
> — F059 spec L88-89

**Verdict:** partial · confidence: high

---

## What this demands of an implementation

1. 图数据流的**每一环**（core 构建 → CLI 输出 → web server reader/DTO → 前端类型）上，节点**和**边都携带二值 provenance 标记。
2. 由文件证据产生的边永远出自确定性解析器，其 provenance 恒为 `deterministic`。
3. LLM 产物（推断边、摘要）不得混入确定性图流——不进 `knowledge graph` 输出、不进 `knowledge.graph` 查询结果。

---

## Where enforcement lives

逐环走链：

- **① core**：`scripts/lib/core/knowledge-graph.js:L57` `PROVENANCE = "deterministic"`；节点 `makeNode L112` `node.provenance = PROVENANCE`；边 `addEdge L386` `{ src, dst, verb, provenance: PROVENANCE }`。本模块无任何接受外部边/节点注入的入口——LLM 无缝可插。
- **② schema**：`schemas/knowledge-graph.schema.json:L20`（节点 required 含 `provenance`）、`L67`（enum 二值）、`L76`（边 required 含 `provenance`）、`L85`（enum 二值）——缺失即构建抛错（validateGraph）。
- **③ CLI 输出**：serializeKnowledgeGraph 原样发射。本机实测：105/105 节点、92/92 边 `provenance:"deterministic"`，0 缺失。
- **④ web server reader/DTO —— 链条在此断裂（节点半边）**：
  - 边：`apps/web/server/lib/knowledge-graph-reader.ts:L92-L106` `adaptEdge` 把 `edge.provenance` **改名**映射为 `origin`（白名单 `ORIGINS L68` 二值，未知值 throw L96-L98）——值语义保留、字段名偏离 spec 字面。
  - 节点：`RawNode L31-L43` 根本未声明 `provenance` 字段；`adaptNode L70-L90` 的返回对象不含任何 provenance/origin —— **节点的 provenance 在这一环被丢弃**。
  - DTO：`apps/web/src/lib/knowledge-dto.ts:L3-L15` `KnowledgeNode` 无 provenance/origin 字段；`L17-L24` `KnowledgeEdgeDTO` 有 `origin: 'deterministic' | 'inferred'`，且把 `provenance` 这个名字**重用**为 LLM 元数据对象 `{provider, model, timestamp, promptHash}`（L23）。
- **⑤ 前端类型**：`apps/web/src/features/knowledge/types.ts:L1-L13` 原样 re-export④的 DTO——节点无标记贯穿到 UI 层；UI 只以 `e.origin === 'inferred'` 区分边（`apps/web/src/features/knowledge/KnowledgeMapPage.tsx:L274,L283,L498-L512,L590`）。
- **LLM 隔离（成立）**：`apps/web/server/routers/knowledge.ts:L57-L59`——`knowledge.graph` 只返回 `readKnowledgeGraphSnapshot(...)`；推断边/摘要只出现在**独立**的 `knowledge.semantic` 查询里（L66-L129），且逐项打 `origin: 'inferred' as const`（L102、L114）+ LLM provenance 对象；从不合并回 graph 结果、从不落盘（DTO 层面 SemanticResultDTO 与 KnowledgeGraphDTO 分离）。

---

## Paths walked

- ✓ core→CLI：live 输出全量携带、值恒 deterministic（`nodeProvenance={"deterministic":105}`、`edgeProvenance={"deterministic":92}`）。
- ✓ 测试锁定 core 层：`tests/unit/knowledge-graph.test.js:L41-L44`（每个节点与每条边 `provenance === "deterministic"`）。
- ✓ 边经 web 链路：reader 改名 origin、值二值白名单；web 测试 `apps/web/tests/server/knowledge-router.test.ts:L71-L80` 断言每条边有 `origin` **且字符串型 provenance 不得泄出**——改名是有意设计，非疏漏。
- ✗ **节点经 web 链路**：`adaptNode` 不透传、DTO 无字段、前端类型无字段——"Every ... node carries provenance" 在④⑤两环不成立。确定性节点在 web 面成了无标记对象（当前唯一节点来源是确定性解析器，靠"构造上全是 deterministic"隐式成立，但 spec 要的是显式携带）。
- ✓ LLM 不进流：`knowledge.graph` 响应对象由 reader 独占构造（`recentChanges: []` 之外无注入点）；semantic 结果类型分离；`knowledge-llm-prompts.ts` 推断边仅 `{src,dst,verb}` 三字段 + 路由器补 `origin:'inferred'`——不可能带 `origin:'deterministic'` 冒充文件证据（`z.enum` 不含 origin 字段，路由器硬编码 L102）。
- ✓ 反向污染检查：`inferSemanticEdges` 拒绝与既有确定性边重复的输出（`knowledge-llm-prompts.ts:L200-L207` `existing-edge-reference` throw）。

---

## Searched

- `provenance`（scripts/lib/core/knowledge-graph.js）→ L41-L42（注释）、L57、L112、L386、schema 引用——core 全覆盖。
- `provenance`（apps/web/server/lib/knowledge-graph-reader.ts）→ 仅 `RawEdge L19` 与 `adaptEdge L96-L103`——**RawNode/adaptNode 0 命中**（节点丢弃的直接证据）。
- `origin`（apps/web/src）→ `knowledge-dto.ts:L21`（边）、`NodeSummaryDTO L61`（摘要，非节点）、`KnowledgeMapPage.tsx` 6 处边判别、`fixture.ts:L743`（未接线原型）——**KnowledgeNode 相关 0 命中**。
- `origin: 'inferred'`（apps/web/server/routers/knowledge.ts）→ L102、L114 两处硬编码——推断产物必带 inferred 标记。

---

## How the verdict was reached

需求有两半：后半（文件证据边恒确定性解析、LLM 不进流）全链成立且有三道闸（core 无注入口、路由器类型分离、facade 校验去重）。前半"Every edge **and node** carries provenance"在 core/schema/CLI 三环双双成立，但 web reader 起：边以改名（`origin`）形式保留值语义，节点被无声丢弃且 DTO/前端类型均无该字段。主路径成立、一条 shipped 路径（web 节点）失守——正是 partial 的定义。不判 contradicted：无任何环节把错误的 provenance 值写上去；不判 implemented：spec 明说 "and node"，且 F059 L193-L195 强调 "deterministic and inferred artifacts stay forcibly distinct in DTO and UI"——节点在 DTO 里已无从区分（今天靠"节点只有确定性来源"这一巧合成立，一旦未来引入推断节点即静默混流）。

---

## Open questions

- DTO 把 `provenance` 字段名重用为 LLM 元数据对象（`knowledge-dto.ts:L23`）而把 spec 的 provenance 改叫 `origin`，web 测试（knowledge-router.test.ts:L77-L78）明确守护这一改名。这是"有意的命名迁移"还是"应回写进 spec 的偏离"，spec 文本未记载——需要 spec 或 ADR 补记，否则字面核查永远对不上。
- 节点 provenance 是否应在 DTO 恢复：若语义层日后产出"推断节点"（spec 未排除），当前 DTO 无字段可承载区分。
