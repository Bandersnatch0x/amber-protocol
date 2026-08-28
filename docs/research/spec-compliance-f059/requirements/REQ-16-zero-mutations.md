# REQ-16 — ask 为 tRPC query，knowledge 路由零 mutation，无任何写副作用

> "`knowledge.ask({ question, focusNodeId? })` registers as a tRPC **query** — the knowledge router exposes zero mutations. The ask path reads only through the read-only knowledge-graph reader shared with the map query, and the response object is the sole output (no store, no projection, no filesystem writes)."
> — F059 spec L125-128

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. `knowledge.ask` 必须以 tRPC `query` 注册（不是 mutation、不是 subscription）。
2. knowledge 路由的**全部** procedure 都不得是 mutation——需全量枚举，不能只看 ask。
3. ask 调用链只能通过与 `knowledge.graph` 共享的只读 knowledge-graph reader 读数据。
4. 响应对象是唯一输出：调用链上不得写 store、projection 或文件系统。

---

## Where enforcement lives

**(1)(2) 路由全量枚举** — `apps/web/server/routers/knowledge.ts:56-165`，knowledge 路由恰好 5 个 procedure，全部 `.query(`：

- `graph` — `knowledge.ts:57` `publicProcedure.query(...)`
- `recentChanges` — `knowledge.ts:60` `publicProcedure.query(...)`
- `semanticStatus` — `knowledge.ts:62` `publicProcedure.query(...)`
- `semantic` — `knowledge.ts:66` `publicProcedure.query(...)`
- `ask` — `knowledge.ts:131-133` `publicProcedure.input(askInputSchema).query(...)`

`apps/web/server/app-router.ts:19` 仅在 `knowledge:` 键挂载一次该路由，无第二处注册。Express 侧仅有 `routes/errors.ts` 与 `routes/sse.ts`，均不含 knowledge 端点（grep 无命中）。

**(3) 共享只读 reader** — ask 与 graph 走同一函数同一参数：

```ts
// knowledge.ts:58 (graph query)
return readKnowledgeGraphSnapshot(resolveRepoRoot());
// knowledge.ts:140 (ask query)
snapshot = readKnowledgeGraphSnapshot(resolveRepoRoot());
```

`readKnowledgeGraphSnapshot`（`apps/web/server/lib/knowledge-graph-reader.ts:121-130`）经 `createRequire` 调 `scripts/lib/web-adapter.js:33` 再到 `scripts/lib/core/knowledge-graph.js`——该文件对 `writeFile|appendFile|mkdir|unlink|rmSync` 与 `spawn|execSync` 均零命中（仅正则 `.exec()`），是纯读取的树解析器，不是 per-request 拉起 CLI。`resolveRepoRoot`（`apps/web/server/lib/repo-root.ts:22-40`）只做 `existsSync`/`readFileSync` 探测。

**(4) 响应对象是唯一输出** — ask 调用链全量：`knowledge.ts:131-164` → `getStatus()`（`knowledge-llm.ts:119-127`，只读 env）→ `readKnowledgeGraphSnapshot` → `answerKnowledgeQuestion`（`knowledge-qa.ts:216-244`）→ `assembleKnowledgeContext`（纯计算）→ `completeWithMetadata`（`knowledge-llm.ts:144-170`，对 provider 的一次出站 `fetch`，无 fs）→ `validateCitedAnswer`（纯计算）→ 返回 DTO。`knowledge-qa.ts:1-14` 的 import 列表不含 `fs`、不含 `llmCache`（对照 `knowledge-llm-prompts.ts:4` 语义层确实引 cache）；ask 连内存缓存都不触碰。失败路径仅 `console.warn`（`knowledge.ts:142,158`）+ 抛 `TRPCError`，无落盘。

