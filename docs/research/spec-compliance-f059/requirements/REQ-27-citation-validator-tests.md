# REQ-27 — 引文强制在校验器层的四项测试断言

> "Citation enforcement is tested at the validator: segments with no/invalid citations are dropped,
> `omittedCount` is exact, all-dropped answers error, and superseded ids pass."
> — F059 spec L166-167

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

在校验器（`validateCitedAnswer`）这一层存在测试，且四个断言点逐一到位：
1. 无引文/无效引文的 segment 被丢弃；
2. `omittedCount` 精确等于丢弃数；
3. 全部 segment 被丢弃时报错（typed `uncitable-answer`）；
4. superseded 节点 id 作为引文仍然通过。

---

## Where enforcement lives

测试文件：`apps/web/tests/server/knowledge-qa.test.ts`，`describe('cited answer validation')`（:172-229），直接调用被核查对象 `validateCitedAnswer`（导入自 `@server/lib/knowledge-qa`，knowledge-qa.test.ts:7-13）。测试快照自建 5 节点 6 边（:19-76），其中 `node:e supersedes node:c`、`node:d supersedes node:c` 两条 supersedes 边（:68-69）专为断言点 4 铺设。

**1+2. 丢弃语义与 omittedCount 精确值** — knowledge-qa.test.ts:173-190，一次 `toEqual` 全对象精确断言同时钉死两点：

```ts
const result = validateCitedAnswer(
  JSON.stringify({
    segments: [
      { text: 'Mixed.', citations: ['missing', 'node:a', 'node:a'] },
      { text: 'Invalid.', citations: ['missing'] },
      { text: 'Empty.', citations: [] },
    ],
  }),
  snapshot,
);

expect(result).toEqual({
  segments: [{ text: 'Mixed.', citations: ['node:a'] }],
  omittedCount: 2,
  supersededBy: {},
});
```

三种输入形态各占一席：混合（无效 id 被剔除且去重、segment 存活）、全无效（丢弃）、空引文（丢弃）；`omittedCount: 2` 是**精确值**且隐含"存活 segment 内被剔除的无效 id 不计入 omittedCount"（只数被丢弃的 segment）。强度：精确全对象。

**3. 全丢弃报错** — knowledge-qa.test.ts:192-199，typed error 精确匹配：

```ts
expect(() =>
  validateCitedAnswer(
    JSON.stringify({ segments: [{ text: 'Unsupported.', citations: ['missing'] }] }),
    snapshot,
  ),
).toThrowError(new KnowledgeAskError('uncitable-answer'));
```

强度：**精确错误类型 + 错误码**（`toThrowError(new KnowledgeAskError('uncitable-answer'))` 同时匹配构造与消息），与 spec L133-134 的 "typed `uncitable-answer` error" 逐字对应。路由层将其映射为 `UNPROCESSABLE_CONTENT`（apps/web/server/routers/knowledge.ts:152-156）。

**4. superseded id 通过** — knowledge-qa.test.ts:217-228，通过且保留全部 superseder：

```ts
expect(
  validateCitedAnswer(
    JSON.stringify({ segments: [{ text: 'Historical.', citations: ['node:c'] }] }),
    snapshot,
  ),
).toEqual({
  segments: [{ text: 'Historical.', citations: ['node:c'] }],
  omittedCount: 0,
  supersededBy: { 'node:c': ['node:d', 'node:e'] },
});
```

强度：精确全对象——`omittedCount: 0` 证实"citable"，`supersededBy` 精确映射到两个 superseder（供 UI 徽标/链接，spec L136-138）。相邻测试 :201-215 再补一条边界：快照内有效但在 focus 上下文之外的 id 也通过（citation 有效性以 snapshot 为准，非以喂入上下文为准，对应 spec L134 "valid iff the node id exists in the current snapshot"）。

---

## Paths walked

- ✓ segments with no/invalid citations are dropped：knowledge-qa.test.ts:173-190（三形态：混合/全无效/空引文）
- ✓ `omittedCount` is exact：同上 :185-189（`omittedCount: 2` 于 toEqual 全对象内，精确值）；反向 0 值于 :210-214、:223-227
- ✓ all-dropped answers error：knowledge-qa.test.ts:192-199（`KnowledgeAskError('uncitable-answer')` 精确）
- ✓ superseded ids pass：knowledge-qa.test.ts:217-228（通过 + supersededBy 精确映射）

---

## Searched

- `Grep "validateCitedAnswer" apps/web/tests/server/knowledge-qa.test.ts` → 4 命中（:12 导入、:174、:194、:206、:219 调用点，覆盖全部四断言场景）
- `Grep "uncitable"` → knowledge-qa.test.ts:198 与路由映射 apps/web/server/routers/knowledge.ts:154
- 端到端旁证：e2e stub 模式断言 cited segments 与 citation chips（apps/web/tests/e2e/knowledge.spec.ts:465-512），属 REQ-29 范畴，不承担本条
- CI 门：`.github/workflows/ci.yml:216-218`（web `npm run test`）

---

## How the verdict was reached

四个断言点在校验器直调层逐一定位，且全部为**精确全对象/精确错误**断言（无一处仅存在性断言）；测试快照显式构造双 supersedes 边使断言点 4 非平凡。运行取证：`npx vitest run tests/server/knowledge-qa.test.ts`（自 apps/web 目录）随四文件批次 **79/79 pass**；全量 `tests/server` 313/313 pass。故 implemented，confidence high。

---

## Open questions

1. "存活 segment 内的无效 id 被剔除但不计入 omittedCount"（:177 的 `'missing'` 与 :186 的 `omittedCount: 2`）——spec L135-136 说 `omittedCount` reports the drops（segment 级），测试语义与 spec 一致，但 UI 文案 "N uncited claims omitted" 中 claim=segment 的等式依赖此测试固定；若产品改为按 id 计数，此测试是唯一的语义锚。
2. 校验器测试全部使用手工快照（:19-76）而非真实图快照——对校验器这一纯函数层这是正确的隔离粒度（spec 说 "tested at the validator"），真实快照路径由 knowledge.ask 查询测试（:231-358）与 e2e stub 模式衔接，未构成缺口。
