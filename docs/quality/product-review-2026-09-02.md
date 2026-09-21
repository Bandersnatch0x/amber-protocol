# Amber Protocol 产品评审与整改方案

日期：2026-09-02
评审人视角：独立软件架构师 + 安全评审 + 代码审查
范围：产品定位、路线、改动清单、仓库架构、dev-workflow 产物约束
证据：SPEC.md / README / CONTEXT.md / feature_list.json（F001–F062）/ external workflow framework 源码对照 / 目录扫描 / Quick Start 实跑

---

## 1. 诊断：产品形态为什么丢了

三份文档描述的是三个不同的产品：

| 文档 | 描述的产品 | 用户 |
|---|---|---|
| SPEC.md（"draft v1"） | installer + auditor + doctor + handoff | 个人开发者 |
| README lifecycle | 十步治理生命周期 | 个人开发者 / 小团队 |
| CONTEXT.md（150+ 术语） | Tenant / Principal / Break-glass / Legal Hold | 企业合规审计 |

F049–F062 这 14 个 feature 是在两周内（8/25–9/02）落地的，全部标注 "Registered retroactively; implementation predates registration"。它们构成了一整层企业级信任基础设施，但没有一条对应的用户旅程说明个人开发者什么时候会碰到 Principal Registry。**产品形态不是被某次改动破坏的，是被一层没有用户入口的基础设施压住了。**

external workflow framework 的对照结论：external workflow framework 的每个 skill 是一个动词（start / check / finish-work / break-loop / update-spec），文件即状态，用户三秒内知道调用后会发生什么。Amber 的 `skills/amber/` 是路由器，进门先要理解"治理旅程"。你要借的是 external workflow framework 的**入口形状**，不是它的文件布局。

---

## 2. 产品定位（重新钉住）

**一句话**：`amber init` 把治理文件放进你的 repo，让 AI coding 会话留下可检查的轨迹，下一个会话（你的或同事的）准确知道从哪接手。

**用户**：
- 主用户：在真实仓库上用 Claude Code / Codex 的个人开发者
- 次用户：正在推 AI 辅助编码的 5 人以下团队
- 非用户：企业合规团队、CI 平台设计者、想要托管仪表盘的人

**分层原则**：面向主用户的表面只允许 7 个动词（见 §5 P0-1）。F049–F062 那层基础设施保留，但降级为"平台层"，从默认 help、README、skills 入口全部隐去，只在 `--all` 和 CLI_REFERENCE 里可见。

---

## 3. 产品路线（三阶段）

### 阶段 A：收口（1–2 周）— 找回形态

目标：一个新用户 `npm i -g amber-protocol` 后 10 分钟内跑完 Quick Start 并说出每一步发生了什么。

- 默认 help 只露 7 个动词
- skills/ 从 5 个路由器改成 7 个动词 skill
- SPEC.md 加"当前状态"头，标注每节对应的版本
- README 加"两种使用者"一句话（安装者 vs 监看者）
- 仓库目录按 §6 收口

出口判据：Quick Start 在干净目录实跑通过（已验证）；`amber --help` 输出不超过一屏；三份 wiki 模板填实（已完成）。

### 阶段 B：稳态（1 个月）— 让默认路径可信

目标：主用户的三条旅程（接入 / 功能生命周期 / 交接）每周 dogfood 一次全部绿。

- 旅程二至四纳入 dogfood 轮换并留证据
- `gate` 的 context-manifest 要求给出可用的默认路径建议（当前只说"replace them"）
- 全部 F-number 补 `paths` 字段（F036–F039 缺失）
- 文档站（issues/0012–0024 那条线）只发布 7 动词 + 3 旅程，不发布平台层

出口判据：每周 dogfood 三旅程连续四周绿；governance report 对本仓库 ≥ 90。

### 阶段 C：平台层选择性开放（按需）

F049–F062 只在有真实团队用户要求时才通过 `amber team` 或 profile 开启对应表面。没有需求就不开。这一阶段不排期。

---

## 4. 产品全貌

已落盘 `docs/wiki/features/feature-map.md`：62 个 feature 聚成 12 个能力域，每域一句话价值、典型命令、成熟度、F-number 映射。前 6 域面向主用户，7–11 面向团队，12 是平台基础层。

---

## 5. 改动计划（P0 / P1 / P2）

### P0 — 不做这些，形态继续丢

