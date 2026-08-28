# REQ-10 — 本地跳转目标使用真实 id，禁止占位 id

> "Each entry may carry a local jump target — session, gate, transcript, route, or governance — rendered as an in-app link with **real ids from the live data source**. Placeholder ids are a prototype-only affordance and are not shippable."
> — F059 spec L101-103

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 跳转目标枚举恰为五类：session / gate / transcript / route / governance。
2. 链接以应用内路由渲染（非外链）。
3. `linkId` 必须来自对应活体数据源（会话列表、gate 列表、transcript 列表、route 列表、feature 注册表），逐一可验证。
4. 任何占位/捏造 id 不得出现在出货面；原型 fixture 不得被出货代码引用。

---

## Where enforcement lives

**DTO 枚举**（`apps/web/src/lib/knowledge-dto.ts:47`）：

```ts
linkTo?: 'sessions' | 'gates' | 'transcripts' | 'routes' | 'governance';
```

恰为规格五类。

**服务端活体校验**（`apps/web/server/lib/knowledge-recent.ts:342-365`，`attachVerifiedLink`）：

```ts
const candidates: Array<[RecentChangeItem['linkTo'], ReadonlySet<string>]> = [
  ['sessions', sources.sessionIds], ['gates', sources.gateIds],
  ['transcripts', sources.transcriptIds], ['routes', sources.routeIds],
  ['governance', sources.featureIds],
];
...
if (linkId) return { ...item, linkTo, linkId, linkLabel: linkId };
...
const withoutInvalidTarget = { ...item };
delete withoutInvalidTarget.linkTo;
delete withoutInvalidTarget.linkId;
```

- 五个候选集全部来自活体读取器（`knowledge-recent.ts:392-400`）：`readSessionList()`、`listGates()`、`listTranscripts()`、`listRoutes()`、`feature_list.json` 的 `readFeatureIds`。
- `containsId`（L336-340）要求 id 以词边界形式出现在条目文本中才附着；否则**删除**传入的 linkTo/linkId（L361-364）——预置占位 id 被主动剥除。唯一保留分支是 ADR 项的无 id governance 链接（L360，`linkId === undefined`），该分支不携带任何 id。

**前端应用内渲染**（`KnowledgeMapPage.tsx:167-244`，`LocalJumpLink`）：sessions→`/sessions/$id`（L180-193）、transcripts→`/transcripts/$id`（L194-207）、routes→`/routes/$id`（L208-221）、gates→`/gates`（L222-228）、governance→`/governance?featureId=...`（L229-242）；sessions/transcripts/routes 缺 linkId 时返回 `null`（L243）——不渲染坏链。所有目标均为 `@tanstack/react-router` 的 `<Link>`（应用内）。对应路由页面真实存在：`src/routes/sessions/$id/`、`src/routes/transcripts/$id.tsx`、`src/routes/routes/$id/`、`src/routes/gates.tsx`、`src/routes/governance.tsx`（其 `validateSearch` 于 governance.tsx:11-15 接受 `featureId`）。

**测试锚定**：
- `knowledge-recent.test.ts:283-322`：五类各给一个仅存在于对应活体集合的 id，断言逐类命中；再给一个预置 `linkTo: 'sessions', linkId: 'placeholder-session'` 的条目，断言输出 `not.toHaveProperty('linkTo')`——占位 id 被剥除。
- `knowledge-router.test.ts:116-140`（真实仓库）：对每个带 `linkId` 的输出条目，断言该 id 存在于对应活体读取器集合。
- E2E `knowledge.spec.ts:294-318`：断言面板内每个 `a[data-link-to]` 的 href 按类解析（`/sessions/<id>`、`/transcripts/<id>`、`/routes/<id>`、`/gates`、`/governance?featureId=<id>`）。
- 本次核查实跑服务端测试通过。

**原型 fixture 隔离**：`src/features/knowledge/fixture.ts` 存在但零引用——grep `features/knowledge/fixture|knowledge/fixture'` 于 `src`+`tests` → 0 hits；`src/features/knowledge/types.ts` 全部转口自 `knowledge-dto.ts`；`KnowledgeMapPage.tsx:877-897` 一律走 tRPC 活体数据。

---

## Paths walked

- ✓ 五类逐一附着路径（candidates 顺序 sessions→gates→transcripts→routes→governance，首中即止，`[...ids].sort()` L356 保证确定性）。
- ✓ 无匹配路径：linkTo/linkId 被删除（L361-364）→ 前端 `r.linkTo` 为空则不渲染链接块（L1577）。
- ✓ ADR 特例路径：governance 链接无 id → `/governance`（无 search 参数，L233），无占位 id。
- ✓ 前端防御路径：sessions/transcripts/routes 无 id → `LocalJumpLink` 返回 null（L243）；该路径在服务端校验下正常不可达，属双保险。
- ✓ 节点详情跳转（L1414-1423）：feature 节点 linkId 取自节点自身 id 的 `F###` 段（真实 feature id）；adr/知识类节点无 id 跳 governance/transcripts 列表——同样无占位 id。

---

## Searched

- `placeholder` in `apps/web/src` + `apps/web/server` → 命中仅 UI 文案 `placeholder=`（输入框属性）与测试中的反例 id；无占位跳转 id 常量。
- `features/knowledge/fixture` importers → 0 hits（fixture 为孤儿文件，types.ts 已改口 DTO）。
- `linkTo` 赋值点 → `knowledge-recent.ts:246`（ADR governance，无 id）与 `attachVerifiedLink` L357（活体校验后）两处；无第三处注入。

---

## How the verdict was reached

不是 partial：附着（活体集合）、剥除（占位）、渲染（五类 href）三段各有测试，且真实仓库路由测试对每个输出 id 做了逐条活体存在性断言；预置占位 id 的失守路径被 L361-364 显式封死并有测试钉住。不是 contradicted：无任何硬编码跳转 id。fixture 未被出货代码引用，"prototype-only affordance" 边界成立。

---

## Open questions

- gates 链接的 href 是列表页 `/gates`（不含 gate id；id 只进 `data-link-id` 与标签文案，`KnowledgeMapPage.tsx:222-228`；E2E L312 断言 href 恰为 `/gates`）。linkId 本身是活体 gate id，不违反"real ids"；但"链接直达该 gate"的粒度弱于 sessions/transcripts/routes。仓库无 `/gates/$id` 路由页，属产品粒度选择而非占位 id 问题，记录备查。
