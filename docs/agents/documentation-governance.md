# 文档治理契约（repository-local）

本文件是 2026-09-27 文档治理地图（`issues/0141`）逐项裁决后的**落文契约**。它回答四个问题：
每类内容的权威位置在哪、谁能改、什么时候必须过门禁、临时产物归哪里。规则文本只在此处维护；
`docs/README.md`、`CONTRIBUTING.md`、`AGENTS.md`、`docs/agents/dev-workflow.md` 只做链接与摘要。

## 1. 权威模型：按内容类型定 canonical home

不设全局优先级，也不设「谁的层级更高」。判断依据是内容类型，冲突时按下表定位唯一权威，然后修改权威文件：

| 内容类型 | canonical home | 更新方式 | 不得替代 |
| --- | --- | --- | --- |
| 产品行为、协议要求、规范契约 | `docs/specs/` | draft/proposed → accepted → 显式 superseded/retired | ADR rationale、计划、feature 状态、票据正文 |
| 已裁决架构选择及理由 | `docs/adr/` | 新 ADR 或显式 amendment，保留原决策 | 行为规范正文 |
| 实施顺序、切片、验证安排 | `docs/plans/` | 实施期间更新，与票据互链 | 规范正文（plan 不重定义 normative spec） |
| 稳定操作知识与 agent 约束 | `docs/wiki/`；agent 工作流规则另在 `docs/agents/` | 随稳定知识变化审查 | 临时状态、当前账本、handoff |
| 仓库级文档治理规则 | 本文件（`docs/agents/documentation-governance.md`） | 裁决变更时更新 | 各入口文档不得另行定义 |
| 研究、问题、map、review 工作 | `issues/`（本地、gitignored） | append-only Log，关闭时记结论 | 规范正文；关闭 ≠ spec accepted ≠ 代码已交付 |
| 审计、迁移、provenance、评审结论 | `docs/agents/` 或 `docs/quality/reviews/`；有长期价值的报告经阶段 7 晋升 `docs/quality/` | 保留来源、范围、结论 | 不因详尽而升格为 spec/ADR |
| 交付状态 | `feature_list.json` | `amber feature`/`accept` 等命令写入 | spec lifecycle、票据状态、路线图 |
| 规范生命周期状态 | 各 spec 头部 `**Status:**` | 该 spec 的 owner 变更 | `feature_list.json`，不与之机械互推 |
| 运行态 | `.amber/`（会话、账本、上下文页） | 命令写入，人工不手改 | 不写入 wiki/规格 |
| 治理事件账本 | `docs/governance/governance-ledger.jsonl`（tracked，交付物） | 只经 `governance-ledger.js` append（chain-hashed、append-only）；`adjudicated` 仅 user | 与 `.amber/` 的会话运行态账本区分：这是持久、可审计、可 CI 门禁的规则裁决记录，非 per-session 运行态 |
| 票据状态 | `issues/` frontmatter + Log | 票内更新 | 不机械提升为 feature/ADR 状态 |

**互不提升原则：** `feature_list.json` 的交付状态与 spec 的规范生命周期是两个独立维度，任何一方
都不能机械推断另一方；handoff 是快照，路线图是方向，三者都不是状态权威。

**规范生命周期状态词表（closed）：** `draft` | `proposed` | `accepted` | `superseded` | `retired`。
每份 `docs/specs/*.md` 必须在头部声明其中之一（token 原样小写，其后可跟一个括号或冒号说明，例如
`accepted (2026-08-30)`；token 本身不接受变体）。链路是 `draft`/`proposed` → `accepted` → 显式
`superseded`/`retired`；写 `superseded` 时必须点名取代它的那份文档，写 `retired` 时必须写明为何不再适用。
与上表的互不提升原则一致：改写 spec 状态要基于该 spec 自身的正文与已交付证据，不以 `feature_list.json`
为依据。门禁见 `tests/unit/documentation-gates.test.js`：每份 spec 都得有该字段，且 token 在词表内。

**范围声明：** `0012`、`0013–0022` 一类公共文档站票据归 public documentation site 范围，
不计入本仓库内部文档治理的验收面。

## 2. 入口职责矩阵

| 入口 | 受众 | 职责 | 不承担 |
| --- | --- | --- | --- |
| `README.md` | 首次到访者、外部读者 | 产品定位、安装、最短可用路径 | 仓库内部规则、状态、票据 |
| `README.zh-CN.md` | 中文读者 | 同上；**独立维护，不设镜像门禁** | 不作为英文 README 的翻译副本 |
| `docs/README.md` | 贡献者、维护者 | 仓库内文档导航；声明自己不等于 public corpus | 不复制任何规则正文 |
| `CONTRIBUTING.md` | 贡献者 | 提交、测试、身份、发布流程 | 不定义文档权威层级 |
| `AGENTS.md` | 所有 coding agent | **仓库级规则单一来源**：边界、门禁、路由 | 不承载命令速查表（属 `docs/CLI_REFERENCE.md`） |
| `CLAUDE.md` | Claude Code | `AGENTS.md` 的镜像/指针 + 平台补充 | 不得与 `AGENTS.md` 冲突；冲突以 `AGENTS.md` 为准 |
| `CONTEXT.md` | 全体 | 术语与领域事实入口 | 状态机/schema/算法/验收门禁（各有 owner，见 0152） |
| `docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md` | agent 操作者 | 边界、门禁、证据、路由的操作手册 | 规范正文 |
| `apps/docs/`（public site） | 外部读者 | 公开发布语料（Layer A，manifest allowlist） | 不作为内部文档的权威 |

