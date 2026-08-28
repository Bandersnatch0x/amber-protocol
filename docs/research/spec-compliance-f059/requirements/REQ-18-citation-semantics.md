# REQ-18 — 引用语义：快照内即有效、服务端丢弃 + omittedCount、uncitable 类型化、superseded 可引可徽标

> "Citation semantics: a citation is valid iff the node id exists in the current snapshot. Segments whose citations are all absent or invalid are dropped server-side before the response; `omittedCount` reports the drops and the UI surfaces \"N uncited claims omitted\". An answer with zero surviving segments is a typed `uncitable-answer` error. Superseded nodes are citable — the UI badges the citation and links to the superseder; the prompt guides (not enforces) preferring current nodes for current-state questions."
> — F059 spec L134-139

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 有效性判据 = 节点 id 存在于当前快照（不是存在于 focus 上下文、不是 status 为 current）。
2. 全部引用无效的段在响应前服务端丢弃；`omittedCount` 精确等于被丢段数。
3. UI 呈现 "N uncited claims omitted" 文案（i18n en/zh）。
4. 零存活段 → 类型化 `uncitable-answer` 错误。
5. superseded 节点可被引用；UI 给引用打徽标并链到取代者；prompt 只引导不强制偏好 current 节点。

---

## Where enforcement lives

**(1) 有效性判据** — `apps/web/server/lib/knowledge-qa.ts:182,190`：

```ts
const validNodeIds = new Set(snapshot.nodes.map((node) => node.id));
...
const citations = [...new Set(segment.citations)].filter((id) => validNodeIds.has(id));
```

判据集合来自完整快照，不含 status 过滤（superseded 因此可引）也不缩到 focus 邻域——`knowledge-qa.test.ts:201-215` 专门断言 focus 上下文之外但快照之内的引用有效。

**(2) 服务端丢弃 + 精确计数** — `knowledge-qa.ts:186-196`：段内先去重再过滤无效 id；`citations.length === 0` 时 `omittedCount += 1; continue`，否则保留段。计数只在丢段处自增，无其他写点。空 `citations: []`（一条无效引用都没有）也计入——`knowledge-qa.test.ts:173-190` 用 3 段混合 fixture 断言结果恰为 `{ segments: [{text:'Mixed.', citations:['node:a']}], omittedCount: 2, supersededBy: {} }`。丢弃发生在 `answerKnowledgeQuestion` 组装响应之前（`knowledge-qa.ts:224-229`），客户端拿不到被丢的段文本。

**(3) UI 文案** — `apps/web/src/lib/i18n.tsx:125` en `'knowledge.ask.omitted': '{count} uncited claims omitted'`（与 spec 引号内文案逐字一致）；zh `i18n.tsx:1121` `'已省略 {count} 条无引用陈述'`。渲染点 `apps/web/src/features/knowledge/KnowledgeMapPage.tsx:821-823`：`result.omittedCount > 0` 时显示。

**(4) 类型化 uncitable-answer** — `knowledge-qa.ts:198` `if (segments.length === 0) throw new KnowledgeAskError('uncitable-answer')`；错误类型定义 `knowledge-qa.ts:75-80`（code 联合类型含 `'uncitable-answer'`）；router 映射为 `UNPROCESSABLE_CONTENT`、message 即错误码（`knowledge.ts:152-157`）；UI 专属文案 `KnowledgeMapPage.tsx:710-711` + `i18n.tsx:117/1114`。测试 `knowledge-qa.test.ts:192-199` 断言抛出 `new KnowledgeAskError('uncitable-answer')`。

**(5) superseded 可引 + 徽标 + 链接 + prompt 引导** —
- 服务端：`knowledge-qa.ts:199-212` 从确定性 `supersedes` 边（`candidate.origin === 'deterministic' && candidate.verb === 'supersedes' && citedIds.has(candidate.dst)`）构造 `supersededBy: Record<被引id, 取代者id[]>`，去重且稳定排序；`knowledge-qa.test.ts:217-228` 断言双取代者 `{'node:c': ['node:d','node:e']}` 全保留。
- 前端：`KnowledgeMapPage.tsx:733-773` `KnowledgeCitation`——`supersederIds.length > 0` 时渲染徽标 `t('knowledge.ask.superseded')`（L756-759；en `'superseded'` `i18n.tsx:126`，zh `'已被取代'` L1122），并对每个取代者渲染链接按钮 `t('knowledge.ask.supersededBy', { id })`（L761-770；en `'current: {id}'` L127，zh `'当前：{id}'` L1123），`onClick={() => onSelect(supersederId)}`，`onSelect` 即地图选中 `setSelectedId`（`KnowledgeMapPage.tsx:1339`）。`supersederIds` 取自服务端 `result.supersededBy[citation]`（L813）。
- prompt 引导：`knowledge-qa.ts:26`（CITED_QA_PROMPT 内）`"Prefer current nodes for current-state questions. Superseded nodes may be cited for historical claims."`——validator 侧无任何按 status/supersession 拒绝的分支（L182-198），"guides not enforces" 成立。

