# JS/TS 图分析生态调查 — 社区检测 + 中心性/度分析

对应决策票：#259（Knowledge Map v2 wayfinder）

- 日期：2026-08-28（npm 周下载窗口 2026-08-20…2026-08-26；GitHub 活跃度为当日快照）
- 方法：仅主源——npm registry（`npm view` / `api.npmjs.org` 下载 API / registry search API）、上游 GitHub 仓库（`gh api` 读 tree/README/commits/issues）、官方文档、论文原文（arXiv）。未采信二手博客/营销文。
- 关联内部文档：`docs/research/graph-rendering-library-choice.md`（渲染选型，已把 graphology 列为分析层预案）、`docs/research/f059-knowledge-map-review.md`（现图实测基线：105 节点 / 92 边 / 63 节点零连接）

## 1. 问题与结论摘要

**问题一句话**：Knowledge Map v2 要加社区检测（提案原话 NetworkX + Leiden，Python sidecar）与 god-node/度分析——JS/TS 生态能否在不引入第二运行时、不破坏供应链/许可证纪律的前提下满足？

**TL;DR 推荐**：

> **主选：`graphology` + `graphology-communities-louvain`（确定性配置：`randomWalk: false` 或注入种子 `rng`）+ 自写约 30 行 O(V+E) 社区连通性后验拆分（把 Leiden 的 Theorem 1 连通性保证以确定性后处理补上）。god-node/度分析直接用 graphology core 的 `degree()/inDegree()/outDegree()`，零额外包；需要 betweenness/PageRank/HITS 时再加 `graphology-metrics`。全链 MIT、纯 JS、无原生二进制、依赖闭包约 6–8 个包（同一作者）。**
>
> Python sidecar 没有必要：纯 JS 路线在 100–500 节点规模上完全覆盖需求。

**Leiden 判定**：「JS 生态缺 Leiden 实现」**字面证伪、实质证实**——npm 上存在 4 个 Leiden 实现（全部诞生于 2025-08 至 2026-06），其中 `leiden-ts` 甚至有对照 Microsoft graspologic 的交叉验证基准；但无一成熟：全部 ≤0.3.0/1.1.x、单维护者、≤3 star、周下载 ≤1.6k（对照 `graphology-communities-louvain` 的 18.2 万）。graphology 上游 monorepo 里躺着一份官方 Leiden WIP（`private: true`，休眠约 4 年未发布）。详见 §3。

## 2. graphology 生态评估

### 逐包表格（数据 2026-08-28 采自 npm registry 与 GitHub API）

