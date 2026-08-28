# REQ-07 — 最终数据源是 projection 输出；tree 直读仅为首版内部细节，切换不是阶段、面形不变

> "The final data source is projection output (ADR-0021 / ADR-0009 pages). The first implementation may read the tree directly and switch to projections as an internal detail — the switch is not a phase, and no shipped surface changes shape."
> — F059 spec L90-92

结合 spec L32-34（Solution #4）："the 43 knowledge artifacts become context pages (ADR-0009) so the knowledge-base projection is non-empty and the deterministic layer's data source becomes projection output"

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 生产路径（CLI 与 web 的默认路径）从 projection 输出取数，而非每次直接解析 docs/ 树——具体指：43 个知识文档经 ADR-0009 context page 管道进入 knowledge-base projection，图构建读该 projection 的输出。
2. tree 直读若存在，只能是内部细节：不得成为 shipped surface 上可见的"阶段"或模式开关。
3. 切换前后（tree 读 vs projection 读）输出形状乃至内容不得变化——两路产出必须一致。

---

## Where enforcement lives

- **默认源即 projection**：`scripts/lib/core/knowledge-graph.js:L857-L867` `buildKnowledgeGraph` — `const source = options.source || "projection"`；JSDoc `L850-L852` "Production reads the knowledge-base projection; use {source: \"tree\"} or buildKnowledgeGraphFromTree() only for explicit parity verification."
- **两个 shipped 面都不暴露开关**：CLI handler `scripts/lib/knowledge-commands.js:L34` `buildKnowledgeGraph(resolveTarget(args))`——不传 options，`--source` 之类旗标不存在；web reader `apps/web/server/lib/knowledge-graph-reader.ts:L122` `buildKnowledgeGraph(repoRoot)` 单参调用；tRPC `knowledge.graph` 无输入参数（`apps/web/server/routers/knowledge.ts:L57-L59`）。**切换不是阶段：任何用户可见入口都无从选择源。**
- **projection 输出的定义与读取**：`scripts/lib/core/knowledge-projection.js` — knowledge-base projection 由 ADR-0009 context pages 重建（`rebuildKnowledgeBaseProjection L415-L437`，输入 `state.artifacts` 即 context pages）；43 行 census `EXPECTED_COUNTS L22`（24 ADR + 10 wiki + 9 architecture = 43，注释 L17-L21 声明这是"deliberate gate"）；`context-sync` 在干净重建后把 manifest + projection 输出**逐字节拷贝**到 git 跟踪的 `docs/knowledge-corpus/`（`L266-L278`，`fs.copyFileSync(amberOutputPath, committedProjectionOutputPath(root))`）；生产读取 `readKnowledgeBaseProjection L337-L413`——census 校验（L377-L384，违约抛 `AMBER_E_PROJECTION_DRIFT`）+ 源新鲜度 normHash 校验（L390-L410，过期抛 `AMBER_E_KNOWLEDGE_SOURCE_STALE`）——**projection 与树悄然分叉时 fail-closed，而不是静默退回 tree 读**。
- **面形不变（parity）**：`tests/unit/knowledge-graph.test.js:L210-L222`（dispatch（projection）输出字节 == tree-reader 基线）；`tests/unit/knowledge-projection.test.js:L160-L170`（fixture 语料 sync 后双路字节相等）、`L192-L205`（真 CLI spawn == tree 序列化）、`L209-L226`（干净 checkout：43 个 contextPage、双路字节相等）、`L228-L269`（**git archive 干净克隆**上双路字节相等——生产验收测试）。

---

## Paths walked

