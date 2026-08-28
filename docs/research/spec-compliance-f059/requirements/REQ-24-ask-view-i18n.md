# REQ-24 — Ask 视图、citation chip 联动与 i18n 全覆盖

> "The Ask view is a right-rail view switching with the Detail view; citation chips select and
> highlight nodes on the live map. All strings are i18n'd (en/zh)."
>
> — F059 spec L155-156

**Verdict:** partial · confidence: high

---

## What this demands of an implementation

1. Ask 视图位于右 rail，与 Detail 视图互斥切换（视图状态机）。
2. 回答中的 citation chip 点击后在**实时地图**上选中并高亮对应节点。
3. 页面全部字符串走 i18n（en/zh 双语），不残留硬编码文案。

---

## Where enforcement lives

**1. 视图切换状态机**

```tsx
// KnowledgeMapPage.tsx:998
const [railView, setRailView] = useState<'detail' | 'ask'>('detail');
```
- 切换按钮组 :1313-1327：`(['detail','ask'] as const).map(...)`，`aria-pressed={railView === view}`，onClick `setRailView(view)`。
- 分支渲染 :1329-1341：`railView === 'ask' ? <KnowledgeAskPanel .../> : selected ? <详情卡> : <selectPrompt 卡>`。二值状态、无第三态。
- 测试：`tests/client/KnowledgeMapPage.test.tsx:392-398`（aria-pressed 互斥断言）。

**2. citation chip → 地图选中 + 高亮**

```tsx
// KnowledgeMapPage.tsx:747-750（KnowledgeCitation）
<button type="button" onClick={() => onSelect(citation)}
  data-testid={`knowledge-citation-${citation}`} ...>
```
链路：`onSelect = setSelectedId`（:1339 传入 AskPanel → :869 → :810-816）→ `FlowCanvas selectedId`（:1275）→ 节点 `data.selected`（:472）→ 选中样式 `border-amber-400 dark:border-amber-600 shadow-glow-amber`（:613）；同时 `activeId = hoverId ?? selectedId`（:449）→ 邻域集合（:450-453）→ 关联边转 amber、加粗、动画并显 verb 标签（:501-516），非邻域节点 `opacity-30` 压暗（:471, :616）。superseder 链接同样走 `onSelect(supersederId)`（:761-770）。点击 chip 后 rail 保持在 Ask 视图（railView 不变），地图在旁实时联动。
- 测试：client :428-429（点击 chip → `data-selected="true"`）、:483-486（superseder 点击选中）；e2e `tests/e2e/knowledge.spec.ts:465-498`（"citation chips select live map nodes"，真数据）。

**3. i18n（en/zh）**

- 页面全部渲染文案经 `t()`（`useI18n`，:32, :898 等）；key 清单：en `apps/web/src/lib/i18n.tsx:34-127`，zh :1038-1123，两块 knowledge.* 键一一对应。
- 类型级强制：`i18n.tsx:1021` `const zh: Record<TranslationKey, string>`——zh 缺任何 en 键即编译失败；`t` 兜底 `dictionaries[language][key] ?? en[key]`（:2072）。
- 测试：client :536-548（zh 渲染 Ask 视图）；e2e :515-607（zh 全页 + header 语言实时切换）。
- **失守点**：`KnowledgeMapPage.tsx:593` EdgeRow 的 hover tooltip 硬编码英文：

```tsx
title={`inferred · ${edge.provenance?.provider}/${edge.provenance?.model} · prompt ${edge.provenance?.promptHash} · ${edge.provenance?.timestamp}`}
```
`inferred` 与 `prompt` 两个英文词不随语言切换（同元素的可见文本 :595 已用 `t('knowledge.inferredLabel')`，仅 title 属性漏网）。

---

## Paths walked

- detail → ask → detail 切换往返 ✓ — :1313-1327（client test :392-398）
- Ask 提交路径（disclosure → 输入 → submit → 结果段落 + citations + omitted 提示）✓ — :1034-1051, :775-828
- citation 点击（Ask 视图保持 + 地图选中）✓ — :748-750；client test :439 断言 ask panel 仍在
- superseded 徽标 + superseder 链接选中路径 ✓ — :756-770
- 错误/不可用/加载路径均 i18n（overflow/uncitable/invalidFocus/unavailable/invalidConfig）✓ — :700-731 → i18n key L111-118
- 硬编码 tooltip 路径 ✗ — :593（推断边 hover，双语言下均输出英文）
- 被过滤节点的 citation 选中路径 ✗ — 选中不解除 kind/search/driftOnly 过滤（flowNodes 过滤 :458），被隐藏的被引节点选中后地图上不可见（详见 Open questions 1）

---

## Searched

- 硬编码文案扫描（目检 KnowledgeMapPage.tsx 全 1597 行 JSX 文本与 title/aria/placeholder 属性）→ 命中 1：:593 tooltip（`inferred`/`prompt`）。:1164 `?? 'LLM'` 为专有名词兜底参数、:417 `+{N}`/:574 箭头/:1583 `·` 为符号、其余 title 值均为数据字段——不计失守。
- `knowledge\.`（i18n.tsx）→ en 块 L34-127 与 zh 块 L1038-1123 键集合相同（含全部 ask.*、rail.*、semantic.*）。
- `aria-label|placeholder`（页面）→ 全部经 `t()`（:315, :677, :808, :1161, :1311）。
- `useQuery.*ask`（页面）→ :1005-1012（`staleTime: 0, gcTime: 0`，与"citation 导航期间答案作用域真实"的 client test :378-440 一致）。

---

## How the verdict was reached

视图状态机、citation→选中→高亮链路、双语字典与类型强制均定位到实现并有 client + e2e 双层测试；"All strings are i18n'd" 是绝对断言，而 :593 的 tooltip 在任何语言下都渲染英文 `inferred`/`prompt`——主路径成立、一条展示路径失守 → partial。若将 title 提示视为非"string"口径之外，可升 implemented；本记录按字面绝对断言从严。

---

## Open questions

1. 被 kind/search/driftOnly 过滤隐藏的节点被 citation 选中后：`selectedId` 生效但节点不在 `flowNodes` 中（:458 过滤在前），地图上无可见高亮，详情视图切回后仍可显示该节点数据。spec 未定义此交互（是否应自动解除过滤/fitView 定位）——需浏览器验证与产品裁定。
2. 选中不触发 `fitView`（仅 `visibleIds` 变化触发，:490-493）：被选中节点可能在视口外，"highlight on the live map"的可感知性需浏览器验证。
3. `t(KIND_LABEL_KEYS[dto.kind])`（:636）在 kind 越界时传 undefined key——上游 reader 已白名单校验 kind（knowledge-graph-reader.ts:71-73），静态判定不可达；若未来 DTO 放宽需回看。
