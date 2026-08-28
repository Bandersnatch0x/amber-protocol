# REQ-04 — 漂移：死锚发现附着于声明节点，rename/collapse 时携带实际路径；F001/F007 是现存实发现

> "Drift: a dead-anchor finding (declared path absent from the tree) attaches to the node that declared it, carrying the actual path when a rename/collapse is detected. F001 (`scaffolding.js` → `scaffold.js`) and F007 (`loops/` → `loops.js`) are the existing real findings."
> — F059 spec L83-85

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. 对每个声明锚点（feature 的 `paths`），路径在树中不存在时产出一条 `dead-anchor` 发现。
2. 发现以 `nodeId` 绑定到做出声明的节点，而不是汇总进独立报告。
3. 检测到同目录改名或"目录塌缩为文件"时，发现携带 `actualPath`。
4. 对当前真实仓库运行必须恰好产出 F001（`scripts/lib/core/scaffolding.js` → `scaffold.js`）与 F007（`scripts/lib/core/loops/` → `loops.js`）两条发现。

---

## Where enforcement lives

- **发现生成**：`scripts/lib/core/knowledge-graph.js:L622-L657` `buildDrift(targetRoot, features)`——逐 feature 逐 declared path：glob 锚走 `globAnchorIsAlive L558-L620`（完整段级 `*`/`?`/`[...]` 匹配，任一命中即活），普通锚走 `resolvePathWithin` + `existsSync L629-L636`；死锚构造 `{ nodeId: feature.id, kind: "dead-anchor", path: declared }`（`L639`）——**附着在声明节点上**。
- **rename/collapse 检测**：`detectActualPath L484-L527`——声明以 `/` 结尾且父目录存在同 stem 文件 → `reason: "collapsed"`（L506-L511）；否则同目录、同扩展名、stem 互为前缀（双方 ≥4 字符）、最长公共前缀优先、平局取字典序 → `reason: "renamed"`（L513-L526）。命中时 `finding.actualPath` + 区分措辞的 `detail`（L640-L648）。
- **边界收敛**：越出 targetRoot 的锚（`../…`）由 `resolvePathWithin` 抛出 → 按死锚计且不向外探测（L496-L499、L633-L635 注释 "Escaping anchor: dead anchor without probing outside"）。
- **契约**：`schemas/knowledge-graph.schema.json:L103-L126`——drift 项 required `[nodeId, kind, path, detail]`、kind enum 仅 `"dead-anchor"`、`actualPath` 可选、`additionalProperties: false`；稳定排序 `(nodeId, path)`（core L652-L655）。
- **web 面透传**：`apps/web/server/lib/knowledge-graph-reader.ts:L108-L119` `adaptDrift`（未知 kind throw、actualPath 条件透传）；DTO `apps/web/src/lib/knowledge-dto.ts:L26-L32`。

---

## Paths walked

- ✓ 实仓 live 输出恰好 2 条发现（本机运行 `amber knowledge graph --target . --json` 后解析）：
  - `{"nodeId":"feature:F001","kind":"dead-anchor","path":"scripts/lib/core/scaffolding.js","actualPath":"scripts/lib/core/scaffold.js","detail":"Anchored file does not exist — actual file is scripts/lib/core/scaffold.js (rename drift)."}`
  - `{"nodeId":"feature:F007","kind":"dead-anchor","path":"scripts/lib/core/loops/","actualPath":"scripts/lib/core/loops.js","detail":"Anchored directory does not exist — actual is scripts/lib/core/loops.js (directory collapsed to file)."}`
  与 spec 括注的两条实发现逐字对应（rename 与 collapse 各一）。
- ✓ 无假阳性路径：`tests/unit/knowledge-graph.test.js:L194-L206`（每条发现的 path 确实不存在；F058/F016/F017 活锚与 glob 锚零发现）。
- ✓ rename 判据负例：`L309-L325`（`unrelated-thing.js` 不匹配 → 有发现但无 `actualPath`）。
- ✓ 越界锚：`L385-L407`（`../outside.js` → 有发现、无 actualPath、不外探）。
- ✓ glob 死锚：`L411-L430`（`missing*/also-missing.js` → 发现）；glob 活锚 `L432-L445`（`file?.js` 命中 `file1.js` → 无发现）。
- ✓ CLI 缝持久性：`L549-L556`（spawn 真 CLI 后 F001/F007 仍在）。
- ✓ 非 feature 节点不产出发现：`buildDrift` 只遍历 features——锚点（`paths`）本身只存在于 feature 节点（live 输出 `nodesWithPaths` 的 kinds 仅 `["feature"]`），"声明节点"全集即 feature，无遗漏声明方。

---

## Searched

- `dead-anchor`（scripts/ + schemas/ + tests/）→ 生成点 `knowledge-graph.js:L639`、schema enum `L108`、reader 白名单 `knowledge-graph-reader.ts:L109-L114`、测试断言若干——语义单一来源，无并行的第二套 drift 实现。
- `actualPath`（scripts/lib/core/knowledge-graph.js）→ 仅 `detectActualPath` 返回值与 `L641` 赋值一处写入——携带条件即"检测到 rename/collapse"，与 spec 措辞一致。
- `buildDrift`（全仓）→ 定义与 `L826` 单一调用点（两条构建路径共用 `buildKnowledgeGraphFromSources`）——projection/tree 两源的 drift 行为同一。

---

## How the verdict was reached

spec 的四个可检验点全部闭合：附着性由数据形状（`nodeId` 字段 + schema required）直接成立；rename/collapse 的两种 `actualPath` 携带各有 live 实证与 fixture 正负例；两条"现存实发现"与本机 live 输出逐字段吻合（连 detail 措辞的 rename/collapsed 区分都对应）；假阳性、glob、越界三类分支路径都有专门测试且通过（31/31 pass，本机复跑）。无任何一条路径产出脱离节点的发现或遗漏 actualPath 携带，故 implemented。

---

## Open questions

无。
