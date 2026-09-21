<div align="center">

# Amber Protocol

> **把 AI 编码工作变成可信续接。**

![Amber Protocol](./assets/readme/amber-protocol-banner.png)

![CI](https://github.com/Bandersnatch0x/amber-protocol/workflows/CI/badge.svg)
![npm](https://img.shields.io/npm/v/amber-protocol?style=flat-square)
![Node Version](https://img.shields.io/badge/node-%5E20.19%20%7C%7C%20%5E22.12%20%7C%7C%20%3E%3D23-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)

<p align="center">
  <a href="#适用对象">适用对象</a> ·
  <a href="#产品旅程">产品旅程</a> ·
  <a href="#安装">安装</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="./docs/TEAM_REPLICATION_CHARTER.md">Team Replication Charter</a> ·
  <a href="#核心概念">核心概念</a> ·
  <a href="#文档">文档</a> ·
  <a href="./README.md">English</a>
</p>

<p align="center">
  面向已经把 Coding Agent 用于真实交付的项目。<br />
  计划、证据、决策与交接和代码一起留在仓库里。<br />
  <b>状态：</b>稳定版 · <a href="./ROADMAP.md">里程碑与测试状态 →</a>
</p>

</div>

---

Amber Protocol 是面向 **Coding-Agent-Enabled Repository** 的仓库本地治理层：这类项目已经持续使用一个或多个 Coding Agent 做真实交付，并由人类承担审查责任。难点不再只是生成代码，而是换人、换 agent 或换会话后，后继者能否仅凭仓库状态判断发生了什么、什么已获批准、证据是否足够，以及下一步是什么。

Amber 把计划、会话、证据、决策和交接显式留在代码旁。它的核心结果是 **Trusted Continuation（可信续接）**：另一个人或 agent 不读取旧聊天，也能理解当前状态并正确继续一步。

**Amber = 仓内团队复制层：把「如何安全用 AI 改这个仓」写成可交接的文件证据。**

它挂在你已有的编码引擎之下，补治理与证据；不是又一个 agent 运行时，也不是组织级平台。

| Amber 是                          | Amber 不是                         |
| --------------------------------- | ---------------------------------- |
| 仓库内的治理与证据协议            | 组织级 Skill 市场 / 插件商店       |
| 可审查的计划 · 闸门 · 审批 · 交接 | 跨仓网关或跨机器总控看板           |
| 可在团队间复制的本地约定          | 常驻调度 / 自动跑项目命令的 daemon |

---

## 三层

| 层            | 职责                                                             |
| ------------- | ---------------------------------------------------------------- |
| 引擎          | 读改代码、调工具、跑模型与 agent loop（由你选用的编码宿主提供）  |
| 治理（Amber） | 计划、闸门、审批、doctor/audit、handoff；证据写入仓库文件        |
| 可选上层壳    | 只经 MCP 消费 Amber；不改 .amber 契约，不把 loop 塞进 Amber 内核 |

主线：引擎干活；Amber 证明「做了什么、是否可留、如何交接」。

---

## 硬非目标

这些是产品边界，不是 TODO：

1. 不替代编码引擎 / 不做通用 agent 运行时
2. 不跑动态工作流、不调度 live subagent、不自动执行你的项目命令
3. 不做组织级市场、跨仓网关、跨机器看板、always-on 调度器
4. 不覆盖已有项目文档（init 与 wiki 只补缺失文件）

完整边界见 [Team Replication Charter](./docs/TEAM_REPLICATION_CHARTER.md) 与 [SPEC.md](./SPEC.md)。

## 适用对象

- **目标环境：Coding-Agent-Enabled Repository**——Coding Agent 已经参与持续、真实、受人工审查的交付；一次性试用或只安装了工具不算。
- **主要用户：Repository Maintainer**——对仓库结果和连续性负责。
- **工作用户：agent-assisted developer**——定义并执行有边界的交付工作。
- **决策用户：reviewer**——依据计划、diff 与证据做 go/no-go 决定。

## 为什么需要 Amber

- **不读旧聊天也能继续**：计划、session、证据和 handoff 让状态能跨人、跨 agent 携带。
- **从仓库证据审查**：决策依据是可检视产物，而不是 transcript 中的一句“已完成”。
- **在正确阶段恢复**：失败与中断保留在产生它的步骤，不被成功叙事覆盖。
- **明确保留人类权限**：审批和治理边界是可查记录，不是隐藏的运行时假设。

## 产品旅程

```text
资格判断 → 安全接入 → 首次可信续接 → 日常交付 → 失败恢复 → 审查 / 验收
```

| Journey           | 用户结果                                | 默认表面                                                     | 完成证据                                  |
| ----------------- | --------------------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| J0 · 资格判断     | 确认 Amber 是否解决真实续接或审查问题   | `amber audit`                                                | 只读发现与明确的采用/暂缓决定             |
| J1 · 安全接入     | 不覆盖已有文件地建立最小仓库表面        | `amber init`、`amber doctor`                                 | 可复验的 setup                            |
| J2 · 首次可信续接 | 让新上下文正确继续一项真实工作          | `amber next`、`amber plan`、`amber session`、`amber handoff` | 新人或新 agent 不读旧聊天仍正确行动       |
| J3 · 日常交付     | 定义、授权、工作、证明、审查、交接/验收 | Agent journey；CLI 回退                                      | 计划、session、命令证据和 checkpoint 一致 |
| J4 · 失败恢复     | 在失败、暂停或上下文丢失后回到正确阶段  | `amber session`、`amber next`、`amber handoff`               | 失败仍可见，恢复动作有边界                |
| J5 · 审查 / 验收  | 依据仓库证据做 go/no-go 决定            | 计划、Gate、Evidence、Web Viewer                             | 不看 transcript 也能解释决定              |

Feature、Bugfix、Refactor 仍由后台 Route 分型；前台只保留一个心智模型：

```text
Frame → Authorize → Work → Prove → Review → Handoff / Accept
```

上下文修复、持续改进、团队扩展和高保证治理是条件路径，不阻塞首次可信续接。完整定义见[功能矩阵](./docs/wiki/features/feature-map.md)与[用户旅程](./docs/wiki/product/user-scenarios.md)。

## 安装

### 从 npm 安装（推荐）

```bash
npm install -g amber-protocol
amber --version
```

### 从源码安装

```bash
git clone https://github.com/Bandersnatch0x/amber-protocol.git
cd amber-protocol
npm install
node scripts/amber.js --version
```

## 快速开始（约 10 分钟）

用一项真实工作验证 Amber 是否产生可信续接；只生成文件不算激活。

```bash
# J0 — 不修改项目地判断是否适配
amber audit --target my-project

# J1 — 安装最小表面；已有文件一律跳过
amber init --target my-project
amber doctor --target my-project

# J2 — 定义一项真实目标并遵循状态推导出的下一步
amber next --objective "完成当前 API 修改" --target my-project

# 生成仓库本地续接材料
amber handoff --target my-project
```

然后新开一个不读取旧聊天的 agent 会话，或请另一位维护者只检查仓库。只有当这个新上下文能解释现状并正确继续一步时，Amber 才算完成激活。

`init` 和 `wiki` 永不覆盖已有文件。默认帮助只展示七个回退动词：`audit`、`init`、`doctor`、`next`、`plan`、`handoff`、`session`；专家与兼容表面保留在 `amber --all`。完整命令面见 [CLI 参考](./docs/CLI_REFERENCE.md)。

## 在 DeepSeek Harness 里用

Amber 挂在官方 [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic 下。以原生 dsh bundle 安装，无需手动改路径：

```bash
# 安装一次；dsh 把 Amber bundle 层加入 profile
dsh plugin --profile web add dsh-amber-protocol

# 安装后普通启动即加载 Amber（无需重复 --patch）
dsh --profile web
```

Windows 上默认端口 `3080` 常被系统保留，监听失败时加 `--port 13080`。

**未发布 checkout fallback：** 如果你在开发 Amber 本身且 bundle 尚未发布，改用 overlay patch。编辑 `dsh/amber-full.patch.yml`，把 `/path/to/amber-protocol` 换成本仓库路径，启动时叠加，不改 profile：

```bash
dsh --profile web --patch /path/to/amber-protocol/dsh/amber-full.patch.yml
```

完整说明见 [dsh/README.md](./dsh/README.md)。

### `amber loop recommend` —— 安全的持续改进入口

`amber loop recommend` 是只读命令：它扫描本地 workflow-pack 里的 loop contract，
按维护目标打分，并输出最适合人工审查的 dry-run 命令。它不会调度任务、执行 workflow
步骤、派发 agent，也不会写外部系统。

```bash
amber loop recommend --target . --goal "continuous improvement" --json
amber loop run --file workflow-packs/safe-amber-bootstrap.pack.json --contract daily-amber-triage --dry-run --json
```

当前产品边界仍不支持 live scheduling；`loop run` 必须带 `--dry-run`。

## 核心概念

Amber 把治理组织为七个控制层，并向安全侧倾斜——优先级越高，Amber 投入该层的表面就越多：

| 层              | 在 Amber 中的角色                                                                                                                   | 优先级 |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `Governance`    | 审批记录、安全默认值、策略边界和采纳控制约束行为。                                                                                  | 最高   |
| `Verification`  | doctor、audit、校验、review 和 gate 表面提供显式检查。                                                                              | 高     |
| `Observability` | 时间线、manifest、ledger 和报告让行为可检视。                                                                                       | 高     |
| `Lifecycle`     | route、session、checkpoint 和 worktree 在本地组织工作。                                                                             | 中     |
| `Context`       | starter 文档、wiki 骨架、manifest 和交接产物保持项目上下文显式。                                                                    | 中     |
| `Tooling`       | CLI 命令、schema、validator、workflow pack 和 profile 暴露显式接口。                                                                | 中     |
| `Execution`     | 门禁化且绑定能力注册——受治理的命令执行存在于四道门 + 冻结的 per-attempt 准入之后；没有无门运行时，原生安装也未注册任何 capability。 | 低     |

主线：强化 `Governance`、`Verification` 和 `Observability`；让 `Lifecycle` 保持仓库本地；避免漂移成完整的 agent 平台。[治理模型文档](./docs/architecture/governance-model.md)把每一层映射到具体命令。

**会安装什么** —— `doctor` 检查的最小表面：

- `AGENTS.md` 和 `CLAUDE.md` —— 面向 agent 的规则
- `feature_list.json` —— 被追踪的功能状态
- `PROGRESS.md`、`session-handoff.md`、`clean-state-checklist.md`、`evaluator-rubric.md`
- `.workflow/continuous-improvement/state.json`
- 最小 `docs/wiki/` —— 项目上下文、系统图、runbook、验证、术语表

所有 starter 文件都是安全默认值。`init` 和 `wiki` 跳过已有文件，并在 dry-run 模式报告将会创建的内容。

## 它不会做什么

这些边界是产品的一部分，不是 TODO：

- 不执行 Dynamic Workflow
- 不调用真实 subagent runner
- 不自动执行目标项目命令
- 不自动重写已有项目文档
- 当前产品不执行 scheduled loop
- 原生安装不执行任何受治理的 verb 阶段：实现拥有的 adapter 表出厂为**空**（无回退），`session run` 的 stage 一律 fail-closed，直到注册 capability——而注册是一次经过评审的代码变更，不是配置修改

完整边界说明见 [SPEC.md](./SPEC.md)。

### 治理信任层（trusted-control contracts）

旅程表面之外，Amber 还附带一层经过合同级测试的信任层（[四份 canonical contracts](./docs/specs/)，均已交付）：

- **受治理执行 attempt** —— `session run` 的每个 attempt 在任何效果之前冻结其准入输入（scope、policy、capability、请求摘要）；门禁对冻结值复验，授权 grant 绑定冻结三元组并单次消费。漂移在门上拒绝，先于执行。
- **带保证级别的证据** —— 回执携带 `unavailable / observed / replayable / verified`；replay 包（`amber handoff bundle --replay-scope`）可离线重建授权链。
- **受治理 memory** —— 可持续教训经 `amber memory`（request → ingest → 人工 approve → book）流转；`MEMORY.md` 保持人工策展并哈希注册。
- **指令面 evals** —— `amber eval run` 重放确定性的、与模型无关的 agent 面检查。
- **MCP Action Types** —— 20 个受治理动词的薄投影；变更类动作返回 `approvalRequired`，MCP 面从不执行。

这些面是协议的参考实现：受治理 verb 阶段当前**fail-closed**（未注册 capability——见"它不会做什么"），canonical specs 在等待协调者复评。

## 文档

| 主题                            | 链接                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 完整 CLI 参考                   | [docs/CLI_REFERENCE.md](./docs/CLI_REFERENCE.md)                                                                                                                                           |
| 快速开始指南                    | [docs/guides/user-getting-started.md](./docs/guides/user-getting-started.md)                                                                                                               |
| 架构与治理模型                  | [docs/architecture/governance-model.md](./docs/architecture/governance-model.md)                                                                                                           |
| 部署与运维                      | [docs/DEPLOYMENT.md](./docs/guides/DEPLOYMENT.md)                                                                                                                                          |
| 监控 / 通知 / 策略              | [MONITORING_SETUP.md](./docs/guides/MONITORING_SETUP.md) · [NOTIFICATION_SETUP.md](./docs/guides/NOTIFICATION_SETUP.md) · [POLICY_CONFIGURATION.md](./docs/guides/POLICY_CONFIGURATION.md) |
| 故障排查                        | [docs/TROUBLESHOOTING.md](./docs/guides/TROUBLESHOOTING.md)                                                                                                                                |
| 完整文档索引                    | [docs/README.md](./docs/README.md)                                                                                                                                                         |
| 规格与路线图                    | [SPEC.md](./SPEC.md) · [ROADMAP.md](./ROADMAP.md)                                                                                                                                          |
| DeepSeek Harness（`dsh`）叠加层 | [dsh/README.md](./dsh/README.md)                                                                                                                                                           |
| 贡献指南                        | [CONTRIBUTING.md](./CONTRIBUTING.md)                                                                                                                                                       |

可选 Web Viewer（`apps/web`）是旅程感知的判断表面：显示当前 J0–J5 阶段、下一条受治理动作、活跃 session、待处理 Gate 与仓库本地证据。它只反映 Amber 状态，不创建第二套流程，也不取代 Agent/CLI 权威表面。

```bash
cd apps/web
npm install --legacy-peer-deps
npm run dev
# 访问 http://localhost:3001
```

## 贡献

查看 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解开发设置、CI 和发布流程。

## 支持

- 📖 文档：[docs/](./docs/)
- 🐛 报告问题：[GitHub Issues](https://github.com/Bandersnatch0x/amber-protocol/issues)
- 💡 功能建议：[GitHub Discussions](https://github.com/Bandersnatch0x/amber-protocol/discussions)

## 许可证

MIT 许可证 —— 详见 [LICENSE](./LICENSE)。

---

<p align="center"><b>Amber Protocol</b> —— 为工程团队提供仓库本地 AI 编码治理。</p>
