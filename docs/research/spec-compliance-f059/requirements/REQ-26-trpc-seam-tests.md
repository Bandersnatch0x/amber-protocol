# REQ-26 — Web 接缝（tRPC knowledge 查询）的五项测试断言

> "The web seams are the tRPC knowledge queries: schema, zero-mutation surface, recent-changes
> mapping and cap, jump-link targets resolving to real ids, and provider availability semantics
> (with and without a key)."
> — F059 spec L163-165

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

针对 tRPC knowledge 查询的测试覆盖五点：
1. schema（查询输入/输出契约形状）；
2. 零 mutation 面（且判定是枚举断言还是抽样）；
3. recent-changes 的五源映射与 50 条上限；
4. jump-link 目标解析到真实 id；
5. provider 可用性语义——有 key 与无 key 两种。

---

## Where enforcement lives

测试文件：`apps/web/tests/server/knowledge-router.test.ts`（13 测试）、`knowledge-recent.test.ts`（15 测试）、`knowledge-qa.test.ts`（部分）、`knowledge-llm.test.ts`（部分）。

**1. schema** — 属性级断言 + zod 输入契约测试，无 web 层 JSON-Schema 全量校验：
- knowledge-router.test.ts:40-42：`expect(result.schemaVersion).toBe('1')`（精确值）+ nodes 数组非空；
- knowledge-router.test.ts:71-80（每条边的 origin 字段枚举约束，parser 的 provenance 字符串不得泄漏）：

```ts
for (const edge of result.edges) {
  expect(edge).toHaveProperty('origin');
  expect(['deterministic', 'inferred']).toContain(edge.origin);
  expect(typeof (edge as Record<string, unknown>)['provenance']).not.toBe('string');
}
```

- drift 字段形状 knowledge-router.test.ts:142-157（nodeId/path/detail 存在、`d.kind` 精确 `'dead-anchor'`）；body 界 knowledge-router.test.ts:159-180（≤2000、非空）；
- `ask` 输入 zod schema（apps/web/server/routers/knowledge.ts:23-44）由拒绝路径测试：knowledge-qa.test.ts:308-309（缺失/false 的 `allowExternal` rejects）、:318（空 question rejects）、:319-322（无效 focus rejects `'invalid-focus-node'`）。
- 运行时形状还由读取适配器 fail-closed 保证（apps/web/server/lib/knowledge-graph-reader.ts:70-118 对未知 kind/layer/verb/provenance 抛错），上述 graph() 测试隐式穿过这层。
强度评注：**属性级/枚举断言**，非 `schemas/knowledge-graph.schema.json` 全量校验——但 web DTO 与 CLI schema 形状本就不同（多 origin/recentChanges 字段），JSON-Schema 全量校验在 CLI 接缝（REQ-25）完成。

**2. zero-mutation surface — 是枚举断言，非抽样**。knowledge-router.test.ts:45-51 枚举全部 procedures 过滤 mutation：

```ts
const procedures = Object.entries(knowledgeRouter._def.procedures);
const mutations = procedures.filter(([, proc]) => {
  const def = (proc as { _def?: { type?: string } })._def;
  return def?.type === 'mutation';
});
expect(mutations).toHaveLength(0);
```

更强的正向全称断言出现两处：knowledge-qa.test.ts:241-246 与 knowledge-llm.test.ts:500-501 均断言 `every(procedure => procedure._def.type === 'query')`——不只排除 mutation，连 subscription 也排除。

**3. recent-changes 映射与 cap**：
- 五源映射逐源单测（knowledge-recent.test.ts）：git（:40-80，含常量 argv 白名单 `GIT_RECENT_ARGS` 精确 deepEqual :63-71）、feature-list（:82-120）、ADR Date 行（:152-171）、drift（:194-206）、maintenance（:222-237）；每源 pre-merge cap（:173-192、:208-220、:239-252）。
- 排序与 50 上限精确值：knowledge-recent.test.ts:256-281 `expect(result).toHaveLength(50)`、drift 置顶 `['drift:a','drift:z']`、倒序时间 + id tie-break。
- live 路由层复证：knowledge-router.test.ts:88-114（`changes.length ≤ 50`、sources 含 git/feature/adr/drift、drift 前缀连续段、日期逆序逐对比较）。

**4. jump-link 解析真实 id**。live 层全称成员断言 knowledge-router.test.ts:116-140：

```ts
for (const change of changes) {
  if (!change.linkId) continue;
  expect(change.linkTo).toBeDefined();
  expect(liveIds[change.linkTo!].has(change.linkId), `${change.linkTo}:${change.linkId}`).toBe(true);
}
```

`liveIds` 由真实读取器构造（sessions/gates/transcripts/routes/governance，:123-131）。单测层：knowledge-recent.test.ts:283-322——五种 linkTo 各一正例，且预置 `linkTo/linkId` 的 placeholder 被剥离（`.not.toHaveProperty('linkTo')`，:309-321）。强度：**精确成员/全称断言**。

