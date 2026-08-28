# REQ-22 — 渲染栈与 DTO 渲染器无关性

> "Rendering: `@xyflow/react` v12 + `d3-force` (see
> `docs/research/graph-rendering-library-choice.md`); the DTO stays renderer-agnostic."
>
> — F059 spec L150-151

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 图渲染由 `@xyflow/react` 主版本 12 承担，力导向布局由 `d3-force` 承担。
2. 选型有研究文档 `docs/research/graph-rendering-library-choice.md` 支撑（存在性）。
3. 服务端/共享 DTO 不含任何渲染器概念（position/x/y/handle/viewport/layout 等），坐标计算是客户端职责。

---

## Where enforcement lives

**1. 依赖版本**

```json
// apps/web/package.json:26-27
"@xyflow/react": "^12.11.5",
"d3-force": "^3.0.0",
```
实际安装版本（node_modules probe）：`@xyflow/react 12.11.5`、`d3-force 3.0.0`。主版本 12 ✓。

**2. 使用点**

```tsx
// apps/web/src/features/knowledge/KnowledgeMapPage.tsx:4-18
import { Background, ..., ReactFlow, ReactFlowProvider, ... } from '@xyflow/react';
import * as d3 from 'd3-force';
```
- `<ReactFlow>` 画布：KnowledgeMapPage.tsx:536-552。
- d3-force 模拟：`computeLayout`（:81-147）——`forceSimulation/forceLink/forceManyBody/forceCollide/forceCenter` + 自定义 cluster 力（:110-141），320 tick 后产出 `Map<string, {x, y}>`。
- 研究文档存在：`docs/research/graph-rendering-library-choice.md`（ls 确认）。

**3. DTO 渲染器无关**

`apps/web/src/lib/knowledge-dto.ts` 全文（106 行）字段清单：
- `KnowledgeNode`（:3-15）：`id, kind, layer, title, status?, sourcePath, updated?, paths?, contextPage?, revisions?, body?`
- `KnowledgeEdgeDTO`（:17-24）：`src, dst, verb, origin, evidence?, provenance?`
- 其余 DTO（DriftFinding/RecentChangeItem/NodeSummaryDTO/SemanticResultDTO/KnowledgeAskResultDTO/LLMStatusDTO）同样无坐标/句柄字段。

坐标注入发生在客户端映射层：KnowledgeMapPage.tsx:460 `const pos = layout.get(n.id) ?? {x:0, y:0}` → :466 `position: pos`；`Handle` 组件仅存在于 React 节点渲染（:619-630）。服务端组装 DTO 的 `knowledge-graph-reader.ts:70-129`（`adaptNode/adaptEdge/adaptDrift`）不产生任何坐标字段。`features/knowledge/types.ts:1-13` 是对 knowledge-dto 的纯 re-export，未追加渲染字段。

到得了：所有 tRPC 响应（graph/semantic/ask）都经 knowledge-dto 类型约束；到不了：`@xyflow/react` 的 `Node`/`Edge` 类型只在 KnowledgeMapPage.tsx 内部（`KnowledgeNodeData` :72-79 包 dto 为 `data.dto`），不回流服务端。

---

## Paths walked

- 主图渲染路径（graph query → mergedDto → computeLayout → flowNodes/flowEdges → ReactFlow）✓ — :877, :1015-1020, :455-528
- layered 布局路径（不走 d3，网格坐标）✓ — :91-108（同样是客户端计算）
- mini context graph 路径（详情面板小图，纯 SVG 手绘，不用 xyflow）✓ — :246-424，DTO 依旧无坐标
- 服务端 DTO 组装路径 ✓ — knowledge-graph-reader.ts:121-130，字段白名单式拷贝
- DTO 反向污染路径 ✗ — 客户端 layout Map 不进入任何 query input（ask input 仅 question/focusNodeId/allowExternal，server/routers/knowledge.ts:23-44）

---

## Searched

- `position|handle|viewport|\bx\b|\by\b`（目检 knowledge-dto.ts 全文 106 行）→ 0 渲染器字段。
- `cobalt` 无关；`@xyflow` （apps/web/src）→ 命中仅 KnowledgeMapPage.tsx（imports）与测试 mock（tests/client/KnowledgeMapPage.test.tsx:42-91）。
- `d3-force`（apps/web）→ package.json:27 + KnowledgeMapPage.tsx:18。
- node_modules 版本探针 → `12.11.5 / d3-force 3.0.0`。
- `ls docs/research/` → `graph-rendering-library-choice.md` 存在。

---

## How the verdict was reached

三个要件全部命中：manifest 与安装版本均为 v12 主版本 + d3-force 3；研究文档存在；DTO 类型定义与服务端组装均无渲染器概念，坐标生成被隔离在 KnowledgeMapPage.tsx 的 `computeLayout` 内且不回流。无失守路径 → implemented。

---

## Open questions

1. spec 引用的研究文档内容是否与最终选型论证一致（本核查仅验存在性与结论使用，未逐段核对文档论据）。
2. `KnowledgeNode.layer` 被 `computeLayout` 用作聚簇质心依据（:126-129）——layer 是三层本体概念（spec L78-80），非渲染器概念；此处按本体字段裁定，不构成失守。
