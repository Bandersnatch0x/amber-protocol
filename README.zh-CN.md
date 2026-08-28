<div align="center">

# Amber Protocol

> **让 AI 编码会话可审查、有闸门、可交接。**

<p align="center">
  <img src="./assets/brand/amber-protocol-logo.png" alt="Amber Protocol 标志" width="160" />
</p>

![Amber Protocol](./assets/readme/amber-protocol-banner.png)

![CI](https://github.com/Bandersnatch0x/amber-protocol/workflows/CI/badge.svg)
![npm](https://img.shields.io/npm/v/amber-protocol?style=flat-square)
![Node Version](https://img.shields.io/badge/node-%5E20.19%20%7C%7C%20%5E22.12%20%7C%7C%20%3E%3D23-brightgreen?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#核心概念">核心概念</a> ·
  <a href="#文档">文档</a> ·
  <a href="./README.md">English</a>
</p>

<p align="center">
  面向 AI 辅助工程的仓库本地治理层——计划、闸门、审批与交接<br />
  全部以可检视的文件形式存放在你的仓库里。<br />
  <b>状态：</b>稳定版 · <a href="./ROADMAP.md">里程碑与测试状态 →</a>
</p>

</div>

---

Amber Protocol 是一个面向 AI 辅助工程的仓库本地治理层。当团队让 AI agent 在仓库里工作时，难的不再是写代码——而是搞清楚做了什么、是否安全保留、如何交接、如何证明已被审查。Amber 把这些环节显式化：它准备面向 agent 的上下文，记录审批与闸门，用只读检查验证状态，并生成交接与审计产物——全部以文件形式存放在你的仓库里。

它刻意保持保守。Amber 创建审查产物、dry-run 计划和审批记录。它**不会**运行 Dynamic Workflow、不会调用真实 subagent、不会执行你项目的命令，也不会重写你已有的文档。

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

## 快速开始

通过三个安全步骤把 Amber 引入既有仓库：

```bash
# 1. 对目标仓库做只读审计（不改动任何东西）
amber audit --target my-project --summary

# 2. 安装 Amber starter 文件（跳过任何已存在的文件）
amber init --target my-project

# 3. 验证仓库现已具备预期的面向 agent 的表面
amber doctor --target my-project
```

`init` 和 `wiki` 永不覆盖已有文件。完整命令面见 [CLI 参考](./docs/CLI_REFERENCE.md)。

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