| 包 | 最新版 | 发布日 | 周下载 | TS 类型 | 许可证 | 运行时依赖 | 出处 |
|---|---|---|---|---|---|---|---|
| `graphology` | 0.26.0 | 2025-01-26 | 1,562,253 | 自带 `dist/graphology.d.ts` | MIT | `events ^3.3.0` | [npm](https://www.npmjs.com/package/graphology) |
| `graphology-communities-louvain` | 2.0.2 | 2024-12-17 | 181,869 | 自带 `index.d.ts`；peer `graphology-types >=0.19.0` | MIT | `graphology-indices`, `graphology-utils`, `mnemonist`, `pandemonium` | [npm](https://www.npmjs.com/package/graphology-communities-louvain) |
| `graphology-metrics` | 2.4.0 | 2025-05-21 | 215,359 | 自带 `index.d.ts` | MIT | 上述 + `graphology-shortest-path` | [npm](https://www.npmjs.com/package/graphology-metrics) |
| `graphology-types`（peer） | 0.24.8 | 2024-11-22 | —（类型包） | 即类型包 | MIT | 无 | [npm](https://www.npmjs.com/package/graphology-types) |

**维护状态**：monorepo [graphology/graphology](https://github.com/graphology/graphology) 未归档，MIT，1,735 star，89 open issues，最近 push 2026-07-21——但核心包发布停在 2025-01（core 0.26.0）、louvain 停在 2024-12、metrics 停在 2025-05。定性：**成熟稳定、低频维护**，不是死项目（sigma.js 官方栈与 18 万+/周下载的下游把它压在“不能消失”的位置），但特性演进近乎停滞（Leiden 请求 4 年未落地，见 §3）。

**API 与本项目适配度**：
- **吃 `{id, src, dst}` 边表**：不能“直接”吃，但适配是个位数行数——`const g = new Graph({ type: 'undirected' }); nodes.forEach(n => g.addNode(n.id)); edges.forEach(e => g.mergeEdge(e.src, e.dst))`（`mergeEdge` 自动创建缺失端点；graphology 也支持 `Graph.from()` 序列化格式导入）。F059 DTO 排序稳定 → 插入顺序稳定 → 图构建确定性成立。注意本图存在双向对（如 `adr:0007 ⇄ architecture:web-viewer`，见 F059 审计 L3）：简单无向图会把 A→B 与 B→A 合并为一条边，社区检测视角下这正是想要的（或用边权 = 平行边数）。
- **Louvain 选项**（README，随包发布）：`getEdgeWeight`、`nodeCommunityAttribute`、`fastLocalMoves`（默认 true）、`randomWalk`（默认 true）、`resolution`（默认 1）、`rng`（默认 `Math.random`）。**决定论是本仓库硬约束（byte-identical recompute 纪律）：默认配置不确定，必须 `randomWalk: false` 或注入种子 rng**（README 明示可配 seedrandom 一类）。返回 0..n 整数社区标号；`louvain.assign()` 直接写节点属性；`louvain.detailed()` 给 modularity/dendrogram/count。支持无向、有向与 multi 图，不支持混合图。
- **度/中心性**：graphology core 原生 `degree()/inDegree()/outDegree()`——god-node = top-k by degree，**零额外依赖**。`graphology-metrics` 提供 degree centrality（归一化）、weighted degree、betweenness、edge betweenness、closeness、eigenvector、PageRank、HITS、eccentricity、modularity、density 等（README 目录，随包发布）。

## 3. Leiden 的 JS 实现：检索结果

### 检索方法

- npm registry 全量检索 `leiden`（search API，25 条结果）：绝大多数无关——`@leiden-js/*` 是 Leiden+ **铭文转写**（papyrology/EpiDoc）工具链，另有莱顿市政设计 tokens。真图算法命中 4 个（下表）。
- 直查包名：`graphology-communities-leiden`、`leiden-algorithm`、`leidenalg`、`leiden` 均 **404 不存在**。
- GitHub 上游检索：`graphology/graphology` 代码搜索命中 **`src/communities-leiden/`**（`index.js`/`utils.js`/`index.d.ts`/`test/`/`package.json`）——官方 WIP 实现真实存在，但 `package.json` 标 `"private": true`、版本 `0.0.1`，触及该目录的提交自 2022-09 后只是依赖 bump（实质实现休眠于 2021–2022），且未纳入 library 入口。上游 issue [#543 "Leiden communities?"](https://github.com/graphology/graphology/issues/543)（2025-05-29 开，5 条评论，至今 open）确认：目录有代码、npm 包不存在、未导出。

### 候选清单（按可用性降序）

| 包 | 版本 | 发布/推送 | 周下载 | 许可证 | 依赖 | 正确性证据 | 判定 |
|---|---|---|---|---|---|---|---|
| [`leiden-ts`](https://github.com/crodesrepos/leiden-ts) | 0.1.0 | 2026-04-26 发布；repo push 2026-07-20 | 785 | MIT | **0 运行时依赖**（纯 TS，typed-array CSR，ESM+CJS+d.ts） | **同类最强**：CI；对照 `graspologic.partition.leiden` 3.4.4 的交叉验证（karate/dolphins/football/httpx/LFR-1k×2/LFR-10k 七夹具，质量门 `Q ≥ Q_grasp − 0.05`、真值 NMI 门、逐夹具 BFS 断言 Theorem-1 连通性）；xoshiro128** 种子确定性、tie-breaking 与收敛条件成文；`Graph.fromEdgeList(n, [[s,d],…])` 直接吃边表；graspologic 形状 API | 工程素养异常高，但 **0.1.0 单版本、单（匿名）维护者、2 star**；modularity only（CPM 计划中）；node >=20.10 |
| [`ngraph.leiden`](https://github.com/anvaka/ngraph.leiden) | 0.3.0 | 2026-06-02 发布；repo push 2026-08-26（活跃） | 1,133 | npm 元数据 MIT，**repo 无 LICENSE 文件**（GitHub license: null） | `ngraph.fromdot`, `ngraph.random`, `ngraph.todot` | 11 个测试文件，含 `leiden-guarantees.test.js`、`refine.test.js`、`directed/multilayer/fixed/edge-cases`；README 明言 seeded deterministic、modularity+CPM+resolution、multilayer、fixed nodes；有 demo 与 CLI | 作者 anvaka（`ngraph.graph` 39.9 万/周生态）是最强信誉背书；但 0.3.0、3 star、bus factor 1、许可证文件缺失待补 |
| [`@aflsolutions/graphology-communities-leiden`](https://github.com/aflsolutions/graphology-communities-leiden) | 1.1.1 | 2026-04-26（创建到最后 push 共 22 分钟） | 1,558 | MIT | 与 louvain 包同族（`graphology-indices/utils`, `mnemonist`, `pandemonium`） | README 自述：**「extracted, repackaged copy」自上游 monorepo 未发布 WIP**，加 `maxIterations` 上限（针对 >100k 节点场景）；**提取仓库不含任何测试目录**（上游原目录有 `test/`，未随带出） | 上游自己以 `private: true` 表态未达发布质量；无测试的单人提取重发布，治理仓库不宜采信 |
| [`fast-leiden`](https://github.com/baseballyama/fast-leiden) | 1.1.0 | 2026-05-25；repo push 2026-07-16 | **11** | **GPL-3.0-or-later** | `node-addon-api`, `node-gyp-build`（**原生绑定** igraph/leidenalg C/C++ 库） | 上游 igraph/leidenalg 是学界参考实现，正确性继承自上游 | **双重排除**：GPL 传染 + 原生二进制供应链，且几乎无人使用 |

### 证实 / 证伪

- **证伪字面**：JS 生态并非没有 Leiden——存在 4 个实现，其中 2 个（`leiden-ts`、`ngraph.leiden`）有真实的测试与确定性设计，`leiden-ts` 的交叉验证方法论甚至超过多数学术配套代码。
- **证实实质**：**没有一个达到“成熟”**——全部诞生于近 12 个月、版本 <1.0 或刚过 1.x、单维护者、star ≤3、最高周下载 1.6k（作为对照：`graphology-communities-louvain` 18.2 万/周、发布 6 年+）。`leiden-ts` README 自己的开场白即「There is currently no mature pure-JavaScript Leiden implementation」。graphology 官方 WIP 四年未发布（issue #543 open）进一步佐证主流生态没有把 Leiden 当作已解决问题。

## 4. Louvain-only 的代价：本图规模下的工程判断

**Traag, Waltman & van Eck 2019（[arXiv:1810.08473](https://arxiv.org/abs/1810.08473)，Sci Rep 9:5233，[doi:10.1038/s41598-019-41695-z](https://doi.org/10.1038/s41598-019-41695-z)）原文要点**（摘自摘要，逐字）：

1. Louvain 缺陷："the Louvain algorithm may yield arbitrarily badly connected communities"，最坏情形 "communities may even be disconnected, especially when running the algorithm iteratively"。
2. 定量：其实验中 "up to 25% of the communities are badly connected and up to 16% are disconnected"。
3. Leiden 保证："the Leiden algorithm yields communities that are guaranteed to be connected"；迭代应用收敛到 "a partition in which all subsets of all communities are locally optimally assigned"（subset-optimal）。
4. 速度："the Leiden algorithm is faster than the Louvain algorithm and uncovers better partitions"。

**放到本图上**（F059 实测基线：105 节点 / 92 边，平均度 ≈1.75，63/105 = 60% 零连接孤立点；近期规划 100–500 节点）：

- **发生面**：badly-connected/disconnected 病理需要“社区大到内部有桥接结构、且聚合阶段把桥节点挪走”才会显形；论文的定量结论出自百万级实证网络（web、引文网络）的**迭代**运行。本图的连通部件本来就小而多（60% 是孤立点，社区尺寸预期个位数到十几），单次运行、小社区场景下病理发生概率低——即便发生，受影响的是单个小社区的成员归属，不是全图误导。
- **性能面**：500 节点 / 数百边规模下两种算法都是毫秒级，Leiden 的速度优势没有意义。
- **可修复面（关键）**：Leiden 相对 Louvain 的*可靠性*增量——连通性保证——可以在 Louvain 之后用一个 **O(V+E) 的确定性后验**完整补上：对每个社区在诱导子图内做 BFS，凡不连通即按连通分量拆成独立社区。约 30 行零依赖代码；这恰好也是 `leiden-ts` 自家 Theorem-1 gate 的做法（"every output community is internally connected — BFS-asserted"）。对本仓库而言，这个后验同时充当 fail-closed 的**质量门**（可写成断言/测试），比信任第三方算法内部保证更符合治理气质。
- **决定论 > 算法选择**：本仓库的 byte-identical recompute 纪律意味着首要风险不是 Louvain 的划分质量，而是**默认随机性**。`graphology-communities-louvain` 必须 `randomWalk: false` 或注入种子 rng；这一步配置比 Louvain/Leiden 之争重要一个数量级。

**结论**：100–500 节点、~100 边的小稀疏知识图谱上，"Louvain + 连通性后验拆分（确定性配置）" 与 Leiden 的实际产出差异可忽略；为拿到名义上的 Leiden 而引入 ≤6 个月历史、bus factor 1 的新依赖，其供应链风险大于算法收益。上千节点后重新评估（见 §7 触发条件）。

## 5. 备选路线对比

| 路线 | 最新版/日期 | 周下载 | 许可证 | 社区检测 | 度/中心性 | 判定 |
|---|---|---|---|---|---|---|
| **cytoscape.js**（headless） | 3.34.2 / 2026-08-25 发布，repo push 2026-08-27，11,188 star | 15,410,473 | MIT | 内置（[源码 `src/collection/algorithms/`](https://github.com/cytoscape/cytoscape.js/tree/master/src/collection/algorithms)）：`markov-clustering`（MCL）、`affinity-propagation`、`hierarchical-clustering`、`k-clustering`（k-means/k-medoids/fuzzy c-means）——**无 Louvain/Leiden，无模块度社区检测** | `degree-centrality`、`closeness-centrality`、`betweenness-centrality`、`page-rank` | 生态最健壮（0 运行时依赖、发布极活跃、[官方文档](https://js.cytoscape.org/)明示 headless Node 用法），但为算法层引入整个 ~5.7MB unpacked 的可视化框架；渲染选型时已落选；MCL 的随机游走流聚类语义与“知识社区”问题形态不同 |
| **@antv/algorithm** | 0.1.26 / modified 2026-06-10 | 251,221 | MIT | `louvain`、`iLouvain`、`labelPropagation`、`kMeans`、`kCore`（[发布产物 `es/index.js` 导出清单](https://unpkg.com/@antv/algorithm@0.1.26/es/index.js)）——无 Leiden | `getDegree/getInDegree/getOutDegree`、`pageRank` | **唯一直接吃 `{nodes, edges}` 平面数据**的候选（G6 GraphData 形状）；但永久 0.x、定位是 G6 配件、文档薄；deps：`tslib`, `@antv/util` |
| **ngraph 系** | `ngraph.graph` 20.1.2（**BSD-3-Clause**，39.9 万/周）；`ngraph.centrality` 2.2.0（MIT，modified 2026-03，2,516/周，push 2026-08-16）；`ngraph.louvain` 2.0.0（MIT，**2022 后未动**，239/周）；`ngraph.leiden` 0.3.0（见 §3） | 见左 | BSD-3 + MIT 混合 | louvain（旧）/ leiden（新，0.3.0） | degree/betweenness/closeness（`ngraph.centrality`） | anvaka 单人生态：产出质量高、活跃，但 bus factor 1；若采 `ngraph.leiden` 需连带引入 ngraph 图模型（与 graphology 二选一，避免双图模型并存） |
| **d3 生态** | — | — | ISC | **无**：d3 org 无任何社区检测/聚类分析模块（org 仓库清单核实，无 communit/cluster/louvain/leiden 命中；`d3-hierarchy` 的 cluster 是 dendrogram *布局*） | 无（`d3-force` 只做布局） | 不是分析层选项；继续只作渲染布局 |
| **Python sidecar（NetworkX/leidenalg）** | — | — | leidenalg **GPL-3**（wrap libleidenalg C++ → igraph） | Leiden 参考实现 | 全套 | 第二运行时 + C/C++ 构建面 + GPL 组件；本研究证明纯 JS 已覆盖需求，**不必要** |

## 6. 供应链与许可证

**主选（graphology 路线）依赖闭包**（`npm view` 逐包核实，全部纯 JS、无 install scripts 型原生构建、无二进制）：

```
graphology@0.26.0            → events@3.3.0                      (MIT)
graphology-communities-louvain@2.0.2
  → graphology-indices@0.17.0 → graphology-utils, mnemonist      (MIT)
  → graphology-utils@2.5.2                                       (MIT)
  → mnemonist@0.40.x          → obliterator@2.0.5                (MIT)
  → pandemonium@2.4.1         → mnemonist                        (MIT)
  (peer) graphology-types@0.24.8                                 (MIT)
可选 graphology-metrics@2.4.0 再加：
  → graphology-shortest-path@2.1.0 → @yomguithereal/helpers      (MIT)
```

- 闭包 6–8 个包、深度 ≤2，**全 MIT**，且几乎全部出自同一作者（Guillaume Plique / Yomguithereal，Sciences Po médialab）——供应链信任面收敛于一人一组织，审计成本低；反面是同一人的维护节奏决定全族命运（见 §7 触发条件）。
- **许可证族雷区**：`fast-leiden` 是 GPL-3.0-or-later（且 node-gyp 原生构建）——MIT 仓库直接排除；`ngraph.graph` 是 BSD-3-Clause（兼容 MIT，但许可证清单多一族）；其余候选均 MIT。`ngraph.leiden` npm 元数据 MIT 但 repo 缺 LICENSE 文件，采用前必须等其补齐。
- **原生二进制**：所有推荐路线为 0；唯一含原生绑定的是 `fast-leiden`（已排除）。
- **`leiden-ts` 特例**：0 运行时依赖是全场最干净的树；若未来需要真 Leiden，其单文件级代码量 + MIT 也适合以 vendoring（拷入 + 溯源注记）方式消化 bus factor 1 风险——这符合本仓库对可审计性的偏好，留作 §7 的备选路径。

## 7. 推荐与重评触发条件

**主选**（v2 确定性分析层）：

1. `graphology` + `graphology-communities-louvain`，固定配置 `{ randomWalk: false }`（或注入种子 rng）+ 显式 `resolution`，保证字节稳定输出；
2. 自写 O(V+E) 社区连通性后验：逐社区 BFS，不连通即按连通分量拆分——把 Leiden 的 Theorem-1 保证变成自家可测试的确定性门（单测断言“每个输出社区内部连通”）；
3. god-node/度分析用 graphology core `degree()` 系 API（零额外包）；需要 betweenness/PageRank 再引 `graphology-metrics`；
4. DTO 适配层保持渲染无关（沿用 ticket 0003 的 nodes/edges DTO），约 10 行 `mergeEdge` 构图。

这与 `docs/research/graph-rendering-library-choice.md` 的既有预案自洽——该文早已把「需要 graphology 做 centrality/communities」列为架构演化的预期方向（其切换条件 (c)），且不要求更换渲染层。

**备选**：

- **若规格明文要求 Leiden 算法本身**：首选评估 `ngraph.leiden`（作者信誉 + guarantee 测试；前提：补 LICENSE、≥1.0 或 API 冻结声明）与 `leiden-ts`（最强正确性证据；前提：>0.1.0 或走 vendoring 路线）。不采 `@aflsolutions/*`（上游未认可的无测试提取）与 `fast-leiden`（GPL + 原生）。
- **若想零新增依赖家族且未来本就要 headless 图算法平台**：cytoscape.js headless（MCL + 全套 centrality），代价是引入 5.7MB unpacked 的框架只用其算法层。

**重评触发条件**（满足其一即重开调查）：

1. **规模**：节点 >2,000 或边 >20,000（社区变大变密后 Louvain 的 badly-connected 病理与迭代质量问题开始有实质概率；届时复查 graphology 上游 issue #543 是否发布官方 Leiden、`ngraph.leiden`/`leiden-ts` 是否达到 1.0 + 多维护者 + 万级周下载）。
2. **图形态**：语义推断边层（F059 semantic）常态化合并进分析输入，使图从稀疏文档图变成密图。
3. **维护性**：graphology monorepo 连续 24 个月无任何 push/发布，或出现无人修复的 Node LTS 兼容断裂。
4. **需求升级**：需要 CPM/resolution 扫描、层级社区（dendrogram 消费）或加权有向模块度之外的质量函数。
5. **许可证/供应链事件**：任一依赖变更许可证或爆出供应链事件（照常触发本仓库既有依赖审查流程）。

## 8. 参考来源（全部主源）

**npm registry（包页 / `npm view` / 下载 API `api.npmjs.org/downloads/point/last-week/*`）**

- https://www.npmjs.com/package/graphology （0.26.0，2025-01-26，MIT）
- https://www.npmjs.com/package/graphology-communities-louvain （2.0.2，2024-12-17，MIT；README 含选项与 Traag 2019 引用）
- https://www.npmjs.com/package/graphology-metrics （2.4.0，2025-05-21，MIT）
- https://www.npmjs.com/package/graphology-types （0.24.8，MIT）
- https://www.npmjs.com/package/leiden-ts （0.1.0，MIT）
- https://www.npmjs.com/package/ngraph.leiden （0.3.0，MIT 元数据）
- https://www.npmjs.com/package/@aflsolutions/graphology-communities-leiden （1.1.1，MIT）
- https://www.npmjs.com/package/fast-leiden （1.1.0，GPL-3.0-or-later）
- https://www.npmjs.com/package/cytoscape （3.34.2，2026-08-25，MIT，无运行时依赖）
- https://www.npmjs.com/package/@antv/algorithm （0.1.26，MIT）；导出清单：https://unpkg.com/@antv/algorithm@0.1.26/es/index.js
- https://www.npmjs.com/package/ngraph.graph （20.1.2，BSD-3-Clause）；https://www.npmjs.com/package/ngraph.centrality （2.2.0，MIT）；https://www.npmjs.com/package/ngraph.louvain （2.0.0，MIT，2022 后未更新）
- registry 全量检索：https://registry.npmjs.org/-/v1/search?text=leiden&size=25

**GitHub 上游仓库（`gh api` 快照 2026-08-28）**

- https://github.com/graphology/graphology （push 2026-07-21；未发布 WIP：https://github.com/graphology/graphology/tree/master/src/communities-leiden ，`package.json` `private: true`）
- https://github.com/graphology/graphology/issues/543 （"Leiden communities?"，open）
- https://github.com/crodesrepos/leiden-ts （push 2026-07-20；`test/cross-validation.test.ts`、`bench/compare/` 夹具与 graspologic 参照）
- https://github.com/anvaka/ngraph.leiden （push 2026-08-26；`test/leiden-guarantees.test.js` 等 11 个测试）
- https://github.com/aflsolutions/graphology-communities-leiden （创建/push 均 2026-04-26；无测试目录）
- https://github.com/baseballyama/fast-leiden （GPL-3.0；`node-addon-api`/`node-gyp-build`）
- https://github.com/cytoscape/cytoscape.js （push 2026-08-27；算法清单以源码为准：https://github.com/cytoscape/cytoscape.js/tree/master/src/collection/algorithms ）
- https://github.com/antvis/algorithm （@antv/algorithm 上游）
- d3 org 仓库清单（无社区检测模块）：https://github.com/orgs/d3/repositories

**官方文档**

- graphology 标准库文档：https://graphology.github.io/
- cytoscape.js 文档（headless 用法、算法 API）：https://js.cytoscape.org/

**论文原文**

- Traag, V.A., Waltman, L. & van Eck, N.J. "From Louvain to Leiden: guaranteeing well-connected communities." Sci Rep 9, 5233 (2019). https://arxiv.org/abs/1810.08473 ；https://doi.org/10.1038/s41598-019-41695-z

**内部对照**

- `docs/research/graph-rendering-library-choice.md`（渲染层选型；graphology 为预案）
- `docs/research/f059-knowledge-map-review.md`（现图基线：105 节点/92 边/60% 孤立点；byte-identical 纪律）
