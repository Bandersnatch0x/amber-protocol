# Research: Amber Protocol vs Reference Harness Patterns — 重合点与可吸收点评估

> **来源**: 行业公开文章 — Agentic Harness 构建教程（2026-08-06, ~7,050 字）
> **关联参考**: 开源参考仓库 — macOS 编码代理控制中心
> **评估日期**: 2026-08-07

---

## 1. 参考材料概述

### 1.1 文章核心内容

行业文章是一份"0 到 100"的 **Agentic Harness 构建教程**，以一个前沿模型为示例，讲解如何从零构建一个 AI 编码代理的控制系统。文章的关键贡献是配套的参考仓库，作者在回复中明确推荐"直接把仓库给你的 agent"。

### 1.2 参考仓库概要

| 维度 | 内容 |
|------|------|
| **定位** | macOS 编码代理控制中心：一个目标，路由到直接执行、有界循环、群体或动态 DAG |
| **技术栈** | Rust（edition 2024），GPUI 桌面 UI，SQLite WAL |
| **架构** | 三进程：GPUI Shell（UI）+ Daemon（核心控制）+ Updater（原子更新） |
| **通信** | JSON-RPC 2.0 over Unix socket，peer-UID 认证 + Keychain 令牌 |
| **引擎** | 复用机器上已安装的 Codex CLI 和 Claude CLI，无需二次登录 |
| **安全** | 双层沙箱（引擎净化环境 + Seatbelt 配置文件），git worktree 隔离，fail-closed |
| **约束** | 本地唯一，无外部写入（V1 无 push/PR/deploy） |

### 1.3 Amber Protocol（当前项目）概要

| 维度 | 内容 |
|------|------|
| **定位** | 仓库本地治理层：让 AI 编码会话可审查、受门控、可交接 |
| **技术栈** | JavaScript（CommonJS），仅 2 个运行时依赖（ajv + ajv-formats） |
| **架构** | CLI（35 命令，注册表调度）+ React/tRPC Web 查看器 |
| **安全** | Dry-run 优先，四重门控执行（策略 + 审批 + worktree + 哈希链账本） |
| **引擎** | 通过 skills/ 集成 Claude Code / Codex / Cursor / Gemini CLI / Grok |
| **约束** | 制品优先，只读默认，不运行动态工作流、不调度实时子 agent、不执行项目命令 |

---

## 2. 核心定位差异

两个项目解决的是 **AI 编码代理治理的不同层面**，存在互补关系而非直接竞争：

```
                    Amber Protocol                    参考仓库
                    ┌──────────────────┐              ┌──────────────────┐
  治理层             │  审查 / 门控 / 交接  │              │                  │
  (Governance)      │  制品 / 账本 / 漂移  │              │  （未覆盖）        │
                    └──────────────────┘              └──────────────────┘
                    ┌──────────────────┐              ┌──────────────────┐
  编排层             │  路由模板 / 会话记录  │              │  路由器 / 协调器    │
  (Orchestration)   │  （声明式，非执行）  │  ←── 互补 ──→ │  （实时执行）      │
                    └──────────────────┘              └──────────────────┘
                    ┌──────────────────┐              ┌──────────────────┐
  执行层             │  受控单次执行       │              │  直接 / 循环 /     │
  (Execution)       │  (ADR-0003 门控)  │              │  群体 / DAG       │
                    └──────────────────┘              └──────────────────┘
```

**一句话总结**：Amber 回答"agent 做了什么、是否安全可保留、如何交接"；参考仓库回答"如何把一个目标安全地路由到合适的执行形态并实时运行"。

---

## 3. 重合点（Overlapping Areas）

### 3.1 AI 编码代理的安全管控

两者都致力于让 AI 编码代理的工作更安全、更可控，但切入点不同：
- **Amber**: 通过审批门控、dry-run 默认、制品审计实现"可证明的安全"
- **参考仓库**: 通过进程隔离、沙箱、worktree 隔离实现"运行时安全"

### 3.2 Git Worktree 隔离

