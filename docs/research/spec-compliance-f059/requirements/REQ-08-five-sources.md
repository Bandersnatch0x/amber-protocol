# REQ-08 — recentChanges 五源只读聚合（git argv 白名单）

> "`knowledge.recentChanges` is a read-only tRPC query mapping five sources: git log (read-only, argv-whitelisted), feature-list change parsing, ADR `Date:` lines, the graph's `drift[]`, and maintenance inspect findings reused as-is."
> — F059 spec L96-98

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. `knowledge.recentChanges` 必须注册为 tRPC **query**（零变更面）。
2. 恰好五个数据源，逐一存在且进入同一聚合：
   a) git log — 只读 git 子命令，参数来自固定白名单（argv 数组，非 shell 拼接）；
   b) feature-list 变更解析；
   c) ADR `Date:` 行解析；
   d) 图的 `drift[]`；
   e) maintenance inspect 结果按原样复用（不重新实现检查逻辑）。
3. git 调用不得执行任何写操作，参数不可被请求方注入。

---

## Where enforcement lives

**tRPC query 注册**（`apps/web/server/routers/knowledge.ts:60`）：

```ts
recentChanges: publicProcedure.query(() => listRecentChanges(resolveRepoRoot())),
```

`knowledge-router.test.ts:45-51` 断言整个 knowledgeRouter 零 mutation（`knowledge-llm.test.ts:500-501` 再次断言 every procedure type === 'query'）。

**五源聚合点**（`apps/web/server/lib/knowledge-recent.ts:382-407`，`listRecentChanges`）：

```ts
const [git, features, gates] = await Promise.all([
  collectGitChanges(repoRoot),          // 源① git log
  collectFeatureChanges(repoRoot),      // 源② feature-list 变更
  listGates(),
]);
const adrs = collectAdrChanges(repoRoot, RECENT_CHANGES_LIMIT);              // 源③ ADR Date:
const drift = collectDriftChanges(buildKnowledgeGraph(repoRoot).drift, ...); // 源④ drift[]
const maintenance = collectMaintenanceChanges(inspectMaintenance(repoRoot), ...); // 源⑤ maintenance
```

**源① git argv 白名单**（`knowledge-recent.ts:22-31`）：

```ts
export const GIT_EXECUTABLE = 'git';
export const GIT_RECENT_ARGS = [
  'log', '-n', '20', '--pretty=format:%H%x1f%cI%x1f%s', '--date=iso-strict', '--', '.',
] as const;
```

- 参数是模块级 `as const` 冻结常量；`runGitHistory`（L167-184）为模块私有，仅有 `collectGitChanges`（L186-191）与 `collectFeatureChanges`（L193-198）两个调用点，各自绑定固定常量数组——不存在任何把用户输入拼进 argv 的路径。
- 执行方式为 `promisify(execFile)`（L1, L21）：数组 argv、无 shell、`windowsHide: true`、`maxBuffer: 1MB`（L174-179）。
- 命令本体是 `git log`（只读）；两个 argv 常量均无任何写子命令。
- `knowledge-recent.test.ts:40-80` 逐字节断言 executable === 'git'、argv 与常量全等、options 全等（标题即 "uses the constant git executable and fixed bounded argv without a shell"）。

**源② feature-list 变更解析**（`knowledge-recent.ts:32-40`）：`FEATURE_HISTORY_ARGS` 以独立 pathspec `-- feature_list.json` 解析该文件的提交历史；`knowledge-recent.test.ts:82-120` 断言其固定 argv。实现方式是"经 git 历史解析 feature_list.json 变更"，`knowledge-router.test.ts:98` 对真实仓库断言 source 'feature' 非空。

**源③ ADR `Date:` 行**（`knowledge-recent.ts:217-254`）：正则 `/^\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})\s*$/m`（L236）逐个解析 `docs/adr/*.md`；`knowledge-recent.test.ts:152-171` 覆盖有日期/无日期两分支。

**源④ drift[]**（`knowledge-recent.ts:256-277` + L390）：直接消费 `buildKnowledgeGraph(repoRoot).drift`——与 graph query 同一解析器（`scripts/lib/web-adapter.js:33,469`）。

**源⑤ maintenance 原样复用**（`knowledge-recent.ts:279-334` + L391）：`inspectMaintenance` 经 `scripts/lib/web-adapter.js:452-453` 直通 `scripts/lib/core/maintenance.js:272` 的同名函数——即 CLI 维护检查的同一实现，无重写。`collectMaintenanceChanges` 只做字段挑选与文本透传；`knowledge-recent.test.ts:222-237` 的用例标题即 "passes maintenance finding text through without synthetic interpretation"。

**运行时证据**：`npx vitest run tests/server/knowledge-recent.test.ts tests/server/knowledge-router.test.ts`（本次核查实跑）——含上述断言在内 4 文件 79 用例全部通过；`knowledge-router.test.ts:88-98` 对真实仓库断言返回集同时含 git/feature/adr/drift 四种 source。

---

## Paths walked

- ✓ 正常路径：`recentChanges` query → `listRecentChanges` → 五源并发/顺序采集 → 合并（L402-406）。
- ✓ git 失败路径：`runGitHistory` catch → `RecentChangeSourceError`（L82-92, L181-183）→ query 整体拒绝 → 前端 `recentError` 分支渲染错误+重试（`KnowledgeMapPage.tsx:1539-1551`）；空 stdout 与执行失败区分（`knowledge-recent.test.ts:122-135`）。
- ✓ ADR 目录缺失路径：`readdirSync` catch 返回 `[]`（L229-231）。
- ✓ feature_list.json 缺失/损坏路径：`readFeatureIds` catch 返回空集（L212-214）。
- ✓ maintenance 字段缺失路径：全部 `?? []` / 可选链防御（L290-331）。
- ✓ 注入路径（不可达）：`runGitHistory` 非导出；两个导出采集器不接受调用方参数进入 argv（`run` 注入点仅供测试替换执行器，args 仍取常量）。

---

## Searched

- `execFile|spawn(` in `apps/web/server`（排除 test）→ 3 文件：`api-port.ts`（node 探针）、`knowledge-recent.ts`（本需求）、`services/evidence-jobs.ts`（evidence 任务，非 knowledge 路径）——knowledge 面内 git 调用仅此一处。
- `GIT_RECENT_ARGS|FEATURE_HISTORY_ARGS` → 定义于 `knowledge-recent.ts:23,32`，消费于同文件 L190/L197 与 `knowledge-recent.test.ts`；无第三处调用。
- `inspectMaintenance` in `scripts` → `core/maintenance.js:272`（定义）、`web-adapter.js:452`（直通）、`core/governance-report.js` 等 CLI 消费方——同一实现被复用。
- `subscription` in `apps/web/server/routers/knowledge.ts` → 0 hits（全部 `.query`）。

---

## How the verdict was reached

不是 partial：五源逐一定位到独立采集函数且全部汇入 `listRecentChanges`；git 只读、argv 冻结常量、无 shell 三点均有代码+测试双重锚定，无失守路径。不是 stronger-than-spec：`-n 20` 的每源上限与 1MB maxBuffer 是实现细节级防御，不改变规格语义。不是 undecidable："argv-whitelisted" 在此仓库语境下的合理判定标准（固定常量数组 + execFile 无 shell + 测试逐字节断言）全部满足。

---

## Open questions

- "feature-list change parsing" 规格未指明解析机制；实现选择 `git log -- feature_list.json`（提交历史解析）而非对文件内容 diff。该实现满足"feature-list 变更"语义且有独立 source 标签，记录备查。