**P0-1 默认 help 收口到 7 个动词**
- 动机：现在 33 个命令平铺，新用户第一眼就迷路。
- 涉及：`scripts/lib/command-help.js`（tier 字段）、`tests/unit/command-registry-parity.test.js`
- 七动词：`audit` `init` `doctor` `next` `plan` `handoff` `session`。其余降为 `core` 或 `platform` tier。
- 验收：`amber --help` 输出 ≤ 25 行；`amber --help --all` 保留完整投影；parity 测试绿。

**P0-2 skills/ 从路由器改为动词 skill**
- 动机：`skills/amber/SKILL.md` 是路由器，要求用户先懂"旅程"。external workflow framework 的每个 skill 是一个动词。
- 涉及：`skills/amber*/`、`scripts/gen-agent-commands.js`、`.claude/commands/`、`.gemini/commands/`、`.agents/skills/`
- 改法：保留四个 deep journey skill 作为 `--all` 层；新增 `amber-start` `amber-check` `amber-done` 三个薄壳 skill，各自只调一条命令。删除 `amber/` 路由器或改为一行索引。
- 验收：`npm run gen:agents:check` 绿；每个新 skill 正文 ≤ 40 行；frontmatter 命令与 registry lockstep 测试（F031）绿。

**P0-3 SPEC.md 加状态头**
- 动机：SPEC 说 "draft v1"，BACKLOG 说 V5.5 全落地。读者以为项目刚开始。
- 涉及：`SPEC.md` 顶部
- 改法：加 `Status: V1–V5.5 implemented; §4 command list superseded by docs/CLI_REFERENCE.md; §11 roadmap is historical` 三行。不重写正文。
- 验收：`docs-boundary` 相关测试绿；SPEC 第 3 行能回答"现在到哪了"。

**P0-4 仓库目录收口**
- 动机：见 §6。
- 涉及：`.gitignore`、`output/`、`docs/` 五个 0–2 文件的子目录、根级 `agents.md` 与 `AGENTS.md` 重名
- 验收：见 §6 验收表。

### P1 — 让默认路径可信

**P1-1 gate 的 context-manifest 错误给出可用默认**
- 动机：Quick Start 实跑时 gate 报"replace them with the knowledge-surface paths that role needs"，但没说哪些路径存在。新用户卡死。
- 涉及：`scripts/lib/core/planning.js`
- 改法：错误信息附上目标 repo 里实际存在的 `docs/wiki/**` 路径前三条作为建议。
- 验收：在 init 后的干净目标上跑 gate，错误信息包含至少一条真实存在的路径。

**P1-2 补齐 feature_list 的 paths 字段**
- 动机：F036–F039 无 `paths`，knowledge graph 的 anchors 边缺失，drift 检测失效。
- 涉及：`feature_list.json`
- 验收：`amber knowledge graph --json` drift findings 为 0；`validate-feature-list` 绿。

**P1-3 README 加"两种使用者"**
- 动机：PRODUCT.md 写的是监看者（看 web viewer 的人），SPEC 写的是安装者。README 没说这是两个时刻。
- 涉及：`README.md` "What is Amber" 段后
- 改法：两句话：CLI 服务安装与治理；web viewer 服务监看正在跑的会话。
- 验收：README 词数增加 ≤ 60。

**P1-4 旅程二至四实跑并留证据**
- 动机：目前只有旅程一验证过。
- 涉及：`docs/dogfood-weekly.md` 候选列表、`docs/wiki/product/user-scenarios.md` Unknowns 节
- 验收：三条旅程各有一次 session 证据；Unknowns 节清空。

### P2 — 长期健康

**P2-1 CONTEXT.md 分层**
- 动机：150+ 术语一个平面。主用户需要的不超过 20 个。
- 改法：在文件顶部加 "Core vocabulary (20 terms)" 索引段，其余不动。
- 验收：`node scripts/validate-wiki.js` 绿；索引段 ≤ 25 行。

**P2-2 PRODUCT.md 归位**
- 动机：根目录 PRODUCT.md 实际是 web viewer 的设计准则，不是产品定义。
- 改法：移到 `apps/web/PRODUCT.md`；根目录产品定义以 `docs/wiki/product/overview.md` 为准。
- 验收：根目录不再有两个"产品是什么"的文件。

**P2-3 UBIQUITOUS_LANGUAGE.md 删除**
- 动机：已标 Deprecated，CONTEXT.md 是权威。留着就是第三份词汇表。
- 验收：`grep -r UBIQUITOUS_LANGUAGE docs scripts` 无引用后删除。

