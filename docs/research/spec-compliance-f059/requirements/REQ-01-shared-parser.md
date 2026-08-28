# REQ-01 — 共享解析器：CLI 与 web 同源，tRPC 读查询、不 spawn CLI

> "The parser ships in the Amber read-only CLI as `amber knowledge graph --json` and is shared by the web server; the two surfaces never diverge. The web server loads it through a tRPC read query, never by spawning the CLI per request."
> — F059 spec L75-77

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 存在 CLI 命令 `amber knowledge graph --json`，且它属于只读 CLI 面（graph 动作零写入）。
2. 解析器只有一份实现，web server 与 CLI 消费同一模块（不是各自解析 docs/adr、feature_list.json 等）。
3. web 端暴露为 tRPC **query**（读），不是 mutation。
4. web 每次请求通过进程内加载取图，不 spawn `node scripts/amber.js knowledge graph`。
5. 两个面输出的图内容一致（不 diverge）。

---

## Where enforcement lives

- **解析器单一实现**：`scripts/lib/core/knowledge-graph.js:L857-L867` `buildKnowledgeGraph(target, options)`，模块头注释 L3-L7 明确"shared by the CLI ... and the web server, loaded in-process by both so the two surfaces never diverge"。
- **CLI 注册链**：`scripts/lib/knowledge-commands.js:L9-L21`（`defineCommand({ command: "knowledge", actions: [... "graph" ...] })`）→ graph handler `L26-L40`：`buildKnowledgeGraph(resolveTarget(args))` + `serializeKnowledgeGraph(graph)`，返回 `{ text, bypassPrint: true }`。顶层接线：`scripts/lib/command-dispatcher.js:L1034-L1036`（`handleKnowledge`）、`L1202`（`knowledge: handleKnowledge`）；`scripts/lib/command-registry.js:L620-L653`（帮助文本，含示例 `amber knowledge graph --target . --json`）、`L1512`/`L1543`（`knowledge` 注册为 core 命令）。输出路径：`scripts/amber.js:L104-L121`——`bypassPrint` 时把 `result.text` 原样打到 stdout。
- **graph 动作只读**：`scripts/lib/core/knowledge-graph.js` 全文件 0 处写文件调用（见 Searched）；读取链 `readDocumentsFromProjection` → `knowledge-projection.js:L337-L413`（`readKnowledgeBaseProjection`，只 readFileSync + hashFile）。
- **web 进程内共享**：`scripts/lib/web-adapter.js:L33`（`const { buildKnowledgeGraph } = require("./core/knowledge-graph")`）、`L469`（re-export，注释 L468 "F059 knowledge-surface re-exports (read-only, no extra depth)"）→ `apps/web/server/lib/knowledge-graph-reader.ts:L10-L13`（`createRequire(import.meta.url)` 加载 `web-adapter.js`）→ `L121-L130` `readKnowledgeGraphSnapshot` 直接调用 `buildKnowledgeGraph(repoRoot)`。
- **tRPC 读查询**：`apps/web/server/routers/knowledge.ts:L57-L59` `graph: publicProcedure.query((): KnowledgeGraphDTO => readKnowledgeGraphSnapshot(resolveRepoRoot()))`。零 mutation 由 web 测试守护：`apps/web/tests/server/knowledge-router.test.ts:L45-L52`。
- **两面字节级一致（解析结果）**：`tests/unit/knowledge-graph.test.js:L210-L222`（dispatch 输出 == tree-reader 基线字节）；`tests/unit/knowledge-projection.test.js:L192-L205`（spawn 真 CLI == 进程内序列化）。

---

## Paths walked

- ✓ CLI 主路径：`amber knowledge graph --target . --json` → exit 0，输出 194120 字节合法 JSON（本机实测）。
- ✓ CLI 无 `--json`：输出与带 `--json` 字节相同（handler `bypassPrint: true` 恒真，`subcommand-dispatcher.js:L97` 的 `bypassPrint ?? !args.json` 被显式 true 覆盖）——`--json` 事实上是无操作旗标，命令形态与 spec 字面吻合。
- ✓ web graph 查询路径：`knowledge.ts:L57-L59` → reader → web-adapter → core，一次 require、进程内调用，每请求无子进程。
- ✓ web 其余知识查询复用同一 reader：`knowledge.semantic`（`knowledge.ts:L74`）、`knowledge.ask`（`L140`）都走 `readKnowledgeGraphSnapshot`；recentChanges 的 drift 源也复用同一 parser（`apps/web/server/lib/knowledge-recent.ts:L14-L15, L390`）。
- ✓ 失败路径：projection 缺失时 CLI 走 `readFailure` 返回 `AMBER_E_PROJECTION_MISSING` exit 1（`knowledge-commands.js:L35-L38`；测试 `tests/unit/knowledge-graph.test.js:L224-L230`）；core 抛同一 typed error（`knowledge-projection.js:L346-L350`），web 侧同函数同错误。
- ✗（不存在的路径，已确认）web 中第二份语料解析器：`apps/web/src/features/knowledge/fixture.ts` 含手写图数据，但 `apps/web/src` 内 0 处 import fixture——原型残留未接线，与 spec L188-L189"fixture is a DTO-shape reference only"一致。

---

## Searched

- `spawn|execFile|exec\(|child_process`（apps/web/server 全目录）→ 命中 8 文件：`api-port.ts:L164`（node 端口探针）、`evidence-jobs.ts:L25,L437`（验证命令 runner，非 knowledge 面）、`knowledge-recent.ts:L1,L21`（`execFile` 仅跑 `git log`，recentChanges feed）、其余为注释。**0 处 spawn amber.js 或 knowledge graph**。
- `buildKnowledgeGraph`（apps/web 全目录）→ 命中仅 `knowledge-graph-reader.ts:L11-L12,L122` 与 `knowledge-recent.ts:L14-L15,L390`，均经 `web-adapter.js`。
- `writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync`（scripts/lib/core/knowledge-graph.js）→ **0 hits**（graph 构建零写入）。
- `import.*fixture`（apps/web/src）→ **0 hits**（fixture 未进 shipped surface）。
- `serializeKnowledgeGraph` 全仓 → 命中仅 `knowledge-commands.js:L29,L39`、core 定义 `L870-L872`、两个测试文件——没有第二个发射面。

---

## How the verdict was reached

四个可检验性质全部有代码与运行证据：命令存在且只读（0 写入调用、exit 0 实测）；解析器由 `web-adapter.js:L469` 单点 re-export、web 经 `createRequire` 进程内加载；`publicProcedure.query` 注册且 mutation 数为 0 有测试断言；apps/web/server 全目录搜索证明无每请求 spawn。"never diverge" 由双向 parity 测试（进程内 vs spawn CLI、projection vs tree）字节级锁定。不选 partial：唯一的面间差异是 reader 的 DTO 改形（edge `provenance`→`origin`、node provenance 丢弃），那是 REQ-06 的守备范围，解析逻辑本身无第二实现。

---

## Open questions

- `--json` 在 `knowledge graph` 上是无操作旗标（有无该旗标输出字节相同）。spec 把命令写成 `amber knowledge graph --json`，实现将其宽化为"永远发射规范 JSON"。行为强于字面但未见文档记载此旗标语义。