**5. provider 可用性语义（有/无 key）**：
- 无 key：knowledge-llm.test.ts:62-64 `expect(getStatus()).toEqual({ available: false, reason: 'not-configured' })`（精确对象）；semantic 查询 knowledge-llm.test.ts:497-499 `toEqual({ available: false, inferredEdges: [], nodeSummaries: [] })`；ask 查询 knowledge-qa.test.ts:234-240 `resolves.toEqual({ status: 'unavailable', reason: 'not-configured' })`。
- 有 key（stub provider）：semantic knowledge-llm.test.ts:504-518（`result.available` toBe(true)、inferredEdges/nodeSummaries 非空）；ask knowledge-qa.test.ts:248-284（`first.status` toBe('ok') + provenance `{provider:'stub', model:'stub-model'}`）。
- 无效配置族（azure provider、坏 model、坏 base URL）也各有精确 `invalid-config` 断言（knowledge-llm.test.ts:66-101）。强度：**精确值**。

---

## Paths walked

- ✓ schema：knowledge-router.test.ts:40-42、:71-80、:142-157、:159-180；ask 输入 zod 拒绝 knowledge-qa.test.ts:308-322（属性级，非 JSON-Schema 全量）
- ✓ zero-mutation surface：knowledge-router.test.ts:45-51（**枚举**）+ knowledge-qa.test.ts:241-246、knowledge-llm.test.ts:500-501（every=query，强于零 mutation）
- ✓ recent-changes mapping and cap：knowledge-recent.test.ts:40-252（五源逐一）+ :256-281（50 精确）+ knowledge-router.test.ts:88-114（live）
- ✓ jump-link targets → real ids：knowledge-router.test.ts:116-140（live 全称）+ knowledge-recent.test.ts:283-322（placeholder 剥离）
- ✓ provider availability with/without key：无 key knowledge-llm.test.ts:62-64、:497-499 与 knowledge-qa.test.ts:234-240；有 key knowledge-llm.test.ts:504-518 与 knowledge-qa.test.ts:248-284

---

## Searched

- `ls apps/web/tests/server/` → knowledge-router / knowledge-recent / knowledge-qa / knowledge-llm 四个 knowledge 测试文件
- 路由源 `apps/web/server/routers/knowledge.ts`（:56-165 全为 `.query`，仅 5 个 procedure：graph/recentChanges/semanticStatus/semantic/ask）与 `knowledge-graph-reader.ts:70-118`（fail-closed 适配）
- CI 门：`.github/workflows/ci.yml:216-218`（web job `npm run test`，working-directory apps/web）→ 这些测试在 CI 真跑

---

## How the verdict was reached

五个断言点全部定位到 expect 原文；zero-mutation 是对 `_def.procedures` 的**穷举枚举**且另有两处 every-query 全称断言。运行取证：按核查指定命令 `npx vitest run tests/server --root apps/web` 从仓根跑出 **18 failed / 295 passed**——失败全部集中于 knowledge 三文件，根因是测试用 `path.resolve(process.cwd(), '..', '..')` 求 SOURCE_ROOT（knowledge-router.test.ts:15、knowledge-qa.test.ts:16、knowledge-llm.test.ts:28），从仓根调用时 cwd 不是 apps/web，SOURCE_ROOT 解析到 `D:\`（非 git 仓库、无知识语料），属调用方式伪影；改从 `apps/web` 目录复跑（与 CI ci.yml:216-218 的 working-directory 一致）：knowledge 四文件 **79/79 pass**，全量 `tests/server` **30 文件 / 313 测试全 pass**。断言存在、强度达标、绿色在 CI 等价跑法下复证，故 implemented，confidence high。

---

## Open questions

1. 三个 knowledge 测试文件的 SOURCE_ROOT 依赖 `process.cwd()`（knowledge-router.test.ts:15 等），只有从 apps/web 目录（或 `npm run test`）调用才成立；`vitest --root apps/web` 从仓根调用即假失败 18 例。这是测试自身的环境脆弱点，不影响断言内容，但值得改为基于 `import.meta.dirname` 求根。
2. web 层无对 `schemas/knowledge-graph.schema.json` 的全量校验测试；"schema" 以属性级断言 + reader fail-closed + CLI 层全量校验（REQ-25）合成覆盖。若规格作者意图是 web 响应也过 JSON-Schema，则此点为弱化——现状下 web DTO 形状（origin/recentChanges）与该 schema 不同构，无法直接复用。
3. live 路由层的 recent-changes 测试未断言 `maintenance` 源出现（knowledge-router.test.ts:93-97 仅 git/feature/adr/drift）——真实仓当下 maintenance 可为空，五源中第五源仅在单测层（knowledge-recent.test.ts:222-252）覆盖。
