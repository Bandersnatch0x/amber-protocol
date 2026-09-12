# Amber Protocol

> **让 AI 编码会话可审查、有闸门、可交接。**
> 证据落在仓库文件里，不落在聊天记录里。

仓库本地的团队复制层（team replication layer）——计划、闸门、审批与交接，以可检视文件存放在你的仓库里。状态：稳定版。

导航：[定位](#定位) · [三层](#三层) · [硬非目标](#硬非目标) · [安装](#安装) · [快速开始](#快速开始约-10-分钟) · [Team Replication Charter](./docs/TEAM_REPLICATION_CHARTER.md) · [English README](./README.md)

---

## 定位

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

首屏只保留这条路径：安装 → 审计 → 初始化 → 自检 →（可选）计划/闸门 → 交接。

```bash
# 1. 只读审计（不改仓库）
amber audit --target my-project --summary

# 2. 写入 starter（跳过已有文件）
amber init --target my-project

# 3. 自检 agent 表面是否齐全
amber doctor --target my-project

# 4.（可选）立一项计划并看下一闸门
amber plan --target my-project --feature F001 --title "…"
amber next --target my-project

# 5. 打出可携带的交接包并校验
amber handoff bundle --target my-project
amber handoff validate --target my-project
```

`init` / `wiki` 永不覆盖已有文件。专家命令、dsh 插件、lifecycle 全表、Web Viewer 等见下方原文与：

- `amber --all` — 完整兼容命令面
- [CLI 参考](./docs/CLI_REFERENCE.md)

---

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

| 层              | 在 Amber 中的角色                                                    | 优先级 |
| --------------- | -------------------------------------------------------------------- | ------ |
| `Governance`    | 审批记录、安全默认值、策略边界和采纳控制约束行为。                   | 最高   |
| `Verification`  | doctor、audit、校验、review 和 gate 表面提供显式检查。               | 高     |
| `Observability` | 时间线、manifest、ledger 和报告让行为可检视。                        | 高     |
| `Lifecycle`     | route、session、checkpoint 和 worktree 在本地组织工作。              | 中     |
| `Context`       | starter 文档、wiki 骨架、manifest 和交接产物保持项目上下文显式。     | 中     |
| `Tooling`       | CLI 命令、schema、validator、workflow pack 和 profile 暴露显式接口。 | 中     |
| `Execution`     | 最小化——Amber 避免成为通用执行运行时或真实 agent 平台。              | 低     |

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

完整边界说明见 [SPEC.md](./SPEC.md)。

## 文档

| 主题                            | 链接                                                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 完整 CLI 参考                   | [docs/CLI_REFERENCE.md](./docs/CLI_REFERENCE.md)                                                                                                                      |
| 快速开始指南                    | [docs/user-guide/getting-started.md](./docs/user-guide/getting-started.md)                                                                                            |
| 架构与治理模型                  | [docs/architecture/governance-model.md](./docs/architecture/governance-model.md)                                                                                      |
| 部署与运维                      | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)                                                                                                                            |
| 监控 / 通知 / 策略              | [MONITORING_SETUP.md](./docs/MONITORING_SETUP.md) · [NOTIFICATION_SETUP.md](./docs/NOTIFICATION_SETUP.md) · [POLICY_CONFIGURATION.md](./docs/POLICY_CONFIGURATION.md) |
| 故障排查                        | [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md)                                                                                                                  |
| 完整文档索引                    | [docs/README.md](./docs/README.md)                                                                                                                                    |
| 规格与路线图                    | [SPEC.md](./SPEC.md) · [ROADMAP.md](./ROADMAP.md)                                                                                                                     |
| DeepSeek Harness（`dsh`）叠加层 | [dsh/README.md](./dsh/README.md)                                                                                                                                      |
| 贡献指南                        | [CONTRIBUTING.md](./CONTRIBUTING.md)                                                                                                                                  |

Web 查看器（`apps/web`）为会话和时间线提供一个仪表盘：

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