两者都使用 git worktree 隔离 AI agent 的工作：
- **Amber**: ADR-0003 的四重门控执行中，worktree 隔离是第三道门
- **参考仓库**: 每个 edit run 拥有独立 worktree 和分支，用户当前分支永不被写入

### 3.3 人机协作审批门控

两者都有 human-in-the-loop 审批机制：
- **Amber**: `plan` → `gate` → `review` → `accept`；`loop approve` 授权单次执行
- **参考仓库**: `/approve` 接受提议的计划；Swarm 和 DynamicDag 额外要求人工批准

### 3.4 本地优先与隐私

两者都强调本地操作：
- **Amber**: 仓库本地制品，不依赖外部服务
- **参考仓库**: "Local only, no external writes"，无凭证复制

### 3.5 多引擎集成

两者都支持多个 AI 编码引擎：
- **Amber**: 通过 `skills/` 目录生成 Claude Code / Codex / Cursor / Gemini CLI / Grok 的适配文件
- **参考仓库**: 通过 EngineAdapter 契约统一 Codex CLI 和 Claude CLI，复用已有登录

### 3.6 会话/运行生命周期

两者都有显式的生命周期状态机：
- **Amber**: `session start/status/list/abort/continue/complete-check/verify/approve`
- **参考仓库**: run 状态机 + node 状态机，pause/resume/cancel 控制

### 3.7 可审计性与可重放

两者都强调可审计性：
- **Amber**: 哈希链账本（tamper-evident ledger）、timeline、manifest、交接包
- **参考仓库**: SQLite WAL 事件日志，每个事件先持久化再广播，通过 `since_sequence` 重放

### 3.8 无进展检测

两者都关注 agent 卡死问题：
- **Amber**: loop contract 声明 no-progress 条件（重复观察、未变发现、重复失败命令等）
- **参考仓库**: 在 daemon 中实现具体的信号映射和检测（Started/Finished/Source progress），并有 bug 修复历史

### 3.9 显式状态机

两者都使用显式状态矩阵而非隐式图：
- **Amber**: run 状态和 node 状态是显式矩阵
- **参考仓库**: Run/Node 状态是显式矩阵，非法转换返回 `Result::Err` 而非 panic

---

## 4. 可吸收点（Absorption Points）

以下按"与 Amber 当前产品边界的契合度"和"实现价值"排序，从高到低。

### 4.1 ⭐⭐⭐ "不确定性向下流动，永不向上"原则

**参考仓库做法**:
> 路由器基于测量到的事实决定执行形态。低置信度的路由提案降级为有界循环。Swarm 和 DynamicDag 额外要求人工批准。原因：未被验证的图会将多个 worker 提交到未被验证的计划。

**Amber 现状**: Amber 有 dry-run → execute 的二元选择，以及四重门控，但缺少**置信度驱动的执行形态降级**概念。

**吸收建议**: 在 Amber 的 governance rules（`.amber/governance/rules.json`）中引入**执行形态分级**：
- 高置信度（有已验证的 route 模板、已通过的 plan gate）→ 允许 governed execution
- 中置信度（有 plan 但未通过 gate）→ 仅 dry-run
- 低置信度（无 plan、无标准匹配）→ 建议人工审查，拒绝执行

这与 Amber 的"制品优先、治理优先"哲学完全一致，且不需要引入运行时执行能力。

### 4.2 ⭐⭐⭐ 执行路由模式分类法

**参考仓库做法**: 五种路由模式 — Direct Execution / Bounded Loop / Swarm / Dynamic DAG / Coordinator Chat，每种有不同的安全约束。

**Amber 现状**: Amber 有 routes（feature-standard / bugfix-quick / refactor-safe）和 loops，但缺少**执行形态的显式分类**。routes 是线性的交付模板，loops 是声明式循环。

**吸收建议**: 在 Amber 的 route 和 loop contract schema 中增加 `execution_mode` 字段，引入分类法：
- `direct` — 单次门控执行（当前 ADR-0003 的 `loop run --execute`）
- `bounded_loop` — 有界迭代循环（当前 loop contract）
- `swarm` — 多 worker 并行（声明式记录，对应 V4.5 agent orchestration records）
- `dag` — 依赖图执行计划（声明式，route 的扩展）

