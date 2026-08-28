# REQ-25 — CLI 最高接缝 `amber knowledge graph --json` 的四项测试断言

> "The highest CLI seam is `amber knowledge graph --json`: tests assert schema validity, stable
> byte-order on recompute, the full node/edge population against the real repository tree, and
> the F001/F007 drift findings."
> — F059 spec L160-162

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

存在针对 `amber knowledge graph --json` 的测试，且四个断言点逐一到位：
1. 输出通过 schema 校验（`schemas/knowledge-graph.schema.json`）；
2. 对未变更的树重算时字节序稳定（byte-identical）；
3. 节点/边全量 population 是对**真实仓库树**断言的，不是 fixture；
4. F001（`scaffolding.js`→`scaffold.js`）与 F007（`loops/`→`loops.js`）两条漂移发现被断言。

---

## Where enforcement lives

测试文件：`tests/unit/knowledge-graph.test.js`（31 个测试）。四个断言点在**两个层面**各断言一遍：库接缝（`buildKnowledgeGraphFromTree(REPO_ROOT)`，`REPO_ROOT = path.join(__dirname, "..", "..")` 即真实仓根，knowledge-graph.test.js:27-30）与真实 CLI 子进程接缝（`spawnSync(node scripts/amber.js knowledge graph --target REPO_ROOT --json)`，knowledge-graph.test.js:524-577）。

**1. schema 校验** — knowledge-graph.test.js:34-39（库层）：

```js
test("real-tree graph validates against knowledge-graph.schema.json", () => {
	const verdict = validate("knowledge-graph", graph);
	assert.deepEqual(verdict.errors, []);
	assert.equal(verdict.valid, true);
	assert.equal(graph.schemaVersion, SCHEMA_VERSION);
});
```

CLI 层重复：knowledge-graph.test.js:538-541（`validate("knowledge-graph", JSON.parse(first.stdout))` → `assert.deepEqual(verdict.errors, [])`）。`validate()` 从 `schemas/` 目录按名加载 `<schemaName>.schema.json`（scripts/lib/core/schema-contract.js:18、:128-133），`schemas/knowledge-graph.schema.json` 存在。断言强度：**精确值**（errors 精确等于空数组，非仅 truthy）。

**2. 重算字节稳定** — knowledge-graph.test.js:54-58（库层，序列化两次全等）：

```js
test("recompute over an unchanged tree is byte-identical", () => {
	const first = serializeKnowledgeGraph(buildKnowledgeGraphFromTree(REPO_ROOT));
	const second = serializeKnowledgeGraph(buildKnowledgeGraphFromTree(REPO_ROOT));
	assert.equal(first, second);
});
```

CLI 层：knowledge-graph.test.js:543-546（两次 spawn，`assert.equal(first.stdout, second.stdout)`）。另有排序律断言 knowledge-graph.test.js:60-69（nodes 按 id、edges 按 (src,verb,dst)、drift 按 (nodeId,path) 已排序且唯一）。强度：**精确值**（整串字节全等）。

**3. 真实树全量 population** — 是**真实树**，不是 fixture：共享 graph 构建于真实仓根（knowledge-graph.test.js:29-30）。population 以"每个源文档必有其节点"的不变量形式断言：
- 每个 `docs/adr/NNNN-*.md` 有 decision 层 adr 节点，且语料下限 `adrFiles.length >= 24`（knowledge-graph.test.js:73-87）；
- 每个 `feature_list.json` 条目有 implementation 层 feature 节点（knowledge-graph.test.js:89-102）；
- 每个 architecture 页、wiki 知识页有节点，memory 节点数与 `MEMORY.md` 的 `## ` 节数**精确相等**（`assert.equal(graph.nodes.filter(n => n.kind === "memory").length, memorySections.length)`，knowledge-graph.test.js:104-134）；
- 每条边两端解析到已存在节点、无自环（knowledge-graph.test.js:136-146）；
- 已知真实边带 evidence 路径与行号（`adr:0005 supersedes adr:0002` 的 `evidence[0].path`/`line`，knowledge-graph.test.js:157-172）。

CLI 层加总量下限与独立可推导边样点（knowledge-graph.test.js:559-576）：

