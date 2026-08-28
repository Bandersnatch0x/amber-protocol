# REQ-02 — 三层本体：decision / knowledge / implementation，代码文件不是节点，context page 并入源节点

> "Ontology: three layers — decision (`adr:*`, `artifact:*`), knowledge (`wiki:*`, `memory:*`, `architecture:*`), implementation (`feature:*`). Code files are not nodes. Artifacts enter at identity granularity; a context page merges into its source artifact's node as a property."
> — F059 spec L78-80

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 节点 kind 恰好六种，layer 恰好三种，且 kind→layer 映射固定：adr/artifact→decision，wiki/memory/architecture→knowledge，feature→implementation。
2. 不存在以代码文件为主体的节点（`scripts/**`、`apps/**` 等不进图）。
3. Canonical Artifact 以 identity 为粒度建一个节点（多 revision 折叠为 `revisions` 计数），不是每 revision 一节点。
4. context page 不成为节点，而是作为其源文档节点上的属性（`contextPage`）出现。

---

## Where enforcement lives

- **六个节点构造器、别无其他**：`scripts/lib/core/knowledge-graph.js` — `parseAdrs L121-L146`（`adr:<4位号>`）、`parseArtifacts L253-L284`（`artifact:<type>/<identity>`）、`parseWikiPages L148-L172`（`wiki:<dir>`）、`parseMemorySections L193-L216`（`memory:<slug>`，MEMORY.md `##` 节）、`parseArchitecturePages L174-L191`（`architecture:<stem>`）、`parseFeatures L218-L251`（`feature:<id>`）。组装处 `buildKnowledgeGraphFromSources L738-L806` 逐 kind 指定 layer：L744（adr→decision）、L755（artifact→decision）、L767（wiki→knowledge）、L777-L778（memory→knowledge）、L788（architecture→knowledge）、L798（feature→implementation）。
- **schema 封死枚举**：`schemas/knowledge-graph.schema.json:L25`（id pattern `^(adr|artifact|wiki|memory|architecture|feature):.+$`）、`L30`（kind enum 六值）、`L32-L36`（layer enum 三值 + 描述逐字复述三层映射）、节点 `additionalProperties: false L21`。构建后强制校验：`knowledge-graph.js:L831-L840`。
- **identity 粒度**：`parseArtifacts L260-L273` 用 `byIdentity` Map 以 `${type}/${identity}` 聚合 revision，`entry.revisions += 1`、head 取最大 revision；节点携带 `revisions`（`L282`，schema `L62-L66`）。
- **contextPage 属性合并**：`knowledge-graph.js:L809-L814`（`pagesBySource.get(node.sourcePath)` → `node.contextPage = pageId`）；tree 缝从 committed manifest 取映射（`committedContextPagesBySource L663-L678`），projection 缝从 projection rows 取（`readDocumentsFromProjection L697`）；schema `L53-L56` 注明 "(ADR-0009)"。context page 自身从不 `makeNode`。

---

## Paths walked

- ✓ 实仓运行（`amber knowledge graph --target . --json` 实测）：105 节点，kinds=`{"adr":24,"architecture":9,"feature":57,"memory":5,"wiki":10}`；layerByKind=`{"adr":["decision"],"architecture":["knowledge"],"feature":["implementation"],"memory":["knowledge"],"wiki":["knowledge"]}`；43 个节点带 `contextPage`（24 adr + 9 architecture + 10 wiki，与 43 行 manifest 一致）。
- ✓ artifact 路径（实仓 0 个 artifact 节点——`.amber/` 被 gitignore，本 checkout 无 committed artifact）：由 fixture 测试证明——`tests/unit/knowledge-graph.test.js:L240-L288` 同一 identity 提交两个 revision 后仅一个节点、`revisions === 2`、layer=decision、body 取 head revision。
- ✓ context page 合并三条路：adr 源（`tests/unit/knowledge-graph.test.js:L290-L307`）、带 `#L` 片段的源 ref 规整（`L329-L346`）、artifact 身份目录源（`L348-L381`：无 manifest 条目→不设 `contextPage`；manifest 映射身份路径→设 `contextPage`）。
- ✓ 代码文件不进图：`tests/unit/knowledge-graph.test.js:L136-L146` 断言每个节点 id 匹配六前缀、每条边端点都解析为节点；live 输出无任何 `scripts/`、`apps/` 主体节点。
- ✗ **非 manifest 的 context page 不合并**：`.amber/context/pages/` 里存在但不在 43 行 manifest 的页（例如日后对某 canonical artifact 单独 distill 的页）在两条 live 路径上都不会写入 `contextPage`——通用扫描函数存在但未接线（见 Searched）。

---

## Searched

- `contextPagesBySource`（全仓）→ **2 hits**：定义 `scripts/lib/core/knowledge-graph.js:L291` 与 `docs/research/f059-knowledge-map-review.md:190`（该评审文档同样定性为死代码）。函数体 L291-L331 含 `ARTIFACT_REV_RE`（`.amber/artifacts/<dir>/<slug>/rev-N.md` → 身份目录）逻辑，即"任意 context page 按源 ref 并入节点"的通用实现，**零调用点**。
- `NODE_KINDS`（apps/web/server/lib/knowledge-graph-reader.ts）→ `L52-L60`：白名单含 `'knowledge'` 这个第七 kind；`apps/web/src/lib/knowledge-dto.ts:L5` 同。parser 与 schema 均不可能产出该 kind（schema enum 六值），此路径不可达，属 web 侧类型放宽。
- `makeNode`（knowledge-graph.js）→ 调用仅在 L739-L805 六个 map 内；无第七种节点来源。

---

## How the verdict was reached

四项性质在 core、schema、live 输出、fixture 测试四层都有证据且相互一致：live 的 kind/layer 分布逐字命中 spec 映射；identity 粒度有 `revisions:2` 的 fixture 实证；43/43 corpus 页以属性形式合并、0 个 context page 节点。不降为 partial 的理由：唯一失守候选是"非 manifest context page 不合并"，但 spec 自身把合并管道限定为"human-reviewed 43-row manifest"（spec L119-L121），manifest 门控与 spec 的治理意图一致，且 artifact 页经 manifest 仍可合并（测试 L370-L380 证明机制通用）；死代码不构成行为违背。

---

## Open questions

- `contextPagesBySource`（`knowledge-graph.js:L291-L331`）是完整实现却零调用的死代码——它代表另一种合并语义（直接扫 `.amber/context/pages/`、无需 manifest）。保留它会误导后续维护者以为运行时在用；这是文档/清理问题，不是合规问题。
- web DTO 的第七 kind `'knowledge'`（`knowledge-dto.ts:L5`、reader `L52-L60`）没有任何生产者，spec 与 schema 均无此 kind；属类型面宽于契约，建议收紧或记录。
