# REQ-09 — Drift 置顶、倒序、50 行上限、按需拉取

> "Drift findings pin to the top; changes sort reverse-chronologically; the panel caps at 50 rows and pulls on demand (no SSE subscription)."
> — F059 spec L99-100

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. drift 条目永远排在结果最前（置顶）。
2. 其余变更按时间倒序（最新在前）。
3. 最终输出 ≤ 50 行。
4. 面板数据按需拉取：无自动轮询、无 SSE 订阅；刷新由用户显式触发。

---

## Where enforcement lives

**置顶 + 倒序 + 上限**（`apps/web/server/lib/knowledge-recent.ts:367-380`，`orderAndCapRecentChanges`）：

```ts
const drift = items.filter((item) => item.source === 'drift').sort(compareById);
const dated = items
  .filter((item) => item.source !== 'drift' && Number.isFinite(Date.parse(item.time)))
  .sort(compareDatedNewest);
const undated = items
  .filter((item) => item.source !== 'drift' && !Number.isFinite(Date.parse(item.time)))
  .sort(compareById);
return [...drift, ...dated, ...undated].slice(0, limit);
```

- drift 段无条件拼在最前；`compareDatedNewest`（L54-57）为 `Date.parse(right) - Date.parse(left)`，即倒序，平局按 id 决定性排序。
- `RECENT_CHANGES_LIMIT = 50`（L41）为 `slice` 上限默认值；`listRecentChanges`（L402-406）以默认上限调用。
- 各源采集阶段另有 per-source 有界缓冲（`pushBounded` L59-71；git/feature 由 argv `-n 20` 限制），保证 cap 在合并前后都成立。

**测试锚定**：
- `knowledge-recent.test.ts:256-281`："pins all drift first, sorts dated rows newest-first with an id tie-break, and caps at 50"——构造 66 条混合输入，断言前两条全为 drift、随后三条按 2026-08-21 → 08-20 倒序、结果长度恰为 50。
- `knowledge-router.test.ts:88-114`：对真实仓库断言 `changes.length ≤ 50`、drift 全部位于首段且此后不再出现（L100-103）、dated 行两两满足 `Date.parse(prev) ≥ Date.parse(cur)`（L105-113）。
- 本次核查实跑上述测试，全部通过。

**按需拉取（无 SSE）**：
- 服务端：`knowledge.recentChanges` 是 `publicProcedure.query`（`routers/knowledge.ts:60`）；knowledge 路由五个过程全部为 query（`knowledge-router.test.ts:45-51`），无 `subscription` 关键字。
- 前端（`KnowledgeMapPage.tsx:878-884`）：

```ts
const recentQuery = trpc.knowledge.recentChanges.useQuery(undefined, {
  refetchInterval: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
  retry: false,
  staleTime: Infinity,
});
```

  刷新仅由面板按钮触发 `recentQuery.refetch()`（L1522-1529, L949）。
- E2E（`tests/e2e/knowledge.spec.ts:258-292`）：拦截 `/api/trpc/knowledge.recentChanges` 请求计数，断言页面加载后计数不再增长、点击 Refresh 后恰好 +1——"live, pinned, capped, manually refreshed"。
- 全仓 SSE 面检索：`text/event-stream` 仅 `server/routes/sse.ts:31`（会话事件）；`EventSource` 仅 `src/lib/hooks/useSessionEvents.ts`。knowledge 前后端零命中。

**面板 50 行**：面板对服务端返回数组 1:1 渲染（`KnowledgeMapPage.tsx:1557-1590`），服务端已 cap，故面板行数 ≤ 50。

---

## Paths walked

- ✓ drift + dated + undated 混合路径：三段拼接顺序固定（L379）。
- ✓ 纯 drift / 纯 dated / 空输入路径：filter 产生空段不影响拼接；空结果前端走 `recentEmpty` 分支（`KnowledgeMapPage.tsx:1552-1555`）。
- ✓ 时间平局路径：`compareDatedNewest` 以 `compareById` 决胜（L56），排序确定。
- ✓ 无效时间路径：`Number.isFinite(Date.parse(...))` 把不可解析时间归入 undated 段（L375-377），不会混入倒序段。
- ✓ 刷新路径：按钮 → `refetch()`；fetch 期间按钮禁用（L1526）。
- ✓ 自动推送路径（不可达）：无 subscription 过程、无 EventSource、`refetchInterval: false`。

---

## Searched

- `subscription|EventSource|text/event-stream` in `apps/web`（排除 tests）→ 2 文件（`server/routes/sse.ts`、`src/lib/hooks/useSessionEvents.ts`），均为 sessions 域；knowledge 域 0 hits。
- `RECENT_CHANGES_LIMIT` → 定义 `knowledge-recent.ts:41`，消费 L219/L388/L390/L391/L369 与两个测试文件；无绕过 cap 的第二出口。
- `recentChanges` in `apps/web/src` → 仅 `KnowledgeMapPage.tsx:878`（useQuery）与 DTO 类型；无第二个消费入口。

---

## How the verdict was reached

不是 partial：四个子性质（置顶/倒序/上限/按需）各自有独立实现点与独立测试（单元 + 路由 + E2E 三层），实跑通过；不存在绕过 `orderAndCapRecentChanges` 直接出货的路径（`listRecentChanges` 是唯一出口，L402）。不是 contradicted：无任何自动订阅代码。不是 undecidable：规格四个动词均可逐一映射到行号。

---

## Open questions

- 无时间戳的非 drift 行（maintenance 源，`time: ''`）被排在 dated 段之后按 id 排序（L375-377）。规格只规定"changes sort reverse-chronologically"，未规定无时间行的位置；实现选择"排尾、确定性 id 序"，不与规格冲突，记录备查。