这不改变 Amber 的"声明式非执行"边界——这些模式作为**契约和记录**存在，而非实时调度。

### 4.3 ⭐⭐⭐ SQLite WAL 事件持久化 + 重放

**参考仓库做法**: 每个事件先写入 SQLite WAL 追加日志，然后才广播给订阅者。断连一小时的客户端和从未断连的客户端通过相同的重放路径收敛。

**Amber 现状**: Amber 使用 JSON 文件（session-manifest.json、timeline-event.json 等）作为持久化。Web 查看器使用 SSE 推送，但缺少**事件重放**机制——断连后需要重新加载完整状态。

**吸收建议**: 为 Amber 的 Web 查看器引入事件日志层：
- 在 `apps/web/server/` 增加一个 SQLite 事件日志（或复用 Amber 的 ledger 概念）
- 每个 session/gate/lifecycle 事件写入日志后广播
- 客户端断连重连时通过 `since_sequence` 重放
- 这可以复用 Amber 已有的 `loop-ledger.js` 和 `ledger-seal.js` 逻辑

### 4.4 ⭐⭐ "Follow-up 是新 Run"模式

**参考仓库做法**: 后续对话是一个**新的 run**，带 `parent_run_id`，而非同一会话的新 turn。同一线程的所有 turn 共享一个 worktree 和 provider home，使 provider 可恢复上一轮转录。

**Amber 现状**: Amber 的 session 是连续的，`session continue` 在同一会话上下文中恢复。缺少 **run 级别的隔离与链式关系**。

**吸收建议**: 在 Amber 的 session model 中引入 `run` 概念：
- 一个 session 包含多个 run，每个 run 有 `parent_run_id`
- `session continue` 创建新 run 而非延续旧 run
- run 之间共享 worktree 和 agent 上下文
- 这可以让 `handoff bundle` 更精确地打包单个 run 而非整个 session

### 4.5 ⭐⭐ 执行选择作为持久化 Run 数据

**参考仓库做法**: Provider、model、reasoning effort 是经过验证、持久化、可重放的字段。排队的 run 不会静默继承后续的选择器变更。

**Amber 现状**: Amber 的 loop contract 记录了命令和策略，但 engine/model/effort 的选择没有被显式持久化为可重放字段。

**吸收建议**: 在 loop contract 和 session manifest schema 中增加：
```json
{
  "execution_context": {
    "engine": "claude-code | codex | cursor",
    "model": "string",
    "reasoning_effort": "low | high | max",
    "pinned_at": "ISO-8601",
    "pinned_by": "string"
  }
}
```
这确保 dry-run 重放使用创建时的引擎/模型，而非当前默认值。

### 4.6 ⭐⭐ Fail-Closed 策略的显式化

**参考仓库做法**: 无沙箱、无代理、或启动金丝雀失败 → 拒绝 `run.start` 并返回诊断信息。**没有非沙箱降级方案**。

**Amber 现状**: Amber 的 governance rules 检查策略合规性，但缺少**前置条件失败时的显式 fail-closed 语义**。`loop run --execute` 的门控检查失败会阻止执行，但没有明确文档化"绝不降级"原则。

**吸收建议**: 在 ADR 和 governance rules 中显式声明：
- worktree 创建失败 → 拒绝执行，不降级为在主分支操作
- 策略文件缺失 → 拒绝执行，不降级为无策略
- 哈希链验证失败 → 拒绝执行，标记为潜在篡改
- 所有门控检查必须是 fail-closed，不存在"宽松模式"降级路径

### 4.7 ⭐⭐ 版本化线协议

**参考仓库做法**: 所有 JSON-RPC 信封携带 `protocol_version`；事件携带单调递增 `sequence`、`run_id`、时间戳、类型、payload。

**Amber 现状**: Amber 的 JSON Schema 定义了结构，但缺少**协议版本字段**和**事件序列号**。不同版本的 Amber 制品之间没有显式兼容性声明。

