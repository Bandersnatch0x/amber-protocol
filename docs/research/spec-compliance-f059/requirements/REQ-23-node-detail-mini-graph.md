# REQ-23 — 节点详情五要素与 mini context graph

> "Node detail shows source path, context, anchors (with dead-anchor marking), and edge rows;
> a mini context graph renders the 1-hop neighborhood with verb labels and a `+N` indicator
> beyond the visible cut."
>
> — F059 spec L152-154

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

详情面板五要素：(1) source path；(2) context（节点正文）；(3) anchors 且死锚点有标记；(4) edge rows；(5) mini context graph——1 跳邻域、边带 verb 标签、超出可见截断处显示 `+N`。

---

## Where enforcement lives

均在 `apps/web/src/features/knowledge/KnowledgeMapPage.tsx` 详情分支（railView === 'detail' 且有选中节点，:1341-1508）：

**(1) source path**
```tsx
// KnowledgeMapPage.tsx:1408-1411
<dt className="text-slate-400 w-16 shrink-0">{t('knowledge.source')}</dt>
<dd className="font-mono ...">{selected.sourcePath}</dd>
```
并在 :1413-1424 按 kind 附带本地跳转链（`KIND_LOCAL_TARGET`，:158-165）。

**(2) context**：:1363-1372，`selected.body` 经 `<MarkdownMessage text={selected.body} codeCollapseAfterLines={8}/>` 渲染，标题 `t('knowledge.context')`。条件渲染：body 缺失时该节不出现。

**(3) anchors + 死锚点标记**
```tsx
// KnowledgeMapPage.tsx:1450-1452
const dead = mergedDto.drift.some(
  (d) => d.nodeId === selected.id && d.path === p,
);
```
死锚点行走红色样式（:1457-1461）并追加 `t('knowledge.deadAnchor')` 徽标（:1464-1468）。判定口径 = drift finding 的 (nodeId, path) 双键匹配，与 DTO `DriftFinding`（knowledge-dto.ts:26-32）一致。条件渲染：`selected.paths` 存在时才出 anchors 节（:1444）。

**(4) edge rows**：:1476-1507，`relatedOf`（:1100-1106）分 outgoing/incoming 两组渲染 `EdgeRow`（:557-601），行内展示 verb + 方向箭头（:572-576），推断边追加 provenance 标注（:590-597），点击行选中对端节点（:580）。

**(5) mini context graph**：`MiniContextGraph`（:246-424），挂载于 :1400-1405。
- 1 跳邻域：只收 `e.src === centerId || e.dst === centerId` 的边（:268-288）。
- verb 标签：每条边中点绘 `{it.verb}` 文本（:349-357）。
- 可见截断边界值 = **8**：`const shown = out.slice(0, 8)`（:289）；`hidden = out.length - shown.length`（:290）。
- `+N` 指示：
```tsx
// KnowledgeMapPage.tsx:416-420
{items.hidden > 0 && (
  <text x={items.cx} y={164} ...>
    +{items.hidden}
  </text>
)}
```
- 邻居节点可点击回选（:389-392）。零邻居时整个小图不渲染（:304 `if (items.shown.length === 0) return null`）。

**测试锚点**：e2e `apps/web/tests/e2e/knowledge.spec.ts:166`（source/context/anchors/dead-anchor/jump link 全查）、:185-220（ADR 详情 + edge rows + mini graph SVG）、:222-247（feature:F001 scaffolding.js 死锚点徽标，en/zh 双文案 `dead anchor|死锚点`）、:325-343（adr:0003 共 15 条边 → 显 8 隐 7 → 断言 `+7`）。

---

## Paths walked

- 选中节点有 body/paths/edges 的全量详情路径 ✓ — :1341-1508
- body 缺失 → 无 context 节 ✓（条件分支 :1363）
- paths 缺失 → 无 anchors 节 ✓（条件分支 :1444）
- 无任何边 → edge rows 节不渲染（:1478 `if (!outgoing.length && !incoming.length) return null`）且 mini graph 不渲染（:304）✓
- 死锚点命中路径（drift nodeId+path 双匹配）✓ — :1450-1452；不匹配路径（同节点其他 path）走正常样式 ✓
- `+N` 触发路径（邻边 > 8）✓ / 不触发路径（≤8 时 hidden=0 不渲染）✓ — :289-290, :416
- 推断边进入 mini graph（虚线 `strokeDasharray '4 3'`，:344-347）✓ — 1 跳口径含 inferred 边（mergedDto）

---

## Searched

- `sourcePath`（KnowledgeMapPage.tsx）→ 详情 :1411、跳链 label :1418；DTO 定义 knowledge-dto.ts:9。
- `deadAnchor|dead anchor`（apps/web）→ i18n en L70 / zh L1073、页面 :1466、e2e :246。
- `slice\(0, 8\)` → 1 命中 :289（唯一截断点，无其他可见截断常量）。
- `\+\{items.hidden\}` → 1 命中 :417。
- e2e `\+\d` 断言 → knowledge.spec.ts:325-343（`+7` 实数据断言）。

---

## How the verdict was reached

五要素在详情面板逐一定位到实现与 i18n 标签；mini graph 的 1 跳口径、verb 标签、截断边界值 8 与 `+N` 计算式都有唯一实现点，且 e2e 用真实仓库数据（adr:0003 十五条边）验证了 `+7`。条件渲染（body/paths/edges 缺失时省略对应节）是数据驱动省略而非功能缺失。无路径失守 → implemented。

---

## Open questions

1. `+N` 计数的是隐藏的**邻接边条目**而非去重后的邻居节点：同一邻居经两条边相连时在 shown 列表出现两次，且 SVG key 为 `node:${it.other.id}`（:390）会产生重复 React key（渲染告警+图形重叠）。spec 的 "+N beyond the visible cut" 未定义按边还是按节点计——按边实现成立，重复 key 是实现瑕疵，需浏览器/console 验证实际影响。
2. 截断值 8 与椭圆布局（:291-299）在长标题/高密度下的可读性——需浏览器验证。
3. mini graph 的 1 跳口径基于 `mergedDto`（含用户同意后的推断边，:1401 传入）：spec 未说明 mini graph 是否应含 inferred 边；实现以虚线区分（:344-347），按"与主图同一 DTO"裁定为合理，不降级 verdict。