- ✓ 生产默认路径：本机 `amber knowledge graph --target . --json` exit 0——`docs/knowledge-corpus/` 两文件在 git 跟踪中（`git ls-files` 确认；最近提交 `fd0825b fix(knowledge): restore projection/tree parity on clean archive (F059 #253)`），`.amber/` 被 gitignore——干净克隆可用性依赖 committed projection 输出，路径活。
- ✓ projection 缺失路径：fail-closed `AMBER_E_PROJECTION_MISSING`（`knowledge-projection.js:L346-L350, L359-L365`；测试 `knowledge-graph.test.js:L224-L230`、`knowledge-projection.test.js:L172-L175`）——不静默退回 tree。
- ✓ projection 过期路径：源文件与 manifest normHash 不符 → `AMBER_E_KNOWLEDGE_SOURCE_STALE`（L390-L410）——不提供陈旧图。
- ✓ 非法 source 值：`L861-L863` `AMBER_E_KNOWLEDGE_SOURCE_INVALID`。
- ✓ tree 路径仍存在但只在测试/parity 调用（见 Searched——生产代码零调用）。
- ✗→✓（部分源仍为 tree 直读，被 spec 显式豁免）：`buildKnowledgeGraphFromSources L732-L736`——即便 projection 模式，`parseMemorySections`（MEMORY.md）、`parseFeatures`（feature_list.json）、`parseArtifacts`（.amber/artifacts канonical 库）仍直接读树/库。这三类不在 43-corpus 内（spec L32-34 把 projection 化范围限定为"the 43 knowledge artifacts"），且 spec 本句明许"first implementation may read the tree directly ... as an internal detail"。混合读取未在任何 shipped surface 露形。

---

## Searched

- `buildKnowledgeGraphFromTree`（全仓）→ core 定义/导出（L842、L860、L879）+ **两个测试文件**（knowledge-graph.test.js、knowledge-projection.test.js 共 17 处）——生产代码（scripts/lib 非 core 处、apps/web）**0 调用**：tree 读确为 parity 专用。
- `source.*tree|"tree"`（buildKnowledgeGraph 调用点：knowledge-commands.js、web-adapter.js、knowledge-graph-reader.ts、knowledge-recent.ts）→ 0 处传入 `{source: "tree"}`——两个 shipped 面均走默认 projection。
- `readKnowledgeBaseProjection`（全仓）→ 定义 + `knowledge-graph.js:L690` 单一消费点——projection 读取无旁路。
- `committedProjectionOutputPath|knowledge-base.output.json` → 写入点 `knowledge-projection.js:L277`（context-sync 拷贝）与读取点 `L359`——committed 副本即 projection 输出本体的逐字节拷贝，不是第二种派生格式。

---

## How the verdict was reached

需求的三个可检验性质全部成立：(1) 默认与两个 shipped 面的实际数据源都是 knowledge-base projection 输出（43 页 ADR-0009 context pages 的重建产物的 committed 拷贝），且分叉/缺失/过期一律 fail-closed；(2) 切换不是阶段——没有任何旗标、路由参数或模式让使用者感知源的差别，tree 读退居 parity 验证；(3) 面形不变有五个独立 parity 测试直到 git-archive 干净克隆的字节级相等。memory/feature/artifact 三类源仍直读树，但 spec 以"first implementation may read the tree directly ... internal detail"显式豁免，且这三类从未属于 43-corpus 的 projection 化范围，故不构成失守，判 implemented。

---

## Open questions

- spec 括注 "(ADR-0021 / ADR-0009 pages)" 中的 ADR-0021（Governance Graph projection）在实现里**不是**图的数据源：artifact 节点来自 canonical 库直读（`parseArtifacts L253-L260` → `listArtifactRevisions`），而非 governance-graph projection 查询。若 spec 的"final"状态期待 artifact 节点也经 ADR-0021 projection 取数，该切换尚未发生（按本句仍属被豁免的内部细节）；spec 措辞本身未区分两个 ADR 各自覆盖哪些节点类，属规格模糊点。
- "最终数据源是 projection"对 MEMORY.md 节与 feature_list.json 无 projection 表示可读——若"final"要求全部源 projection 化，需要先扩 43-corpus census；当前 census 注释（knowledge-projection.js:L17-L21）把语料固定为 43，扩源需要有意识的规格更新。