**吸收建议**: 在所有 Amber 制品 schema 中增加：
```json
{
  "amber_protocol_version": "1.3.12",
  "artifact_sequence": 42,
  "created_at": "ISO-8601",
  "artifact_type": "session-manifest | timeline-event | loop-contract | ..."
}
```
这可以让 `doctor` 和 `migrate` 更精确地检测版本漂移。

### 4.8 ⭐⭐ 无进展检测的具体实现信号

**参考仓库做法**: 具体实现了信号映射：
- `ToolStatus::Started` 计为 action（而非 Started + Finished 双重计数）
- 首次检视给定读取目标时发出 `Progress::Source`
- 去重键使用原始 target 而非归一化的（避免数字折叠导致碰撞）
- 有 5 个回归测试覆盖

**Amber 现状**: Amber 的 loop contract **声明** no-progress 条件（重复观察、未变发现、重复失败命令、重复工具调用、空证据增量、预算耗尽），但这些条件的**检测逻辑**依赖 host agent 或人工判断。

**吸收建议**: 在 `workflow-assessment` 模块中增加**无进展检测器**：
- 解析 session timeline 事件
- 检测重复工具调用（基于 target 去重）
- 检测空证据增量（`result inspect` 的 diff 为空）
- 检测预算耗尽（loop contract 的 budget_ceiling）
- 输出到 `governance report` 作为风险项

### 4.9 ⭐ Coordinator Chat 路由入口

**参考仓库做法**: 有一个协调器聊天作为路由决策入口，AI 引擎提议执行形态，系统决定是否信任。

**Amber 现状**: Amber 的 `next` 命令是只读推断——它推断生命周期位置并打印单条最相关下一步命令。但缺少**目标驱动的路由建议**——用户给出一个目标，系统建议使用哪个 route / loop / workflow-pack。

**吸收建议**: 将 `next` 命令进化为**路由顾问**：
- `amber next --objective "fix login bug"` → 建议使用 `bugfix-quick` route
- `amber next --objective "add payment integration"` → 建议使用 `feature-standard` route + `secure-code-review` workflow-pack
- 基于已有的 route manifest 和 workflow-pack 元数据进行匹配
- 仍然是只读建议，不执行

### 4.10 ⭐ 动态 DAG 执行计划（声明式）

**参考仓库做法**: 支持动态有向无环图执行计划，AI 引擎提议图结构，需人工批准。

**Amber 现状**: Amber 的 routes 是线性模板（步骤序列）。复杂特性可能需要并行/依赖图。

**吸收建议**: 作为 V2 route 的扩展，在 route schema 中支持 `dag` 类型：
```json
{
  "route_type": "dag",
  "nodes": [
    {"id": "design", "depends_on": []},
    {"id": "frontend", "depends_on": ["design"]},
    {"id": "backend", "depends_on": ["design"]},
    {"id": "integration", "depends_on": ["frontend", "backend"]}
  ]
}
```
仍然是声明式模板，`route validate` 检查无环、依赖完整性，`route test --dry-run` 解释执行计划。**不引入实时 DAG 调度**。

### 4.11 ⭐ Swarm 模式记录

**参考仓库做法**: 实现了多 worker 群体执行，需人工批准。

**Amber 现状**: V4.5 有 agent orchestration records（`agent dispatch/stop/resume/review`），workers 不能自我批准，reviewer 证据与 worker 输出分离。但这是**记录**，不是实时调度。

**吸收建议**: Amber 已在这方面领先于参考仓库的"记录"维度。可以吸收的是 **swarm 的具体安全约束**：
- swarm 提议需人工批准（Amber 可在 `agent dispatch` schema 中标记 `requires_approval: true`）
- 低置信度的 swarm 降级为 bounded loop（对应 4.1 的原则）

---

## 5. Amber 的独特优势（无需变更）

评估中也发现 Amber 在以下方面具有参考仓库不具备的优势，应保持：