`dsh/README.md` 只保留链接摘要，不复制 Amber 规则。

## 3. 物理边界矩阵

| 类别 | 位置 | tracked? | 规则 |
| --- | --- | --- | --- |
| 交付物（规范、ADR、计划、wiki、指南） | `docs/` | 是 | 长期有效；评审报告先进 `.scratch/`，有长期价值再人工晋升 `docs/quality/` |
| 运行态（会话、账本、上下文、memory） | `.amber/` | 否 | 命令写入；不为分类美观重排布局 |
| 票据（研究、map、task） | `issues/` | 否（本地化，已接受） | append-only；跨 clone 不可恢复是已接受代价 |
| 临时与工具产物 | `.scratch/<source>/` | 否 | 一切中间产物；原始输出默认留在此处 |
| 历史归档 | `docs/legacy/` | 是（例外） | 保持现状，不规范化 |
| 机器测试输出 | `coverage/`、`test-results/` | 否 | 可随时删除 |
| 人工测试/试点报告 | `test-reports/`（本地）；有长期价值才晋升 `docs/quality/` | 否 | 手跑报告默认留 gitignored 的 `test-reports/`；**不长期双份**——一旦晋升到 `docs/quality/` 就从 `test-reports/` 移除 |
| 审计/合规工作区 | `spec-compliance*/`（本地） | 否 | gitignored 审计工作区；结论必须晋升进引用它的 ADR/票据正文（该路径不入版本，不得被当作可解析制品引用） |

**`.gitignore` 不是 artifact map：** 是否被忽略只说明提交策略，不说明该产物的权威位置或生命周期。

## 4. 责任

- **改写保真度：** A/B/C 三层（allowlist 已审内容 / 内部 ADR·spec·wiki 作为改写输入 / 禁止发布语料）
  就是内部→公共的改写契约；「改写是否忠实反映内部来源」的责任人是 `docs/` owner（当前为单一维护者）。
  机械门禁只证明发布安全，不证明保真。
- **发布与回滚：** 由同一 owner 承担（当前单一维护者场景下不强制分离），见 `CONTRIBUTING.md`。
- **审计证据：** 证据的存在与晋升是阶段 7 的人工职责，**不新增机械门禁**；但阶段 7 必须显式记录
  证据落点，见 `docs/agents/dev-workflow.md` 的交付证据一节。
- **分支保护（已确认 2026-09-27）：** `master` 已在 GitHub 上受保护：必走 PR + 1 approving review +
  CODEOWNERS 审批（stale approval 自动失效）；必需状态检查（strict）为 `Commit identity`、`Node 20.x`、
  `Node 22.x`、`Coverage`；必需 conversation resolution；禁 force-push 与删分支；`enforce_admins=false`
  （单维护者保留 admin bypass）。自此「CI 绿」是合并阻断门禁的证据。事实回写位为 `CONTRIBUTING.md`
  的 Merge gating 小节；本文仅引用。裁决 17（`issues/0141`、`issues/0154`）据此关闭。

## 5. 机械门禁（与 `issues/0149`、`issues/0150` 一致）

- CI `test` job 的仓库级门禁：`npm run lint`、`npm run format:check`、`npm test`、`npm run manifests`、
  `npm run doctor`、`node scripts/validate-wiki.js --target .`、`npm run gen:agents:check`、
  `npm run docs:gen:check`、CLI help smoke。
- `npm run doctor` 在本仓库按 `product-repo` 分类运行：feature-list、plugin manifests、workflow-pack/
  project-profile smoke，加上 `docs/wiki` 存在时的 wiki 结构检查。
- `amber drift` 在本仓库三维都是 `n/a (product-repo)`，不是门禁。
- 知识语料（`docs/knowledge-corpus/`）的 membership 与 source-hash 由测试门禁守护；CLI 参考的选项
  由「文档 invocation ⊆ registry 契约」门禁守护。

## 6. 变更这些规则

改本文件需要一次显式裁决（owner 决策），并在 `issues/` 留下裁决记录；`docs/README.md`、
`CONTRIBUTING.md`、`AGENTS.md`、`docs/agents/dev-workflow.md` 只允许增加/更新指向本文件的链接，
不得在本文件之外重新定义同一规则。

规则裁决除 `issues/` 留痕外，**同时**向 `docs/governance/governance-ledger.jsonl` 追加一条
governance-event（`candidate_opened` 由 agent 开、`adjudicated` 仅 user；chain-hashed、append-only，
见 `issues/0155`）。历史散文裁决不回填——账本对本机制建立之后的新裁决生效，此前裁决仍以 `issues/` Log 为准。