---

## 6. 仓库架构与产物约束

### 6.1 现状扫描（2026-09-02）

| 位置 | 跟踪 | 磁盘 | 问题 |
|---|---|---|---|
| `.scratch/` | 0 | 345 | 正确 gitignore，但已成为事实上的第二产物目录 |
| `output/` | 8 | 35 | 半跟踪：6 张 PNG + 2 份 md 入库，其余靶向 ignore |
| `docs/legacy/` `docs/research/` | 0 | 117 | 整目录 gitignore，但仍占着 docs/ 命名空间 |
| `docs/roadmaps` `maintenance` `guides` `adoption-self` | 各 1 | — | 五个单文件目录 |
| `docs/*.md` 根级 | 10 | — | AUTONOMOUS_MODE / MONITORING / NOTIFICATION / POLICY 四份 setup 文档平铺 |
| `docs/devcloud-cc-marketplace-master.zip` | 1 | — | 二进制入库 |
| 根级 `agents.md` + `AGENTS.md` | 1 | 2 | Windows 大小写不敏感下是同一文件的两个名字，Linux CI 下是两个文件 |
 | 各类本地工具状态目录 | 0 | — | 外部工具的本地状态，不属于产品 surface |
| `spec-compliance*/` | 0 | 68 | 未跟踪、未 ignore、根级 |
| `tests/fixtures/worktree-test-repo/` | 0 | — | 未跟踪、未 ignore |

根因：每接入一个外部工具，产物就可能在根级或 docs/ 下开一个目录，然后靠 .gitignore 兜底。.gitignore 已有 100+ 行、12 段注释，本身成了产物目录的地图。

### 6.2 目标布局

原则：**一个产物只有一个家；家由产物的生命周期决定，不由产生它的工具决定。**

```
amber-protocol/
├── 产品源码（不变）
│   scripts/ schemas/ templates/ routes/ skills/ workflow-packs/
│   profiles/ standards/ rule-packs/ team-presets/ action-types/
│   action-functions/ src/ apps/ tests/ registry/ dsh/ mcps/
│
├── 根级文档（收到 9 个）
│   README.md README.zh-CN.md CLAUDE.md AGENTS.md CONTEXT.md
│   CHANGELOG.md CONTRIBUTING.md LICENSE feature_list.json
│   （SPEC.md ROADMAP.md BACKLOG.md DESIGN.md LOOP.md RELEASE_GUIDE.md → docs/）
│
├── docs/
│   ├── wiki/            稳定知识（产品 / 架构 / 工程 / agent），validate-wiki 守
│   ├── adr/             决策记录，只增不改
│   ├── specs/           F-number 规格，与 feature_list 一一对应
│   ├── plans/           F-number 计划，amber plan 产出
│   ├── reference/       CLI_REFERENCE 及生成物
│   ├── guides/          用户向操作指南（吸收根级四份 *_SETUP.md + TROUBLESHOOTING + DEPLOYMENT）
│   ├── quality/         评审、基线、retrospective、break-loops（吸收 docs/reviews）
│   ├── product/         SPEC ROADMAP BACKLOG DESIGN LOOP RELEASE_GUIDE 从根级移入
│   ├── agents/          本仓 agent 工作规则（dev-workflow / issue-tracker / domain / triage）
│   ├── examples/        adoption 示例（不变）
│   └── legacy/          历史（不变）
│
├── .amber/              Amber 自身运行态（gitignore，不变）
├── .scratch/            唯一的本地临时产物目录（gitignore）
│   └── <source>/        外部工具产物按来源分子目录，统一留在临时空间
└── .github/ .githooks/ .claude-plugin/ .codex-plugin/ .claude/ .agents/ .gemini/
```

### 6.3 迁移动作