---

## Paths walked

- ✓ 段含混合有效/无效引用：无效 id 剔除、段存活、不计 omitted（`knowledge-qa.ts:190,195`；测试 L177,186）。
- ✓ 段引用全无效：丢弃 + 计数（L191-194；测试 L178,187）。
- ✓ 段引用为空数组：同上（测试 L179,187）。
- ✓ 全部段被丢：`uncitable-answer`（L198；测试 L192-199）。
- ✓ 引用 superseded 节点：有效 + supersededBy 填充（L182,199-212；测试 L217-228）。
- ✓ 多取代者：数组全保留、去重、按 `dst\0src` 稳定序（L201-211）。
- ✓ provider 输出违反 schema（>24 段、>12 引用、超长文本、多余字段）：`ProviderAnswerSchema.parse` 整体抛出（L181，schema L41-73），router 归一为 `knowledge-answer-unavailable`（`knowledge.ts:158-163`）——整答失败而非静默截断。
- ✓ UI omittedCount=0：不渲染 omitted 行（`KnowledgeMapPage.tsx:821`）。
- ✓ UI 引用 chip 点击选中节点：`KnowledgeMapPage.tsx:747-755` + e2e `knowledge.spec.ts:465-506`（citation chip 点击后 focus 变化断言）。

---

## Searched

- `omitted` in `apps/web/src` → `KnowledgeMapPage.tsx:821-823`、`i18n.tsx:125,1121`；in `apps/web/server` → `knowledge-qa.ts:184,191,213` 等（计数逻辑）。
- `superseded|supersededBy` in UI → `KnowledgeMapPage.tsx:735,740,756-770,813`；i18n en L126-127、zh L1122-1123。
- `uncitable` → `knowledge-qa.ts:76,198`、`knowledge.ts:154`、`KnowledgeMapPage.tsx:710-711`、`i18n.tsx:117,1114`、测试 L192-199。
- `status.*superseded|filter.*status` in `knowledge-qa.ts` → 0 命中（validator 不按节点状态过滤，可引性成立）。
- e2e `ask|omitted|superseded` in `knowledge.spec.ts` → ask 面板/引用 chip/zh i18n 有覆盖（L394,465-506,568-578）；omitted 行与 superseded 徽标无 e2e 命中（见 Open questions）。

---

## How the verdict was reached

不是 `partial`：五个子句各自定位到实现行号，服务端丢弃、计数精确性、类型化错误、superseded 双取代者保留均有通过的单测（本机 `npx vitest run` 26/26 绿）；UI 徽标/链接/文案在组件与 en/zh 词表中逐一在场。不是 `contradicted`：找不到按 status 拒引、客户端侧丢弃或计数偏差的代码。不是 `stronger-than-spec`：段内**部分**无效引用被剔除（L190）是 spec "valid iff exists" 判据的逐引用应用，不构成额外约束。UI 文案与 spec 引文逐字相同，排除 `undecidable`。

---

## Open questions

1. e2e（`knowledge.spec.ts`）未走 omitted 行与 superseded 徽标的浏览器渲染路径——stub provider（`knowledge-llm.ts:191-203`）恒返回单段单引用、无 superseded 命中；实现在单测层验证，浏览器层这两个视觉分支零覆盖，与 spec Testing Decisions L170-172 "UI behavior ... verified in a real browser" 存在缺口。
2. `validateCitedAnswer` 对段内重复引用去重（`knowledge-qa.ts:190` `new Set`）——spec 未规定重复引用的处理；去重改变 `citations` 数组长度，属未记录行为。
3. supersededBy 只追确定性 `supersedes` 边一跳（L201-207）——取代链 A→B→C 中引用 C 只徽标到 B 不到 A；spec "links to the superseder"（单数）与此一致，但多级链的 UI 语义未在 spec 钉死。
