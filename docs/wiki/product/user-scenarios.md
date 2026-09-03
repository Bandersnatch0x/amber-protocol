---
type: product
title: User Scenarios
description: Primary user scenarios and journeys.
tags: [product]
updated: 2026-09-02
---

# User Scenarios

四条端到端旅程。每条都按"触发情境 → 逐步命令与输入 → 每步产出 → 用户最终拿走什么"展开。
命令全部来自当前 CLI 表面（`docs/CLI_REFERENCE.md`），旅程一已在 2026-09-02 于临时目录实跑验证。

---

## 旅程一：给现有 repo 接入治理（Quick Start）

**触发情境**：开发者已经用 Claude Code 在一个 Node API 仓库里写了几周功能。某次交接时同事看不出 agent 到底改了什么、能不能合并。他想加一层治理，但不想动现有工作树。

| 步 | 命令 | 产出 |
|---|---|---|
| 1 | `amber audit --target . --summary` | 只读报告：目标类型 `unharnessed-target-repo`，21 个 starter 文件缺失，0 冲突，下一条安全命令 |
| 2 | `amber init --target .` | 创建 40 个文件（AGENTS.md、CLAUDE.md、feature_list.json、routes/、docs/wiki/ 骨架等），已有文件 0 覆盖，附 .gitignore 建议 |
| 3 | `amber doctor --target .` | 通过/失败报告，确认最小 Amber setup 可用 |
| 4 | `amber governance report --target .` | 就绪分 83/100（warn），四条结构化 next actions |
| 5 | `amber next --target .` | 自动选中 F001，指出下一步是 `amber plan` |
| 6 | `amber handoff bundle --target .` | `.amber/handoff/latest/` 七件套：manifest、summary、evidence、risks、next-actions、recovery、README |
| 7 | `amber handoff validate --target .` | Bundle valid，0 errors |

**用户拿走**：一个经 doctor 验证、零覆盖的治理脚手架。下一个 agent 会话有 wiki 骨架可读而不是凭空编造；同事有 handoff bundle 可以直接接手。整个过程在 `init` 之前全是只读。

**已验证失败模式**：`gate` 在用户确认和 context manifest 未填写前返回 exit 1 并列出三条错误。这是设计行为（fail-closed），不是缺陷。

---

## 旅程二：一个功能的完整治理生命周期

**触发情境**：开发者在 TypeScript monorepo 里加 OAuth2 登录。他希望计划可见、审批有记录、证据可查，几周后回来不用翻聊天记录。

| 步 | 命令 | 产出 |
|---|---|---|
| 1 | `amber session start --goal "add OAuth2 login" --target .` | `.amber/sessions/<id>/` manifest + timeline，自动匹配 `feature-standard` 路由 |
| 2 | `amber plan --target . --feature F042 --title "OAuth2 login"` | `docs/plans/F042-OAuth2-login.md`：垂直切片、来源包、每片验证步骤、验收标准，状态"待确认" |
| 3 | `amber gate --target . --feature F042 --plan docs/plans/F042-OAuth2-login.md` | 首次 exit 1：要求用户确认 + 填写 implement/review 两个角色的 context manifest。开发者填好后重跑，gate 通过 |
| 4 | （写代码、提交） | — |
| 5 | `amber session verify --execute --target .` | 在隔离 worktree 里跑一次受限验证命令，写入账本和 evidence receipt，timeline 记录结果 |
| 6 | `amber review --target . --plan docs/plans/F042-OAuth2-login.md` | 标准检查发现清单、范围纪律四问、releaseReadiness |
| 7 | `amber accept --target . --plan docs/plans/F042-OAuth2-login.md` | F042 状态置为 `passing`，附非空 evidence；追加 evolution 记录 |
| 8 | `amber handoff bundle --target .` | 可携带的交接包，含 dirty-path 三分类 |

**用户拿走**：plan → gate → evidence → review → accept 全链路都是 repo 里的文件。任何后续会话从 handoff bundle 就能续，不依赖聊天历史。F042 带着可核验的"做了什么、谁批的"。

---

## 旅程三：团队多仓库接入评估

**触发情境**：小公司的技术负责人要评估 Amber 是否适合团队。三个仓库成熟度不同，他要在承诺推广前拿到一张具体的就绪图。

| 步 | 命令 | 产出 |
|---|---|---|
| 1 | 对三个 repo 各跑 `amber audit --target repos/<x> --summary` | 三份只读迁移报告：`api` 有半个 AGENTS.md 无 wiki；`web` 一无所有；`infra` 有 legacy `.harness/` |
| 2 | 对三个 repo 各跑 `amber adoption report --target repos/<x> --output-dir docs/adoptions` | 三份结构化就绪报告，含维度分和能力缺口 |
| 3 | `amber adoption bundle --reports-dir docs/adoptions --index docs/adoptions/index.md --output-dir docs/adoptions/bundle` | 跨仓库对比包，共性缺口，优先级路径 |
| 4 | `amber adoption gate --reports-dir docs/adoptions` | `api` 过线；`web` 需先 init；`infra` 需先 `migrate state` |
| 5 | `amber migrate state --target repos/infra` | `.harness/` → `.amber/`，默认 dry-run，`--execute` 才落盘 |
| 6 | `amber adoption next-actions --bundle-dir docs/adoptions/bundle --output docs/adoptions/next-actions.md` | 按仓库排好序的行动清单 |

**用户拿走**：一套可以直接拿去开会的决策包。三个目标仓库一个字节都没被改。从已过线的 `api` 开始，按清单逐仓推进。

---

## 旅程四：会话中途交接（换人或换 agent）

**触发情境**：开发者和 Claude Code 做数据库迁移两小时，上下文快满了，功能只完成一半。他要干净地停下，让下一个会话（或同事）无损接手。

| 步 | 命令 | 产出 |
|---|---|---|
| 1 | `amber session status --target .` | 当前会话 ID、路由阶段、timeline 摘要、最后一个 checkpoint |
| 2 | `amber session continue --target .` | 写入 checkpoint：当前阶段、最后完成动作、未决项 |
| 3 | `amber handoff bundle --target .` | 首次校验报告两处缺口：验证步骤未记录、next action 为空 |
| 4 | 手工编辑 `session-handoff.md`：填 `next_action` 和 `blockers` | — |
| 5 | `amber handoff validate --target .` | 全部必填项就位，bundle valid |
| 6 | 新会话：`amber session status --target .` 然后 `amber next --target .` | 当前状态 + 由路由和已记录证据推导出的下一条安全命令 |

**用户拿走**：一个经过校验的交接包。manifest、timeline、checkpoint、handoff 互相链接，治理链不断。新上下文不需要猜。

---

## Unknowns / Needs Confirmation

- 旅程二至四的命令组合来自 CLI_REFERENCE 和 feature_list 证据，尚未像旅程一那样在干净临时目录整体实跑。建议纳入每周 dogfood 轮换。