```js
assert.ok(parsed.nodes.length >= 43, `expected >=43 nodes, got ${parsed.nodes.length}`);
assert.ok(parsed.edges.length >= 80, `expected >=80 edges, got ${parsed.edges.length}`);
...
assert.ok(edge("adr:0003", "builds-on", "adr:0002"), "adr:0003 builds-on adr:0002");
```

强度：节点侧为**逐源文档存在性不变量**（文件头 L8-9 自述"never exact counts"，即刻意选择不变量而非精确总数）；边侧为下限 + 8 个精确样点，非穷举推导。

**4. F001/F007 漂移** — knowledge-graph.test.js:176-192（库层，kind 与 actualPath 精确值）：

```js
const finding = graph.drift.find(
	(d) => d.nodeId === "feature:F001" && d.path === "scripts/lib/core/scaffolding.js",
);
assert.ok(finding, "F001 finding missing");
assert.equal(finding.kind, "dead-anchor");
assert.equal(finding.actualPath, "scripts/lib/core/scaffold.js");
```

F007 同构（knowledge-graph.test.js:185-192，`path === "scripts/lib/core/loops/"`、`actualPath === "scripts/lib/core/loops.js"`）；CLI 层重复两条（knowledge-graph.test.js:548-556）；反向不变量"活锚不产生发现"（knowledge-graph.test.js:194-206）。强度：**精确值**。

---

## Paths walked

- ✓ schema validity：knowledge-graph.test.js:34-39（库）+ :538-541（CLI spawn）
- ✓ stable byte-order on recompute：knowledge-graph.test.js:54-58、:60-69（库）+ :543-546（CLI spawn）
- ✓ full node/edge population against the real repository tree：真实树（:27-30），逐源不变量 :73-87、:89-102、:104-134、:136-146、:157-172 + CLI 下限/样点 :559-576 —— 是真实树，非 fixture（fixture 测试另列于 :234-445，用于行为边界，不承担 population 断言）
- ✓ F001/F007 drift findings：knowledge-graph.test.js:176-183、:185-192（库）+ :548-556（CLI）

---

## Searched

- `ls tests/unit/` → `knowledge-graph.test.js` 存在（另见 `knowledge-projection.test.js`，覆盖投影读取器，不承担本条四断言）
- 文件内定位 `validate(`、`serializeKnowledgeGraph`、`drift.find`、`spawnSync` → 分别命中 :35/:539、:55-56/:220、:177/:186/:549/:553、:528
- `grep -n "knowledge-graph" scripts/lib/core/schema-contract.js` → 0 命中（按名动态加载，schema-contract.js:18 `SCHEMAS_DIR`、:133 `validate(schemaName, data)`）；`ls schemas/knowledge-graph.schema.json` → 存在
- CI 门：`.github/workflows/ci.yml:85-86`（`npm test` = `node scripts/run-tests.js`，package.json:40，含 tests/unit）→ 该测试在 CI 真跑

---

## How the verdict was reached

四个断言点逐一定位到具体 expect/assert 原文，且每点在库接缝与真实 CLI 子进程接缝各有一份；population 明确构建于真实仓库根（非 fixture），以逐源文档不变量 + 精确 memory 计数 + CLI 总量下限成立。实际运行取证：`node --test tests/unit/knowledge-graph.test.js` → **31 pass / 0 fail**（本机，duration 11.9s）。CI 的 `npm test` 覆盖 tests/unit，测试真实在门上。故 implemented，confidence high。

---

## Open questions

1. 边的全量 population 采用"下限 80 + 8 个精确样点"（knowledge-graph.test.js:561-576），未对边集合做穷举推导断言；节点侧不变量已逐源穷举，边侧若视"full population"为字面穷举则强度略低——文件头 :8-9 明示这是刻意选择（"asserted through invariants … never exact counts"），按规格意图判 implemented，但字面主义读法下边侧仅为抽样。
2. `tests/unit/knowledge-projection.test.js` 与 dispatch 层 `AMBER_E_PROJECTION_MISSING` fail-closed（knowledge-graph.test.js:224-230）表明生产读取路径已切换到投影语料（docs/knowledge-corpus），而 population 不变量断言走 `buildKnowledgeGraphFromTree`；两者字节等价由 knowledge-graph.test.js:210-222 断言（dispatch 输出 === tree-reader 序列化），该等价是四断言点覆盖生产路径的桥梁——若未来两条路径分叉，本条的"真实树"断言随 :220 一起失效报警。
