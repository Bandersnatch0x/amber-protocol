# REQ-05 — 输出经 schema 校验、稳定序发射：不变树上重算字节全同

> "Output is validated against `schemas/knowledge-graph.schema.json` and emitted in stable order: recomputation over an unchanged tree is byte-identical."
> — F059 spec L86-87

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 每次构建出的图在返回/发射前对照 `schemas/knowledge-graph.schema.json` 校验，失败即 fail-closed（不发射半成品）。
2. 节点、边、drift 有确定性排序，序列化无时钟、无绝对路径、无随机性。
3. 对未变更的树连续两次运行，stdout 字节完全相同。

---

## Where enforcement lives

- **构建即校验**：`scripts/lib/core/knowledge-graph.js:L831-L840` `validateGraph`——`compileSchema("knowledge-graph")` 不通过则抛 `AMBER_E_KNOWLEDGE_GRAPH_INVALID`（typed error，含 formatErrors 细节）。两条构建路径都必经：tree `L842-L847`、projection `L857-L867`——**没有绕过校验的返回分支**。schema 文件定位：`scripts/lib/core/schema-contract.js:L18` `SCHEMAS_DIR = path.join(__dirname, "..", "..", "..", "schemas")` + `L43-L48`（`<schemaName>.schema.json`）→ 即 `schemas/knowledge-graph.schema.json`。
- **稳定序**：节点按 id（`L807`）、边按 `(src, verb, dst)`（`L464-L468`）、drift 按 `(nodeId, path)`（`L652-L655`），全部普通字节比较（`a < b ? -1 : 1`），无 locale；模块头注释 L37-L42 声明"no timestamps beyond content-recorded dates, no absolute paths, no randomness"。`updated` 仅取内容内日期（ADR `**Date:**` L134、wiki frontmatter L162），schema `L39-L42` 注明 "never a scan-time clock"。
- **规范序列化单点**：`serializeKnowledgeGraph L869-L872`（`JSON.stringify(graph, null, 2)`；对象键序由 makeNode/addEdge 固定构造序决定）。CLI 发射：`scripts/lib/knowledge-commands.js:L39` `{ text: serializeKnowledgeGraph(graph), bypassPrint: true }` → `scripts/amber.js:L106-L112` 原样 `console.log(resolved.text)`，不经 printResult 包裹。
- **去重防抖**：边 `seen` 集合 `L382-L385`、context page 映射 first-wins（`L327`）、Map 聚合后统一排序——输入顺序不影响输出。

---

## Paths walked

- ✓ 本机实证（三次运行）：`node scripts/amber.js knowledge graph --target . --json` 两次输出经 `cmp` **字节全同**（194120 字节）；第三次去掉 `--json` 仍字节全同——发射路径唯一。
- ✓ 进程内重算：`tests/unit/knowledge-graph.test.js:L54-L58`（两次 `buildKnowledgeGraphFromTree` 序列化相等）。
- ✓ 真 CLI 双跑：`L524-L546`（spawnSync 两次、`first.stdout === second.stdout`、且解析后过 `validate("knowledge-graph", parsed)` 零错误）。
- ✓ 排序不变式：`L60-L69`（三个数组各自等于其排序副本、键唯一）。
- ✓ 失败路径 fail-closed：构造违约图无法从任何公开函数返回（validateGraph 抛出）；上游源损坏走 typed `AMBER_E_KNOWLEDGE_GRAPH_SOURCE`（L72、L226、L306-L318）；CLI 侧 `knowledge-commands.js:L35-L38` 把 typed error 转 exit 1 envelope（测试 `L224-L230`：`AMBER_E_PROJECTION_MISSING`）。
- ✓ projection 路径同样校验后发射：`L864-L866`；projection/tree 字节 parity 另证于 `tests/unit/knowledge-projection.test.js:L160-L170, L228-L269`。
- ✓ Windows 行尾陷阱：所有源文本读入即 `\r\n`→`\n` 规整（`readTextIfPresent L69`、projection 侧 `knowledge-projection.js:L173`），checkout 的 autocrlf 不影响字节稳定。

---

## Searched

- `validateGraph`（knowledge-graph.js）→ 定义 L831 + 调用 L844、L864 两处——两条构建路径各一，无未校验出口。
- `serializeKnowledgeGraph`（全仓）→ core 定义 L870-L872、CLI handler `knowledge-commands.js:L29,L39`、测试若干——**唯一发射面**；web 走 tRPC 返回对象（字节稳定性是 CLI 缝性质，web 缝由同一图对象保证内容等价）。
- `Date\.now|new Date\(|Math\.random`（scripts/lib/core/knowledge-graph.js）→ **0 hits**（无扫描时钟、无随机性）。
- `toSorted|localeCompare`（knowledge-graph.js）→ 0 hits——排序全为字节比较，无 locale 依赖。

---

## How the verdict was reached

"validated"与"byte-identical"都有双层证据：校验是构建函数的必经出口（代码路径穷举：两个 build 函数都以 `validateGraph(...)` 为 return 表达式），字节稳定既有仓内自动化测试（进程内 + 真 spawn 双跑）又有本次核查的独立 `cmp` 实测，且 `--json` 有无不改变字节。无时钟/随机/绝对路径由源码 0 命中支撑。所有失败分支均以 typed error fail-closed 而非发射降级输出，故 implemented 而非 partial。

---

## Open questions

无。
