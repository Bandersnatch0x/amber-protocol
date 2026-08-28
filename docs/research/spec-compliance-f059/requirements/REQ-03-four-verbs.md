# REQ-03 — 边：恰好四个动词，declarer → declared 定向，anchors 是节点属性不是幽灵边

> "Edges: exactly four verbs — `supersedes`, `builds-on`, `references`, `describes` — directed declarer → declared. `anchors` is a node property, never a ghost edge."
> — F059 spec L81-82

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 边动词集合恰为 `{supersedes, builds-on, references, describes}`，无第五动词、无遗漏。
2. 方向语义：src 恒为做出声明的文档（declarer），dst 恒为被声明对象（declared）。
3. feature 的 `paths` 锚点只能以节点属性出现，图中不存在 `anchors` 动词的边，也不存在以裸路径为端点的边。

---

## Where enforcement lives

- **动词常量与 schema**：`scripts/lib/core/knowledge-graph.js:L58` `EDGE_VERBS = Object.freeze(["supersedes", "builds-on", "references", "describes"])`；`schemas/knowledge-graph.schema.json:L81-L84` verb enum 四值、边对象 `additionalProperties: false L77`、`L73` 描述 "Directed declarer -> declared edges ... Exactly four verbs."
- **全部 addEdge 调用点动词收敛**（`knowledge-graph.js`）：
  - ADR 头部血统块 `adrHeaderBlocks L341-L359`：verb 只能是 `"supersedes"`（`Supersedes...` 前缀）或 `"builds-on"`（L347），调用 L396/L403，src=adr.id（声明文档）。
  - ADR 正文命名 feature → `"describes"` L406-L408。
  - knowledge 层文档（wiki/architecture/memory）命名 ADR/architecture/wiki → `"references"` L423-L435；命名 feature → `"describes"` L436-L438。
  - feature 条目命名 ADR → `"references"` L442-L446（src=feature.id，即 feature_list.json 里做声明的条目）。
  - artifact Trace 映射 `traceVerb L449-L454`（supersedes→supersedes, refines/realizes→builds-on, decides→references），未注册 Trace 类型被跳过：`L457-L459` `if (!verb || !target ...) continue`——第五动词无从泄入。
- **anchors 为属性**：`makeNode L109` 把 `feature.paths` 写为 `node.paths`；schema `L48-L52` paths 描述逐字 "Declared anchors (a node property, never a ghost edge)."；`addEdge L381-L389` 的 src/dst 必须命中 `nodeIds`（L383 `!nodeIds.has(src) || !nodeIds.has(dst)` 即丢弃），裸路径不可能成为端点。
- **推断层同样收敛四动词**（虽属 spec 语义层章节，一并核查防止第五动词经 web 面回流）：`apps/web/server/lib/knowledge-llm-prompts.ts:L65` `VALID_VERBS` 四值、`L85` `verb: z.enum(VALID_VERBS)`——LLM 输出不合规即整调用失败。

---

## Paths walked

- ✓ live 输出动词分布：`{"builds-on":48,"supersedes":3,"describes":10,"references":31}`——恰四种，总计 92 条边。
- ✓ 方向抽查（declarer→declared）：`tests/unit/knowledge-graph.test.js:L157-L172` 断言 `adr:0005 supersedes adr:0002` 且 evidence.path 为 **0005**（声明方）源文件；`feature:F007 references adr:0003`（feature 条目是声明方）。CLI 缝再证：`L564-L576`。
- ✓ anchors 不成边：live 输出 `nodesWithPaths=52`、kinds=`["feature"]`（属性面）；`tests/unit/knowledge-graph.test.js:L148-L155`（F001 的 `scripts/lib/core/scaffolding.js` 在 paths 属性里）+ `L136-L146`（一切端点都是 kind 前缀 id）。
- ✓ 去重与自环拒绝：`addEdge L382-L385`（`src === dst` 丢弃、`seen` 去重）；live 输出边 key 唯一（测试 L64-L66）。
- ✓ 未注册 Trace 类型路径：`L457-L459` 跳过——fixture 测试 `L240-L288` 证明 `refines` 映射为 `builds-on`。
- ✓ web 面：reader `apps/web/server/lib/knowledge-graph-reader.ts:L62-L67` `EDGE_VERBS` 四值白名单，未知动词直接 throw（L93-L95）——parser 若产出第五动词，web 面 fail-closed。

---

## Searched

- `verb.{0,12}anchors|anchors.{0,12}verb|"anchors"`（全仓）→ **0 hits**——不存在任何以 anchors 为动词的边构造或 schema 残留。
- `addEdge\(`（knowledge-graph.js）→ 7 个调用点（L396、L403、L407、L424、L428-L431、L433-L437、L444、L460），动词全部落在四值集合，无变量动词从外部输入（traceVerb 映射是唯一间接源且键固定）。
- `EDGE_VERBS`（全仓）→ core 定义 L58 + 导出 L876、reader L62-L67 白名单、测试 L49——三处独立收敛。

---

## How the verdict was reached

四动词封闭性同时由生成端（7 个 addEdge 调用点常量动词 + traceVerb 固定映射 + 未知类型 continue）、契约端（schema enum + additionalProperties:false + 构建后必校验）、消费端（reader 四值白名单 fail-closed）三道闸保证，live 分布恰四种。anchors 的属性化有 0 命中的全仓反证与属性面正证。方向语义在每个调用点 src 恒为解析中的声明文档，测试以真实 ADR 对照锁定。没有任何一条路径能产出第五动词或幽灵边，故 implemented 而非 partial。

---

## Open questions

无。