**测试锁定** — `apps/web/tests/server/knowledge-qa.test.ts:241-245` 断言 `knowledgeRouter._def.procedures` 每一项 `_def.type === 'query'`；`knowledge-router.test.ts:45-52` 反向断言 mutation 数为 0；`knowledge-qa.test.ts:286-299` 对 `fs.writeFileSync/appendFileSync/createWriteStream/fs.promises.writeFile` 布 spy，走完一次成功 ask 后全部未被调用；`knowledge-qa.test.ts:282-283` 断言 `llmCache.size === 0 && llmCache.inflightSize === 0`。

---

## Paths walked

- ✓ provider 未配置：`knowledge.ts:134-136` 直接返回 `{ status: 'unavailable' }`，不读图、不出站。
- ✓ 图读取失败：`knowledge.ts:141-147` catch → `TRPCError INTERNAL_SERVER_ERROR 'knowledge-graph-unavailable'`，无写。
- ✓ 成功路径：`knowledge.ts:149-150` → `knowledge-qa.ts:216-244`，响应对象含 answer/omittedCount/supersededBy/digests/provenance，全部内存构造。
- ✓ `KnowledgeAskError` 路径：`knowledge.ts:152-157` 映射为类型化 TRPCError，无写。
- ✓ provider 异常路径：`knowledge.ts:158-163` `console.warn` + TRPCError，无写（`knowledge-qa.test.ts:344-357` 覆盖）。
- ✓ stub provider 路径：`knowledge-llm.ts:154-156` → `buildStubResponse`（`knowledge-llm.ts:172-233`），纯字符串构造。
- ✗（不可达）mutation 注册路径：文件内不存在 `.mutation(` token。

---

## Searched

- `\.mutation\(` in `apps/web/server/**` → 11 处命中，全部位于 `gate.ts:164,182,331`、`lifecycle.ts:114`、`session-control.ts:339,390,413,445`、`transcript.ts:37,48`；`routers/knowledge.ts` 0 命中。
- `writeFile|appendFile|mkdir|unlink|rmSync` in `scripts/lib/core/knowledge-graph.js` → 0 命中。
- `spawn|execSync|exec(` in `scripts/lib/core/knowledge-graph.js` → 仅正则 `.exec()`（L117,126,133 等），无子进程。
- `knowledge`（大小写不敏感）in `apps/web/server/routes/`、`apps/web/server/services/` → 0 文件命中。
- `fs` import in `apps/web/server/lib/knowledge-qa.ts` → 0（import 仅 module/zod/DTO/knowledge-llm，L1-8）。

---

## How the verdict was reached

不是 `partial`：五个 procedure 逐一核对均为 query（`knowledge.ts:57,60,62,66,131-133`），写副作用在成功/失败/降级每条分支上都验证为不存在，且有运行时 spy 测试（本机 `npx vitest run` 26/26 通过）背书——没有失守的路径。不是 `stronger-than-spec` 作为主判定：代码确实多出一个规格未记录的强约束——`askInputSchema` 要求 `allowExternal: z.literal(true)`（`knowledge.ts:43`），缺席或为 false 时在读图与出站**之前**即拒绝（`knowledge-qa.test.ts:301-312`），这是额外的用户同意闸门；但它不改变"零 mutation/只读/唯一输出"这一被核查语句的满足状态，故记为附注而非替换判定。不是 `contradicted`/`absent`：证据充分且为正向命中。

---

## Open questions

1. `allowExternal: z.literal(true)`（`knowledge.ts:43`）与 UI 侧 disclosure 文案（`i18n.tsx:105-106`）构成规格 L125-128 未记录的更强同意约束——应回写进 spec 或作为文档发现上报。
2. `semantic` query（`knowledge.ts:66-129`）虽非 ask 路径，但会写进程内 `llmCache`（`knowledge-llm-prompts.ts:239,257`）；"零 mutation"指 tRPC 表面成立，内存缓存是否属于"store"的边界解释建议在 spec 术语表中钉死（当前 spec L117-118 已单独许可该缓存，倾向不构成冲突）。
