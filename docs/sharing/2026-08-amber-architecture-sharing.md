# Amber Protocol：让 AI 辅助工程可审查、受门控、可交接

> 技术分享配套文档 · 2026-08
> 素材来源：项目架构调研报告（Alex）与竞品调研报告（Tina），所有结论均可追溯到仓库内文档与代码。

---

## 目录

1. [开场钩子与问题陈述](#一开场钩子与问题陈述)
2. [Amber 是什么](#二amber-是什么)
3. [整体架构](#三整体架构)
4. [设计思路与哲学](#四设计思路与哲学)
5. [适用场景](#五适用场景)
6. [竞品对比](#六竞品对比)
7. [实操路径](#七实操路径)
8. [诚实边界与注意事项](#八诚实边界与注意事项)
9. [附录](#九附录)

---

## 一、开场钩子与问题陈述

### 1.1 一句核心箴言

> **"Execution is cheap. Trusted execution requires artifacts, gates, evidence, and handoff."**
> （执行是廉价的。可信的执行需要工件、闸门、证据与交接。）

这句话来自 Amber 的 Operating Manual，是整场分享的锚点。

### 1.2 AI 辅助工程的信任难题

当团队让 AI agent 在仓库里工作时，难点不再是写代码本身，而是四个问题：

1. **做了什么** —— agent 改了什么文件、为什么改、依据是什么决策？
2. **是否安全可保留** —— 这些改动通过了哪些检查？有没有绕过闸门？
3. **如何交接** —— 会话结束后，下一个 agent（或人）能否不靠聊天记录续作？
4. **如何证明被审查过** —— 审计时拿得出什么，除了"我记得 agent 跑过测试"？

聊天转录回答不了这些问题：它不在版本控制里、不可校验、不可交接。行业的普遍反应是把 agent 做得更强（更好的运行时、更大的上下文、更聪明的规划），但更强的执行并不能自动产生信任。

### 1.3 Amber 的回答

Amber 不试图让 agent 跑得更快，而是把"做了什么、是否安全、如何交接、如何证明"变成仓库内的显式工件：**计划、闸门、账本、时间线、交接包**——全部版本控制、全部可校验。

---

## 二、Amber 是什么

### 2.1 一句话定位

Amber Protocol 是一个**仓库本地治理层（repository-local governance layer）**：它不运行 agent、不执行项目命令，而是通过单一 CLI（`node scripts/amber.js`）在 git 仓库内生产、校验、审计、交接「治理工件」，让 AI 辅助的工程工作**可审查、受门控、可交接**。

官方术语约定：

- 叫 **Amber Protocol**（旧名 Coding Harness 已弃用；也不叫 framework / platform）；
- 它在目标仓库的可操作面叫 **Governance Console**（CLI + 工件输出，不是托管服务）。

### 2.2 治理层 vs 编排层 vs 执行层

AI 辅助工程的工具栈可以分成三层，Amber 刻意只占据最上面一层：

| 层级 | 回答的问题 | 代表形态 | Amber 的位置 |
|---|---|---|---|
| **治理层** | agent 做了什么、是否安全可保留、如何交接、如何证明被审查过 | 计划/闸门/账本/交接包等治理工件 | **Amber 所在层** |
| **编排层** | 如何拆分任务、派发 subagent、组织并行 | 各类 harness 控制中心、方法论框架 | 不做 |
| **执行层** | 如何写代码、跑命令、调工具 | Claude Code / Codex 等 agent 运行时 | 不做 |

行业主流路线是"更强的 agent 运行时"（把编排与执行做得更聪明）。Amber 反其道而行：**运行时之外，补一层治理**。它不是 Codex / Claude Code 的竞争者，而是补充（complement）——agent 照常执行，Amber 负责让执行变得可审查、可交接。

核心准则（Operating Manual）：

> **"Faster execution never beats clearer governance."**
> （更快的执行永远胜不过更清晰的治理——恰恰相反。）

---

## 三、整体架构

### 3.1 七层控制模型

README、架构 overview 与 Operating Manual 共同定义了**七个控制层（Control Layers）**，按优先级排序、向安全加权：

| 层 | 职责 | 优先级 |
|---|---|---|
| Governance | 审批记录、安全默认、策略边界、adoption 控制 | 最高 |
| Verification | doctor、audit、校验、review、gate 显式检查 | 高 |
| Observability | timeline、manifest、ledger、报告使行为可检视 | 高 |
| Lifecycle | routes、sessions、checkpoints、worktrees 本地组织工作 | 中 |
| Context | starter docs、wiki 脚手架、manifest、交接工件 | 中 |
| Tooling | CLI 命令、schemas、validators、workflow packs、profiles | 中 |
| Execution | **刻意最小化**——避免成为通用执行运行时 | 最低 |

主线是强化 Governance / Verification / Observability，Lifecycle 保持仓库本地，Execution 永不扩张成 agent 平台。

### 3.2 代码与目录组织

#### CLI 入口与命令注册

- **CLI 入口**：`scripts/amber.js`（138 行薄壳），只做命令路由与输出。
- **真正的调度**：`scripts/lib/command-registry.js`（命令定义）+ `scripts/lib/command-dispatcher.js`（handler 绑定）。启动即校验：命令定义与 handler 一一对应，缺失/孤儿即拒绝启动。
- 默认 help 只显示核心治理命令；`amber --all` 显示废弃/专家兼容命令。
- **确定性核心**：`scripts/lib/amber-core.js` 聚合 scaffold / audit / adoption / planning / review / team / maintenance 的确定性逻辑；`scripts/lib/core/` 下约 79 个核心模块（如 `governed-runner.js`、`loop-policy.js`、`error-catalog.js`、`governance-readiness.js`、`agent-orchestration.js`）。

#### schemas/（13 个 JSON Schema，ajv 校验）

`action.type.schema.json`（Action Type 契约，协议层与执行层之间唯一接口）、`route.schema.json`、`loop-contract.schema.json`、`session-manifest.schema.json`、`timeline-event.schema.json`、`context-page/request/loadout/benchmark/source-adapter/verification.schema.json`、`knowledge-plan.schema.json`、`workflow-assessment.schema.json`。

#### action-types/（8 个 Action Type 白名单）

`session-start/status/verify/approve`、`route-test`、`context-ingest`、`governance-report`、`object-query`。每个 Action Type 声明参数、提交条件、副作用（`effects.edits`）、审批方（`governance.approver`）、必留证据（`evidenceRequired`）与 CLI 映射（`execution.command/subcommand`）。

另有 **action-functions/**（2 个 MCP Function 声明）：`repo-overview.json`、`session-evidence.json`，对应进程内只读 `amber.fn.*` 工具。

#### routes/（3 个交付路由模板）

Route 是**声明式交付模板**：定义阶段与闸门，描述结构、不执行内容。

| Route | 阶段设计 | 要点 |
|---|---|---|
| `feature-standard` | capture → plan → implement → verify | 两道 user-approval gate |
| `bugfix-quick` | reproduce → fix → verify | 先复现再修 |
| `refactor-safe` | 特征化行为 → 重构 → 验证 | 无绿色特征网不重构 |

#### workflow-packs / rule-packs / templates / profiles

- **workflow-packs/**（4 个声明式工作流包）：`safe-amber-bootstrap`（含 `daily-amber-triage` loop contract）、`secure-code-review`、`security-audit`、`vuln-repair-verification`。
- **rule-packs/**：`amber-delivery.rule-pack.json`，可安装的标准 + 团队策略规则束。
- **templates/**：`init` 复制到目标仓库的安全默认件——`AGENTS.md`、`CLAUDE.md`、`feature_list.json`、`PROGRESS.md`、`session-handoff.md`、`clean-state-checklist.md`、`evaluator-rubric.md`、`MEMORY.md`、`docs/wiki/` 骨架、`.workflow/continuous-improvement/state.json`、内置 routes/standards。
- **profiles/**：`default.profile.json`，目标仓库工作流意图的声明式配置，`profile inspect` 校验但不执行。

#### skills/（多平台生成）

5 个 skill，`SKILL.md` 是唯一事实源，`npm run gen:agents` 生成各平台产物（`.claude/commands/`、`.agents/skills/`、`.gemini/commands/amber/`），CI 用 `gen:agents:check` 防漂移。详见 [7.2 四条 journey](#72-四条-journey-skills与路由器)。

#### apps/web（数据优先的 Web Viewer）

React 18 + tRPC + TanStack Router/Query + Vite + Tailwind，zod 校验，vitest + Playwright E2E。定位：实时监控自治编码会话的状态/时间线/路由/审批门。约束：**只读 `.amber/` 目录**（ADR-0006）、ESM、不保留 legacy `.harness` 回退。启动：`cd apps/web && npm install --legacy-peer-deps && npm run dev`（localhost:3001）。

#### MCP server（P1/P2）

设计文档：`docs/wiki/amber-ontology-mcp.md`（v0.7，状态 implemented，中文撰写，分享可直接引用）。

- **P1（stdio MCP server）**：`scripts/amber-mcp.js`（357 行 stdio 适配器，v0.7.0），`node scripts/amber-mcp.js --target <repo>`，JSON-RPC 2.0 换行分隔；`tools/list` 返回 Action Type + Function 工具，`tools/call` 提交调用。白名单文件（`action-types/*.json`）启动时全部经 schema 校验，**任一坏条目整体 fail-closed 拒绝启动**。
- **P2（OAG 查询层）**：`amber.object.query` 工具按 `objectType` 变体分发到只读命令：session → `session status --json`、route → `route list --json`、context → `context load`（Loadout 组装）、ledger → `ledger export`、loop → `loop recommend`。闭合回路成形：**query → decide → act → verify → learn**。
- **F018 governance seam（治理接缝）**六条强制不变量：
  1. **白名单制**：未知工具一律 JSON-RPC `-32602`；
  2. **只读不变量**：仅当完整参数化行为被命令能力注册表（`COMMAND_CAPABILITIES`）证明只读时才免审批直接执行，禁止写能力参数藏在只读声明后；
  3. **受治理执行不变量**：适配器从不直接 spawn 变更类 Action，变更返回 `approvalRequired`；
  4. **fail-closed**：损坏治理状态 / 非零退出 / 超时 / 契约失败一律 `isError: true`，不退化为空/成功；
  5. **已配置仓库不变量**：`_target` 必须精确匹配启动时配置的仓库真实路径（realpath），Function 路径读取经 symlink/junction 感知的 containment 检查；
  6. **产品边界声明**：外部系统不得绕过 Amber 操作仓库。
- 其他已落地能力：并发守卫（每仓库单活跃会话）、跨仓库视图（`--targets a,b,c` + `amber.fn.repoOverview`）、所有权写回（`--agent`/`_agent`）、函数 schema 校验、TTL 结果缓存。
- **ADR-0016（deep governance decision seams）**：四个深模块收拢决策知识——`route-journey-decision`、`command-registry`、`context/action-registry`、`mcp-invocation-coordinator`。

#### .amber/（目标仓库状态目录）

`sessions/<id>/`（manifest.json + timeline.jsonl + ledger.jsonl + gates/）、`governance/`（POLICY.md、BOUNDARIES.md、rules.json、evidence/）、`loops/<contractId>/ledger.jsonl`、`routes/<routeId>/ledger.jsonl`、`context/`（requests/pages/loadouts）、`worktrees/`、`maintenance/` 等。

### 3.3 受治理执行的唯一通道：GLX 四道门

ADR-0003 允许 `amber loop run --execute`（及 route command-stage）执行契约声明的 `governed.command`，但必须全过四道门：

| 门 | 机制 | 关键点 |
|---|---|---|
| **1. Policy gate** | `.amber/governance/rules.json` | deny-wins、`defaultAction: deny`，含不可移除的内置破坏性命令 deny |
| **2. Approval gate** | `amber loop approve` | 一次审批只授权一次运行（approvalKey 防重放） |
| **3. Isolation gate** | 独立 git worktree（`.amber/worktrees/`） | 主检出永不是 cwd |
| **4. Evidence gate** | SHA-256 哈希链账本（`ledger.jsonl`） | `amber loop verify-ledger` 检测篡改 |

复用原语：`scripts/lib/core/governed-runner.js` 的 `runGovernedCommand`。

**这是全场最值得记住的一张图**：执行权没有被取消，但被收拢进唯一通道，每一道门都有明确的技术强制力，而不是文档里的口头约定。

---

## 四、设计思路与哲学

### 4.1 operational-ontology：agent 通过治理面行动，而非绕过它

Amber 已拥有「名词」（session、route、wiki、evidence）与「门」（approval、verify、ledger），MCP 层补上类型化的「**动词**」（Action Types）：外部 agent 不再绕过 Amber 直接改仓库，而是通过受治理操作完成任务。

概念映射：

| 本体概念 | Amber 对应 |
|---|---|
| Object Type | session / route / wiki / evidence |
| Action Type | `amber session start` 等类型化受治理事务 |
| Governance Gate | governed-runner 前置门控 |
| Evidence Recorder | timeline + ledger |
| Language | schemas |

### 4.2 安全边界：写进产品，不是 TODO

- **read-only-first / dry-run 优先**：audit 默认只读；`init`/`wiki` 幂等且永不覆盖已有文件。
- **never-overwrite-user-files**：所有修改提案先以文件列表 / patch 预览可见。
- **executesAnything: false**：所有 loop contract 强制携带；`loop run` 不带 `--execute` 就是 dry-run。
- **fail-closed 显式化（ADR-0011）**：worktree 创建失败 → 拒绝而非降级到主分支；策略文件缺失 → 拒绝；哈希链验证失败 → 拒绝并标记篡改。"a check that cannot run = a failed check"，无宽松模式降级路径。
- **置信度分级执行形态（ADR-0011）**：
  - 高置信（已验证 route + 已过 plan gate）→ 受治理执行；
  - 中置信（有 plan 未过 gate）→ 仅 dry-run；
  - 低置信 → 拒绝执行转人工。
  - 不变量：**"不确定性只能向下流动，永不向上"**。
- **autonomous 模式被硬删**：`session start --mode autonomous` 直接拒绝（exit 1，引 ADR-0001/0005）；实验执行器被**删除而非归档**，恢复只能走 `git show v1.2.0:<path>`。
- **worker 不能自我批准**：worker、reviewer、approval、acceptance 是分离记录。

### 4.3 Gates / Evidence / Routing 三机制

#### Gates（闸门）

Route Gate（路由阶段间 user-approval）、Plan Gate（`amber gate --plan`）、Adoption Gate（只读就绪评估）。闸门默认是 advisory（markdown 字段），可选 `amber hooks install` 安装 pre-commit 机械强制（只读治理元数据，不跑构建/测试）；每个阻断错误带稳定错误码（如 `AMBER_E_FEATURE_NO_EVIDENCE`），`amber explain <code>` 解释。

#### Evidence（证据）

`feature_list.json` 不变量：至多一个 `in_progress`，`passing` 必须有非空 evidence；任何完成声明必须给出命令、结果/退出码、工件路径、剩余风险——**"没有证据就只是声明"**。`session verify` 不带 `--execute` 只记录 `executed: false` 的 claim，`complete-check --strict` 要求已执行证据。ADR-0004 定义证据分级。

#### Routing（确定性路由）

`amber next --objective` 是**只读路由顾问**——对 route manifest 的 `objective`/`description` 元数据做**确定性关键词打分**，**永不使用语义检索 / embedding / LLM**（ADR-0014）；无匹配时建议走 plan gate 而非猜执行路径。旅程选择由 `scripts/lib/journey-router.js` 确定性给出 `journeyId`，"不要发明第五条 journey"。

### 4.4 文件即状态（artifact-first，ADR-0001）

选择「信任与可检视性」而非「自动化速度」。计划、闸门、账本、交接产物全部是仓库内版本控制的文件：

| 状态 | 载体 |
|---|---|
| 计划 | `docs/plans/` |
| 会话 | `.amber/sessions/` |
| 账本 | `ledger.jsonl`（哈希链） |
| 时间线 | `timeline.jsonl`（状态机事件源） |
| 交接 | `session-handoff.md` + handoff bundle |

聊天历史不是持久交接物。

### 4.5 持续改进设计

- **learnings 写回**：`accept` 后 `amber learnings --target . --feature <id>` 只读检查是否命中强制知识写回触发器（schema/contract/infra 路径），`--reviewed --owner <id>` 登记审阅。**Amber 只检测与提醒，从不自己写知识文档，也从不推断 owner**。
- **break-loop 复盘**：对复发 ≥2 次的缺陷类，`amber break-loop --issue <n> --title <t> --recurrence <n>` 脚手架事后复盘；`validate --file` 拒绝占位符内容。
- **loop recommend**：只读扫描 loop contracts 按维护目标打分，输出最安全的下一步 dry-run 命令；不调度、不执行、不派发。
- **上下文蒸馏闭环（ADR-0009）**：见 4.6。

### 4.6 上下文蒸馏子系统："Amber 拥有契约与闸门，宿主 agent 拥有生成"

这是 Amber 零 LLM 依赖姿态的集中体现：

- **分工**：Amber 出契约与闸门，宿主 agent 出算力。`amber context request --page <id>` 写蒸馏契约（`.amber/context/requests/<id>.json`：带哈希的源引用、目标 schema、指令、硬约束、机器可检的验收错误码）；agent 执行；`amber context ingest` 校验入库（`.amber/context/pages/`，块级结构化 JSON，每个 block 必须引用 sources，`unknown` 是一等 block 类型）；`docs/wiki/context-index.md` 是唯一生成索引页。
- **双哈希过期检测**：mutable 源带 rawHash/normHash，只有 normHash 变化触发 refresh（格式化不花成本）；`no-change` 是合法结果；immutable 源内嵌 excerpt 快照，clone/clean 后仍自洽。
- **Loadout（ADR-0010）**：`context load --route <r> --feature <f>` 组装任务级上下文——Required Artifacts（操作手册 + Route manifest + Loadout 定义，缺失即 fail closed）+ pinned/fresh 页面，词数预算默认约 4000（`--budget`），按 required → priority → recency → pageId 稳定顺序填充。配套 `verify --loadout`、`benchmark`、`retention`（只报告不删除）、`stats`（过滤率/通过率/unknown 占比）。
- **姿态**：Amber 永不调用 LLM，保持零 LLM、仅 ajv 依赖、离线可用、确定性（ADR-0009 明确拒绝引入 LLM 依赖）。

---

## 五、适用场景

### 5.1 解决什么问题

当团队让 AI agent 在仓库里工作时，Amber 让四件事显式化：

- **reviewable by default**：计划/闸门/账本/交接在仓库里，而不是聊天转录里；
- **dry-run first**：一切先看提案，再谈应用；
- **人工闸门显式化**：哪些决策必须人拍板，写进流程而非靠自觉；
- **agent 上下文随代码库走**：克隆仓库即获得续作所需的全部治理状态。

### 5.2 适合谁

- 使用 Codex / Claude Code 等编码 agent 的**个人开发者**；
- 采用 AI 重编码工作流的**小团队**；
- 需要可重复的 agent onboarding、验证与交接的**工程团队**（含审计/合规诉求）。

### 5.3 典型场景

| 场景 | Amber 支撑 |
|---|---|
| 多 agent 协作治理 | worker/reviewer 分离、并发单活跃会话、所有权写回 |
| 长周期任务交接 | handoff bundle 让新 agent 无需聊天记录即可续作 |
| 治理审计与合规 | governance report 就绪度评分 + OWASP ASI 诚实覆盖报告（`amber governance standards`） |
| 上下文蒸馏 | 会话证据 → 带出处的知识页 → 任务级 Loadout |
| 安全治理 | security audit、rules.json 策略 |

### 5.4 明确不做（边界即产品）

- 不做动态工作流执行；
- 不做 live 子 agent 派发；
- 不做自动/无人值守执行（唯一例外是 ADR-0003 四门门控执行）；
- 不做调度 / cron / hook 触发；
- 不做外部写入（PR / issue tracker / 通知）；
- 不拦截 agent 工具调用；
- 不自动改写既有项目文档。

它**不是**通用 agent 操作系统、不是 CI 替代品、不是项目管理 SaaS。定位是补充（complement）Codex / Claude Code 运行时，而非竞争。

---

## 六、竞品对比

> 事实来源：竞品调研报告（Tina）。star 数等标注"待确认"的数据保持待确认表述。

### 6.1 深度竞品一：Superpowers（obra/superpowers）

**定位**：面向 coding agent 的"完整软件开发方法论"（agentic skills framework & software development methodology），由 Jesse Vincent 及 Prime Radiant 团队构建，MIT 许可。是目前安装量/star 数最高的 skills 框架之一（star 数各来源差异大：2026-02 约 40k，3 月约 118k，近期来源称约 180k–192k，**当前精确值待确认**）。

**核心机制**：

- **Skills 库自动触发**：skills 在会话中自动激活（"Mandatory workflows, not suggestions"），无需用户手动调用；
- **7 步基础工作流**：brainstorming（苏格拉底式设计澄清）→ using-git-worktrees（隔离工作区）→ writing-plans（拆成 2–5 分钟小任务，含精确文件路径与验证步骤）→ subagent-driven-development / executing-plans（每个任务派发新 subagent，两阶段审查：先 spec 符合度、再代码质量）→ test-driven-development（强制 RED-GREEN-REFACTOR）→ requesting-code-review（严重问题阻断进度）→ finishing-a-development-branch（合并/PR/保留/丢弃决策）；
- **哲学**：TDD 优先、系统化优于即兴、简化复杂度、证据优于声称（evidence over claims）；
- **Subagents 与并行**：dispatching-parallel-agents 支持并发 subagent 工作流；
- **Hook 机制**：依赖各 harness 的 session-start hook 注入 bootstrap。

**分发**：插件市场分发，已覆盖 14+ 平台（Claude Code、Codex、Cursor、Gemini CLI、Devin CLI、Grok、Kimi Code 等）。多 harness 需分别安装。

**优势**：生态规模最大、开箱即用、方法论成熟（TDD/计划/审查闭环）、跨平台广、社区活跃、支持数小时无人值守自主开发。

**劣势**：

- 是"过程方法论"而非"治理层"——无审计账本、无 tamper-evident 证据链、无 fail-closed 门控语义；
- 状态主要活在会话/上下文里，缺乏可交接的仓库内状态制品（无 handoff bundle 概念）；
- 贡献受限（官方不接受新 skill 的 PR，且 skill 变更必须跨所有支持平台兼容）；
- 含可选遥测（logo 加载上报版本，可关闭）。

**来源**：

- https://github.com/obra/superpowers
- https://simonwillison.net/2025/Oct/10/superpowers/
- https://www.buildthisnow.com/blog/guide/mechanics/best-claude-code-setups-2026（star 数，待确认）
- https://aiforautomation.io/news/2026-03-27-superpowers-claude-code-skill-118k-stars-tdd

### 6.2 深度竞品二：Trellis（mindfold-ai/Trellis）

**项目识别说明**：搜索 "Trellis" 存在多个同名项目（roots/trellis = WordPress 部署工具、微软 TRELLIS = 3D 生成模型），均与 coding-agent 无关。当前 harness 语境下最活跃的 "Trellis" coding-agent 项目是 **mindfold-ai/Trellis**（自称 "The best agent harness"），被 ai-boost/awesome-harness-engineering 等 harness 资源列表收录，约 4.4k stars（SkillsLLM 快照，**当前精确值待确认**），AGPL-3.0 许可。

**定位**：开箱即用的 AI 编码工程框架。核心主张：把 specs、tasks、memory 持久化到仓库内（文件即状态），让任何 coding agent 按团队工程标准工作，解决"每个会话从零开始"的问题。

**核心机制**：

- **仓库内状态**：`.trellis/spec/`（按包/分层作用域的编码规范）、`.trellis/tasks/`（PRD、实现上下文、审查上下文、任务状态）、`.trellis/workspace/`（journal，项目记忆）；
- **4 阶段自动循环**：Plan（trellis-brainstorm 逐问澄清写 PRD，研究项交给 trellis-research sub-agent）→ Implement（trellis-implement sub-agent 按 PRD 写码，自动注入上下文，不 git commit）→ Verify（trellis-check sub-agent 对照 spec 审查 diff 并跑 lint/type-check/tests）→ Finish（trellis-update-spec 把新知识回写 `.trellis/spec/`，形成学习闭环）；
- **多平台**：声称支持 22 个 AI 编码平台（自述，未独立验证），`trellis init` 按平台生成适配文件；
- **分发**：`npm install -g @mindfoldhq/trellis`，要求 Node.js ≥18 + Python ≥3.9。

**优势**：文件即状态、spec 自动注入替代巨型 CLAUDE.md、有学习回写机制、多平台、个人 journal 与共享 spec 分离减少团队冲突。

**劣势**：无审计账本/防篡改证据、无显式 fail-closed 门控、无 handoff bundle（靠 journal 近似）、生态规模远小于 Superpowers/Spec Kit、AGPL-3.0 对企业采用有顾虑（待确认实际影响）。

**来源**：

- https://github.com/mindfold-ai/trellis
- https://github.com/mindfold-ai/Trellis/blob/main/AGENTS.md
- https://skillsllm.com/skill/trellis（star 数快照）
- https://github.com/ai-boost/awesome-harness-engineering

### 6.3 同类扩展参照（简要）

**GitHub Spec Kit（github/spec-kit，MIT）**

- 定位：Spec-Driven Development 开源工具包，"specification 即一等公民，可执行"；
- 机制：`specify init` + `/speckit.constitution`（项目宪法/原则）→ `/speckit.specify`（需求）→ `/speckit.clarify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.analyze`（制品间一致性分析）→ `/speckit.implement`。支持 30+ agent，extensions/presets/bundles 三层定制；
- 可比性：与 Amber 同为仓库内制品驱动（.specify/、specs/），constitution 概念近似 Amber 的 governance rules；但它面向"从 spec 生成代码"的正向流程，不做审计/门控/交接。**可比性高，推荐作为分享中的直接对照**；
- 来源：https://github.com/github/spec-kit 、https://github.github.com/spec-kit/

**AWS Kiro（kiro.dev）**

- 定位：AWS 出品的 spec-driven agentic IDE（闭源商业产品）；
- 机制：spec 模式（prompt → requirements → design → tasks 三件套）、steering files（团队规范注入）、agent hooks（事件触发自动动作）；
- 可比性：同为 spec/规范驱动，但绑定 IDE 与云服务，状态不在用户仓库内自由流转；与 Amber 的"仓库本地、平台无关、read-only-first"形成反面参照；
- 来源：https://kiro.dev/ 、https://kiro.dev/docs/hooks/

**BMAD-METHOD（bmad-code-org/BMAD-METHOD，MIT）**

- 定位：Breakthrough Method for Agile AI-Driven Development——敏捷方法论框架，用专业化 agent 角色（product/architecture/UX/dev/testing）把想法变成可运行软件；
- 机制：`npx bmad-method install`，核心是"决策显式化、上下文向前携带、流程按工作量自适应伸缩"；生态含 BMad Builder、Test Architect、BMad Loop（无人值守跑完 epic 并回顾）等模块；
- 可比性：与 Amber 都强调"决策显式、上下文连续性"，但 BMAD 是方法论+角色编排，无治理门控/账本/确定性路由；
- 来源：https://github.com/bmad-code-org/bmad-method

**Claude Code / OpenAI Codex 原生能力**

- 定位：agent harness 厂商内建能力——Claude Code 提供 plan mode、subagents、agent teams、hooks、skills、plugins；Codex CLI 提供 AGENTS.md、OS 级沙箱、MCP、plugins；
- 可比性：它们是 Amber 所依附的底座。Amber 通过 skills/ 适配这些平台并在其上叠加治理层；原生能力提供执行与隔离，但不提供跨会话交接包、治理评分、哈希链账本等仓库级治理制品；
- 来源：https://code.claude.com/docs/en/agent-teams 、https://code.claude.com/docs/en/hooks-guide 、https://github.com/openai/codex

### 6.4 对比维度矩阵

| 维度 | Amber Protocol | Superpowers | Trellis (mindfold) | GitHub Spec Kit | AWS Kiro | BMAD-METHOD | CC/Codex 原生 |
|---|---|---|---|---|---|---|---|
| **定位层级** | 仓库本地治理层（审查/门控/交接/账本） | 工作流/方法论（skills 库） | 工程框架（spec+memory 持久化） | Spec 驱动工具包 | Spec 驱动 IDE（商业） | 敏捷方法论+角色编排 | 执行层 harness 底座 |
| **状态管理** | 仓库内文件（.amber/ 制品、哈希链账本、handoff bundle） | 主要会话内，计划文档为辅 | 仓库内文件（.trellis/ spec/task/journal） | 仓库内文件（specs/、.specify/） | IDE 内+云服务（部分仓库文件） | 仓库内制品（briefs/specs/architecture） | 会话/上下文为主，少量文件 |
| **安全/闸门模型** | 四重门控 + fail-closed + dry-run 优先 + 审批门 | TDD 强制 + 两阶段审查 + 严重问题阻断 | 自动校验（lint/type-check/test 对照 spec） | constitution 原则 + analyze 一致性检查 | steering + hooks 自动化 | 决策显式化，无强制门控 | OS 沙箱 + 权限模式 |
| **交接/上下文连续性** | handoff bundle/validate + context loadout 蒸馏（ADR-0009） | 弱（靠 plan 文档） | 中（journal + spec 回写） | 中（spec 制品留存） | 弱（IDE 会话） | 中（"context carries forward"理念） | 弱（session resume 有限） |
| **多 agent 平台支持** | skills/ 适配 5+ 平台（Claude/Codex/Cursor/Gemini/Grok）+ MCP | 14+ 平台插件市场 | 22 平台（自称） | 30+ agent 集成 | 仅 Kiro IDE | 多工具（含 Web bundle） | 仅自家平台 |
| **是否执行代码** | 否（executesAnything: false，变异操作需审批） | 是（驱动 agent 实际写码、跑测试） | 是（implement/check sub-agent） | 是（implement 驱动 agent） | 是 | 是 | 是 |
| **学习成本** | 高（35+ 命令、gates/evidence 概念体系） | 低（装插件即用） | 低-中（init + 4 阶段工作流） | 中（specify CLI + 命令序列） | 低（IDE 引导） | 中-高（方法论+角色概念） | 低 |

### 6.5 差异化结论

#### Amber 的独特卖点（7 条，相对竞品成立）

1. **治理面（governance seam，F018）**：只有 registry 来源的只读变体可免审批执行，一切变异操作返回 approval-required 且永不由适配器代为执行——竞品均无此"执行权边界"设计。
2. **Deterministic routing**：`next` 命令的路由建议是确定性推断而非 LLM 判断，与 Superpowers 的"skills 自动触发"（模型自主决策）形成鲜明对比。
3. **Fail-closed 语义**：治理状态损坏或命令非零退出即 isError 失败关闭，无降级路径；竞品（除原生沙箱外）无此显式承诺。
4. **Handoff bundle + validate**：可移植交接包是独有制品，Superpowers/Trellis/Spec Kit 均无对应物（Trellis journal 只是弱近似）。
5. **上下文蒸馏（ADR-0009）**：契约驱动的上下文 loadout 管理，与 Trellis 的"自动注入 spec"方向相反——Amber 强调按需蒸馏与可验证，而非全量注入。
6. **防篡改证据**：哈希链账本（tamper-evident ledger）在竞品中无对标。
7. **极简依赖与跨平台**：JavaScript CLI、仅 2 个运行时依赖、Windows/macOS/Linux 通吃。

#### 如实评估的短板（5 条）

1. **生态规模差距巨大**：Superpowers star 数约在十万量级且进入 Anthropic/xAI 官方 marketplace，Trellis/Spec Kit 均有数千至上万 stars 与活跃社区；Amber 的社区与第三方扩展生态目前**待确认**（仓库内未见公开社区入口数据），分享中应避免与竞品比拼规模。
2. **上手门槛高**：35+ 命令 + gates/evidence/loadout 概念体系，学习成本显著高于"装插件即用"的 Superpowers 或"init 即走"的 Trellis。
3. **不执行 = 依赖宿主**：Amber 的价值需宿主 agent 配合才能兑现，若宿主忽略治理制品，治理层形同虚设；而 Superpowers/Trellis 直接驱动执行，体验闭环更快。
4. **竞品正在逼近部分特性**：Trellis 的"仓库内文件即状态"、Spec Kit 的 constitution/analyze、BMAD 的"决策显式+上下文携带"都在侵蚀 Amber 的部分叙事空间；Amber 需把差异化锚定在审计/门控/交接/fail-closed 这些竞品明确未覆盖的点上。
5. **商业背书对比**：Kiro（AWS）、Spec Kit（GitHub）、Superpowers（Prime Radiant 商业化）均有机构背书，Amber 为企业采用时需更强的信任材料。

#### 一句话总结

**Amber 与竞品不在同一层竞争**——Superpowers/Trellis/BMAD 是"让 agent 干得更好"的过程层，Spec Kit/Kiro 是"先写 spec 再生成"的制品层，而 Amber 是"证明 agent 干的事可审查、可交接、失败即关闭"的治理层。

---

## 七、实操路径

### 7.1 核心命令生命周期

```
audit → init → governance report → next → plan → gate → verify → approve → handoff bundle → handoff validate
```

| 阶段 | 命令 | 产出 |
|---|---|---|
| 体检 | `amber audit --target <repo> --summary` | 只读就绪发现 |
| 安装 | `amber init` | 起步治理文件（不覆盖） |
| 验证 | `amber doctor` | agent 面文件完备性检查 |
| 维基 | `amber wiki` | `docs/wiki/` 骨架创建/校验 |
| 评分 | `amber governance report` | 就绪度分数、风险、结构化下一步（含精确命令） |
| 效能 | `amber workflow assess` | 五维工作流效能评估（与就绪度分离，ADR-0008） |
| 计划 | `amber plan --feature F001 --title "..."` | 特性计划与评审面 |
| 闸门 | `amber gate --plan <path>` / `--confirm` | Plan Gate 校验 |
| 引导 | `amber next [--objective/--feature/--session/--json]` | 单一最相关下一步命令（永不执行） |
| 会话 | `amber session start/status/verify/approve/complete-check` | 受治理会话生命周期 |
| 上下文 | `amber context request/ingest/verify/refresh/load/stats` | 契约驱动蒸馏 + Loadout（ADR-0009/0010） |
| 交接 | `amber handoff bundle` + `handoff validate` | 便携续作包 + 完备性校验 |
| 回路 | `amber loop recommend` / `loop run --dry-run` | 安全持续改进选择 |
| 学习 | `amber learnings` / `amber break-loop` | 知识写回检查 / 复发缺陷复盘 |

会话状态机（SSOT：`scripts/lib/session-state-machine.js`）：

```
created → routed → executing ⇄ paused → completed / failed / aborted
```

注意：`created → executing` 非法（必须先 routed）。

### 7.2 四条 journey skills（与路由器）

`skills/` 为唯一事实源，`npm run gen:agents` 生成 `.claude/commands/`、`.agents/skills/`（Codex/Cursor 共读）、`.gemini/commands/amber/`；CI 用 `gen:agents:check` 防漂移。每个 SKILL.md frontmatter 含 `x-amber-json` 声明入口命令。

**1. amber（路由器）**

用 `next --objective` 确定性路由到正确 journey；意图跨 journey 时先 diagnosis 后 delivery；路由选择绝不授权变更命令。

**2. amber-delivery（受治理交付）**

从目标到计划、会话证据、审批、交接、验收的完整生命周期，8 步：

1. 读 AGENTS.md / 手册 / 状态；
2. `next --objective` 取建议；
3. 计划 + gate；
4. 启动受治理会话；
5. 只实现已确认切片；
6. `session verify --execute --confirm` 记真实证据；
7. complete-check + approve；
8. review + handoff + accept。

失败停在失败阶段，保持会话可恢复。典型命令序列：

```
plan → gate → session start → (实现) → verify --execute → complete-check → approve → handoff → accept
```

**3. amber-diagnosis-adoption（诊断与采纳）**

修复/安装治理而不静默改动用户文件：先 `audit`（区分事实/未知/冲突/建议）→ `governance report` + `doctor` → `init --dry-run` 预览，经批准才应用 → wiki 创建/校验 → 复跑验证；修复变成代码变更时移交给 amber-delivery。旧 `adoption` 命令仍可通过 `amber --all` 使用（兼容）。

**4. amber-context-continuity（上下文与连续性）**

蒸馏带出处的知识、验证 Loadout、保持可恢复交接：

```
context request → 宿主 agent 仅按契约声明的源生成、逐块引用、未知标记 unknown
→ 人工审阅后 ingest --confirm（无确认则 typed CLI seam 返回 approvalRequired，绝不写入）
→ refresh 处理过期源 → context load --route 组装 Loadout 并立即 verify → 收尾更新交接
```

**5. amber-continuous-improvement（持续改进）**

日常 triage 的受治理形态：`loop recommend` 取只读建议 → 选一个高价值低风险切片 → 写切片契约（目标/范围内外文件/预期/证据/闸门）→ 走受治理交付 → 独立 review pass → 更新状态。含 Loop Triage 兼容输出模板（High-Priority/Watch/Noise/State Updates，对齐 loop-engineering 惯例）。

### 7.3 从零落地 Amber：12 步 demo 清单

综合 README Quick Start、`docs/user-guide/getting-started.md` 与 amber-diagnosis-adoption SKILL 整理：

| 步 | 命令 | 演示要点 |
|---|---|---|
| 1 | `npm install -g amber-protocol` → `amber --version` | 全局安装（或源码 `npm install`） |
| 2 | `amber audit --target my-project --summary` | 只读体检，展示「不改一文件」 |
| 3 | `amber init --target my-project` | 安装起步文件（跳过已存在） |
| 4 | `amber wiki --target my-project` | 生成/校验 wiki 骨架 |
| 5 | `amber doctor --target my-project` | 校验 agent 面完备性 |
| 6 | `amber governance report --target my-project` | 就绪度评分 + 结构化下一步 |
| 7 | `amber next --target my-project` | 确定性引导（可加 `--objective "fix login timeout"` 演示路由建议） |
| 8 | `amber plan --target . --feature F001 --title "Small slice"` → `amber gate --plan docs/plans/F001-small-slice.md` | 演示 Plan Gate |
| 9 | `amber session start` → `session verify` → `complete-check` → `approve` | 会话与证据（可选 `hooks install` 演示 commit 时机械强制） |
| 10 | `amber context request --page <id>` → agent 执行契约 → `ingest --confirm` → `verify` | 知识闭环（可选） |
| 11 | `amber handoff bundle --target .` → `amber handoff validate` | 可交接性收尾 |
| 12 | （可选）`cd apps/web && npm install --legacy-peer-deps && npm run dev` | 会话监控 viewer |

### 7.4 现成示例与对比素材

- `docs/examples/README.md`：真实项目 adoption 工件全集——walkthrough、report、gate、status、bundle、next-actions、decision-record、apply-plan（dry-run）、selected-files 等，附每条生成命令；
- `docs/research-harness-pattern-comparison.md`：中文对比研究——Amber（治理层）vs 某 macOS Rust 编码代理控制中心（编排/执行层）；9 个重合点（worktree 隔离、人工审批门、本地优先、显式状态机、无进展检测等）与 11 个可吸收点（其中 P1 三项已落地为 ADR-0011 置信度分级、fail-closed 显式化；ADR-0012 版本化）。

---

## 八、诚实边界与注意事项

分享时主动声明这些边界，反而建立信任：

### 8.1 ADR-0003 表述精确化

"Amber 不再执行"这句话已不严格成立。精确表述应为：

> **人工触发、四门门控、单次授权、哈希链留痕。**

即：`amber loop run --execute` 存在且可用，但被 Policy / Approval / Isolation / Evidence 四道门收拢，一次审批只授权一次运行，全程哈希链账本留痕。这是 ADR-0003 Consequences 节对自身的表述要求。

### 8.2 demo 前先演练

架构调研基于仓库文档与代码结构的静态分析，未实际运行 CLI 命令验证输出格式。**demo 前建议先在一个临时仓库跑一遍 7.3 清单**，确认实际行为与输出。

### 8.3 不引用 legacy 与未落地能力

- `docs/legacy/`、`.workflow/2026-06-09-*` 等历史目录为早期 harness 遗留快照，引用时应以 `docs/examples/README.md` 标注的当前命令为准；
- **Web viewer 的事件重放、SQLite 持久化等仍属"可吸收点"，尚未落地，勿表述为现有能力**；
- 既有对比文档中的部分事实性数字（如"10 个 ADR""5 个平台"）与当前仓库状态（docs/adr 现有 16 个文件）存在出入，分享前以当前仓库为准复核；
- 竞品 star 数均为快照/待确认数据，避免给出精确数字；Amber 自身社区规模无公开数据，回避量化对比。

---

## 九、附录

### 9.1 技术栈速览

| 项 | 内容 |
|---|---|
| 版本/许可 | v1.6.0，MIT，npm 包名 `amber-protocol` |
| 运行时 | Node.js `^20.19.0 \|\| ^22.12.0 \|\| >=23`，npm >=9；volta 固定 22.19.0 |
| 语言/模块制 | CLI 为 JavaScript CommonJS；apps/web 为 ESM + TypeScript（`npm run typecheck`） |
| 运行时依赖 | 仅 `ajv` ^8.20 + `ajv-formats` ^3.0.1（刻意零 LLM、离线可用、确定性） |
| devDeps | eslint、prettier、c8 |
| 测试 | Node.js 内置 test runner 经 `scripts/run-tests.js` 驱动；tests/ 含 unit（149 项）/integration/e2e/load/regression/migration/security 与按 roadmap 划分的 phase 测试；web 侧 vitest + Playwright |
| 覆盖率 | c8，阈值 lines/statements 84、functions 90、branches 73，`check-coverage: true` |
| CI 必过四件套 | `npm test`、`npm run manifests`、`npm run doctor`、`npm run gen:agents:check`；wiki 变更另跑 `node scripts/validate-wiki.js --target .` |
| 多平台分发 | Claude Code（`.claude-plugin/` + `.claude/commands/`）、Codex/Cursor（`.agents/skills/`）、Gemini CLI（`.gemini/commands/amber/`）、Grok（`/loop`）；另有 DeepSeek Harness overlay（`dsh/`）与 npm/GitHub Packages 双渠道发布 |
| 发布 | conventional commits；推 `v*.*.*` tag 在 CI 全绿且无 rc/beta 后缀时自动发布；错误码目录 `scripts/lib/core/error-catalog.js` 配 `amber explain` |

### 9.2 关键文件与文档索引

| 类别 | 路径 |
|---|---|
| 治理总纲 | `AGENTS.md`、`SPEC.md`、`CONTEXT.md`、`README.md` |
| 操作手册 | `docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md` |
| 架构 | `docs/architecture/overview.md`、`docs/architecture/governance-model.md` |
| MCP 设计 | `docs/wiki/amber-ontology-mcp.md`（v0.7，中文，可直接引用） |
| ADR | `docs/adr/`（16 个），重点：ADR-0001（artifact-first）、ADR-0003（gated execution）、ADR-0004（证据分级）、ADR-0009（上下文蒸馏）、ADR-0010（Loadout）、ADR-0011（安全哲学）、ADR-0014（路由顾问）、ADR-0016（决策接缝） |
| 示例 | `docs/examples/README.md` |
| 既有对比研究 | `docs/research-harness-pattern-comparison.md` |
| CLI 入口 | `scripts/amber.js`；核心：`scripts/lib/amber-core.js`、`scripts/lib/core/`（约 79 模块） |
| MCP | `scripts/amber-mcp.js`、`scripts/lib/mcp-*.js` |
| Skills | `skills/`（5 个，SKILL.md 唯一事实源） |

### 9.3 术语表

| 术语 | 含义 |
|---|---|
| Governance Console | Amber 在目标仓库的可操作面（CLI + 工件输出），非托管服务 |
| Route | 声明式交付模板：定义阶段与闸门，描述结构、不执行内容 |
| Journey | 四条受治理旅程：delivery / diagnosis-adoption / context-continuity / continuous-improvement |
| Gate | 闸门（Route Gate / Plan Gate / Adoption Gate），默认 advisory，可选 hooks 机械强制 |
| Ledger | `ledger.jsonl` SHA-256 哈希链账本，tamper-evident |
| Loadout | 任务级上下文组装产物（ADR-0010），按词数预算与优先级填充 |
| Action Type | MCP 白名单中的类型化受治理事务（8 个） |
| Governance Seam | F018 治理接缝：MCP 适配器与 Amber 治理规则之间的强制不变量 |
| fail-closed | 无法运行的检查 = 失败的检查，无宽松降级路径 |
| executesAnything: false | 所有 loop contract 强制携带的执行能力声明 |
| handoff bundle | 便携续作包，让新 agent 无需聊天记录即可续作 |

---

*文档完。配套演讲大纲见 `docs/sharing/2026-08-amber-sharing-outline.md`。*