| 优势 | 说明 |
|------|------|
| **制品优先** | Amber 的所有输出是可检视的仓库本地文件，不依赖运行时进程 |
| **跨平台** | Amber 是 JavaScript CLI，可在 Windows/macOS/Linux 运行；参考仓库仅限 macOS |
| **轻量依赖** | Amber 仅 2 个运行时依赖；参考仓库需要 Rust 工具链 + Metal |
| **多引擎 skills** | Amber 通过 `skills/` 生成 5 个平台的适配；参考仓库仅支持 2 个引擎 |
| **Web 查看器** | Amber 有 React/tRPC 查看器；参考仓库是原生桌面 app |
| **交接包** | Amber 有 `handoff bundle/validate`；参考仓库无交接概念 |
| **治理评分** | Amber 有 `governance report` 和 `workflow assess`；参考仓库无治理评分 |
| **上下文蒸馏** | Amber 有契约驱动的 `context request/ingest/verify`；参考仓库无此概念 |
| **文档生态** | Amber 有 10 个 ADR、28KB SPEC、完整 CLI 参考；参考仓库仅 README |

---

## 6. 优先级建议

按实现成本和价值排序：

| 优先级 | 可吸收点 | 实现成本 | 价值 |
|--------|---------|----------|------|
| **P1** | 4.1 不确定性向下流动原则 | 低（文档 + rules schema） | 高（安全哲学升级） |
| **P1** | 4.6 Fail-closed 显式化 | 低（文档 + ADR） | 高（安全边界明确化） |
| **P1** | 4.7 版本化线协议 | 中（schema 变更 + migrate） | 高（版本漂移检测） |
| **P2** | 4.2 执行路由模式分类法 | 中（schema + doctor 检查） | 中（route/loop 语义增强） |
| **P2** | 4.8 无进展检测器 | 中（新模块 + 测试） | 中（governance report 增强） |
| **P2** | 4.5 执行选择持久化 | 中（schema 变更） | 中（重放准确性） |
| **P3** | 4.3 SQLite WAL 事件日志 | 高（Web 查看器架构变更） | 中（断连重连体验） |
| **P3** | 4.4 Follow-up 是新 Run | 高（session 模型重构） | 中（交接精度） |
| **P3** | 4.9 Coordinator Chat 路由 | 中（next 命令增强） | 中（用户体验） |
| **P4** | 4.10 DAG 路由模板 | 高（route schema 扩展） | 低（复杂场景才需要） |
| **P4** | 4.11 Swarm 安全约束 | 低（schema 标记） | 低（V4.5 已覆盖大部分） |

---

## 7. 结论

Amber Protocol 与参考仓库处于 **AI 编码代理治理的不同层面**，存在大量概念重叠但互补性强。Amber 的"治理/审计/交接"定位与参考仓库的"执行/编排/调度"定位形成清晰的分界。

**最值得吸收的三个点**：

1. **"不确定性向下流动"原则**（4.1）—— 以极低成本升级 Amber 的安全哲学，在 governance rules 中引入置信度驱动的执行形态降级
2. **Fail-closed 显式化**（4.6）—— 将 Amber 已有的门控行为文档化为"绝不降级"原则，消除模糊地带
3. **版本化线协议**（4.7）—— 在所有制品中引入协议版本和序列号，增强 `doctor` 和 `migrate` 的版本漂移检测能力

这三个点都与 Amber 的"制品优先、治理优先、最小执行边界"哲学完全一致，不需要引入运行时执行能力，且实现成本低。

参考仓库最值得借鉴但实现成本较高的是 **SQLite WAL 事件日志**（4.3）和 **Follow-up 是新 Run** 模式（4.4），这两点会显著改善 Web 查看器的断连重连体验和会话交接精度，但需要架构层面的调整。

---

## 来源

- **行业文章**: 公开 Agentic Harness 构建教程（2026-08-06）
- **参考仓库**: 开源编码代理控制中心 — README 及 crate 结构
- **Amber SPEC**: `SPEC.md`
- **Amber Roadmap**: `ROADMAP.md`
- **Amber Backlog**: `BACKLOG.md`
- **Amber ADR-0003**: `docs/adr/0003-governance-gated-execution.md`