| # | 动作 | 风险 |
|---|---|---|
| 1 | `git mv agents.md` → 删除（内容并入 AGENTS.md 若有差异） | 低；先 diff |
| 2 | `docs/legacy` `docs/research` → `.scratch/legacy` `.scratch/research`；从 .gitignore 删两行 | 低；均未跟踪 |
| 3 | `output/*.png` → `docs/quality/screenshots/`；`output/*.md` → `docs/quality/`；删 `output/` 及三条 ignore | 低；8 个文件 |
| 4 | 根级 `SPEC ROADMAP BACKLOG DESIGN LOOP RELEASE_GUIDE` → `docs/product/`；更新 CLAUDE.md / README 引用 | 中；grep 引用 |
| 5 | `docs/{AUTONOMOUS_MODE_GUIDE,MONITORING_SETUP,NOTIFICATION_SETUP,POLICY_CONFIGURATION,TROUBLESHOOTING,DEPLOYMENT}.md` → `docs/guides/` | 中；grep 引用 |
| 6 | `docs/reviews/` → `docs/quality/reviews/`；`docs/roadmaps/*` → `docs/product/`；`docs/maintenance/*` `docs/adoption-self/*` → `docs/quality/` | 低 |
| 7 | `docs/devcloud-cc-marketplace-master.zip` → 删除或 `.scratch/` | 低 |
| 8 | `.gitignore` 只保留运行态、依赖和临时空间的必要规则；删除已迁走目录的条目 | 低 |
| 9 | `.gitignore` 重组为四段：依赖与构建 / 运行态 / 本地工具 / 本地工作文件；目标 ≤ 60 行 | 低 |
| 10 | 删 `UBIQUITOUS_LANGUAGE.md`（P2-3） | 低 |

验收：
- 根级 `.md` 文件 ≤ 9 个
- `docs/` 一级子目录 ≤ 11 个，每个 ≥ 3 文件或有明确单一职责
- `.gitignore` ≤ 60 行
- `git status --short` 在干净 checkout 上为空（含运行完整测试后）
- `npm test` `npm run doctor` `npm run manifests` `node scripts/validate-wiki.js` 全绿
- `amber knowledge graph --json` 节点数不减（路径迁移后 anchors 仍解析）

### 6.4 dev-workflow 产物约束（新增到 `docs/agents/dev-workflow.md`）

在现有"粘性规则"后加第四节：

> ## 产物落盘规则（跨阶段生效）
>
> 1. **三类产物三个家**：交付物进 `docs/` 对应子目录；本仓运行态进 `.amber/`；一切中间产物、外部 harness 输出、评审草稿、截图、日志进 `.scratch/<来源>/`。根级不新增任何文件。
> 2. **外部工具只写 `.scratch/`**：外部工具的产物一律落 `.scratch/<source>/`。它们的产物要进交付物，必须经阶段 7 评审后由人手工移入 `docs/`，并在票的 Log 里记录来源。
> 3. **评审报告的归宿**：阶段 7 的评审报告先落 `.scratch/`；票关闭时，结论摘要进票的 Log，报告本体若有长期价值移入 `docs/quality/`，否则留在 `.scratch/` 随时可删。
> 4. **一个 F-number 三个文件**：`docs/specs/F0NN-*.md`、`docs/plans/F0NN-*.md`、`feature_list.json` 条目（含 `paths`）。缺任何一个，`amber review` 应报 warning。
> 5. **.gitignore 不是产物地图**：新增 ignore 条目前先问"这个产物为什么不在 `.scratch/`"。只有运行态和依赖才配单独条目。
> 6. **每周 dogfood 附带目录健康检查**：`git status --short --untracked-files=all | wc -l` 在完整测试后应为 0；根级文件数、docs 子目录数作为 governance report 的 maintenance 维度输入（P2 候选）。

---

## 7. 用户是谁 / 能力域

从提交记录、MEMORY.md、dev-workflow 用中文写、Windows 工具链、CONTEXT.md 的建模深度推断：

资深后端/平台工程师，中文为主要技术语言，Windows 主开发环境，强 schema 设计背景，有治理或审计相关领域经验，把 AI 辅助编码当日常而非实验。自我 dogfood 加严格 ADR 实践，说明在审计性要求高的环境工作过。

能力域：CLI 工具链与分发、JSON Schema 2020-12、TDD Node.js、访问控制领域建模、文档系统、Windows CI、AI 工作流设计。

与本项目相关的盲区：这个背景自然产出的词汇深度，与"刚开始用 Claude Code 的个人开发者"这个目标用户不匹配。这是分发与入口设计问题，不是架构问题。

---

## 8. 本次评审已落盘

- `docs/wiki/product/overview.md` — 用户 / 一句话价值 / 非目标
- `docs/wiki/features/feature-map.md` — 12 能力域 → 62 feature 映射
- `docs/wiki/product/user-scenarios.md` — 四条旅程（旅程一已实跑）
- 本文件

未动代码。P0-1 到 P0-4 是下一步实施的入口。
