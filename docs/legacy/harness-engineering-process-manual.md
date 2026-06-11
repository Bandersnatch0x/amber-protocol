> Historical document predating the Amber Protocol rename; product names reflect the era. See docs/legacy/README.md.

# Harness Engineering 可实操流程手册

基于 Learn Harness Engineering 课程整理：<https://walkinglabs.github.io/learn-harness-engineering/en/>

## 0. 这份手册解决什么问题

AI 编程 Agent 的失败，很多时候不是模型不够强，而是工作系统不完整：任务边界不清、上下文不足、环境不可复现、验证缺失、跨会话状态丢失。Harness Engineering 的目标不是“让模型更聪明”，而是为 Agent 建立一个可执行、可验证、可交接的闭环工作系统。

一句话定义：

> Harness = Instructions + Tools + Environment + State + Feedback

对应到项目里，就是：

- `AGENTS.md` / `CLAUDE.md`：告诉 Agent 怎么工作。
- `init.sh` / `init.ps1` / `make check`：让环境启动和验证可重复。
- `feature_list.json`：让任务边界和状态机器可执行。
- `PROGRESS.md` / `session-handoff.md`：让跨会话连续。
- 测试、日志、健康检查、评估表：让完成判断基于证据，而不是 Agent 自信。

## 1. 一页版流程

1. 建立仓库为唯一事实源。
   把运行方式、项目结构、约束、决策、当前进度、验证命令写进仓库。不要依赖口头说明、聊天记录或人的记忆。

2. 放入最小 Harness 包。
   先准备 `AGENTS.md` 或 `CLAUDE.md`、`init.sh`、`PROGRESS.md`、`feature_list.json`。项目变复杂后再加 `session-handoff.md`、`clean-state-checklist.md`、`evaluator-rubric.md`。

3. 先初始化，不写业务代码。
   第一阶段只做环境、依赖、启动命令、测试框架和任务拆分。目标是让任何新 Agent 打开仓库后能启动、能测试、能知道下一步。

4. 用功能清单驱动工作。
   每次只允许一个 feature 进入 `in_progress`。每个 feature 必须有用户可见行为、验收标准、验证步骤和证据字段。

5. 每次开工前运行启动流程。
   Agent 必须读取说明、进度、功能清单，运行基础验证，确认基线是好的，再开始改代码。

6. 实施时保持 WIP=1。
   只完成当前 feature。发现旁支问题，记录到 `notes` 或新 feature，不顺手扩大范围。

7. 用三层验证判断完成。
   静态检查和单元测试通过只是第一层；运行时行为和关键路径是第二层；端到端或系统级场景是第三层。没有证据，不得标记 `passing`。

8. 结束前留下干净状态。
   更新 `feature_list.json`、`PROGRESS.md` 和 handoff；清掉临时文件；确认标准启动和标准验证仍可运行。

9. 定期评估 Harness 本身。
   把重复出现的失败转成自动检查、规则或模板。Harness 会像代码一样腐化，需要审计和维护。

## 2. 最小文件结构

建议从这个结构开始：

```text
project-root/
  AGENTS.md                  # Codex / 通用 Agent 根说明
  CLAUDE.md                  # 如果使用 Claude Code，可用这个替代或补充
  init.sh                    # macOS/Linux 启动和验证脚本
  init.ps1                   # Windows 项目可加 PowerShell 版本
  feature_list.json          # 机器可读功能状态
  PROGRESS.md                # 当前进度和下一步
  session-handoff.md         # 跨会话交接，可后续加入
  clean-state-checklist.md   # 收尾检查，可后续加入
  evaluator-rubric.md        # 质量评估表，可后续加入
```

如果团队不想增加太多文件，至少保留：

- `AGENTS.md` 或 `CLAUDE.md`
- `feature_list.json`
- 一个标准验证命令，例如 `npm run check`、`pytest`、`make check`
- 一个进度记录文件，例如 `PROGRESS.md`

## 3. 文件 1：AGENTS.md / CLAUDE.md

用途：根指令文件，是 Agent 进入项目后最先读取的工作规则。

必须包含：

- 项目是什么、用户是谁、核心目标是什么。
- 技术栈、运行时版本、关键目录。
- 第一次启动和日常启动命令。
- 不可违反的硬约束。
- 任务范围规则，例如“一次只做一个 feature”。
- 完成定义：什么证据允许标记完成。
- 收尾规则：结束前必须更新哪些状态文件。

可复制骨架：

```md
# Agent 工作规则

## 项目概览
- 产品目标：
- 技术栈：
- 关键目录：

## 启动流程
1. 读取 `PROGRESS.md`
2. 读取 `feature_list.json`
3. 运行基础验证：`npm run check`
4. 如果验证失败，先修复基线，不开始新 feature

## 工作规则
- 同一时间只处理一个 feature
- 不扩大范围；旁支问题记录到 feature notes
- 修改代码前先确认目标行为和验证方式
- 不用“代码已写完”作为完成依据

## Definition of Done
- 静态检查通过
- 单元/集成测试通过
- 关键用户路径或端到端场景通过
- `feature_list.json` 中记录证据
- `PROGRESS.md` 已更新

## 收尾流程
1. 运行标准验证
2. 更新 feature 状态和 evidence
3. 更新 `PROGRESS.md`
4. 清理临时文件和调试残留
5. 写下下一步或 blocker
```

## 4. 文件 2：feature_list.json

用途：把“任务列表”变成 Agent 不容易绕过的执行原语。它同时服务于调度、验证、进度统计和交接。

每个 feature 至少包含：

- `id`：短唯一标识。
- `priority`：数字越小优先级越高。
- `area`：所属模块。
- `title`：简短标题。
- `user_visible_behavior`：用户能看到或感受到的行为。
- `status`：`not_started`、`in_progress`、`blocked`、`passing`。
- `verification`：逐步验证说明。
- `evidence`：通过验证后的证据。
- `notes`：上下文、约束、遗留问题。

可复制骨架：

```json
{
  "features": [
    {
      "id": "F001",
      "priority": 1,
      "area": "search",
      "title": "Document search returns relevant results",
      "user_visible_behavior": "User enters a keyword and sees matching documents ranked by relevance.",
      "status": "not_started",
      "verification": [
        "Run unit tests for search ranking",
        "Start the app",
        "Search for a known document title",
        "Confirm the expected document appears in the result list"
      ],
      "evidence": [],
      "notes": []
    }
  ]
}
```

状态规则：

- `not_started`：尚未开始。
- `in_progress`：当前正在做；默认只允许一个。
- `blocked`：无法继续，必须写清 blocker。
- `passing`：验证已通过，并记录证据。

严禁：

- 没有验证证据就改成 `passing`。
- 同时把多个 feature 改成 `in_progress`。
- 把“顺手修了”但未验证的内容混进当前 feature。

## 5. 文件 3：init 脚本

用途：把启动、依赖安装、基线验证变成可重复动作。Agent 进入项目时先运行它，而不是凭感觉探索。

脚本应完成：

1. 打印当前目录，防止跑错位置。
2. 安装依赖或确认依赖。
3. 运行基础验证。
4. 打印开发服务器启动命令。
5. 如果验证失败，明确要求先修复基线。

示例：

```bash
#!/usr/bin/env bash
set -euo pipefail

INSTALL_CMD="${INSTALL_CMD:-npm install}"
VERIFY_CMD="${VERIFY_CMD:-npm run check}"
START_CMD="${START_CMD:-npm run dev}"

echo "cwd: $(pwd)"
echo "install: $INSTALL_CMD"
$INSTALL_CMD

echo "verify: $VERIFY_CMD"
$VERIFY_CMD

echo "start command: $START_CMD"
if [ "${RUN_START_COMMAND:-0}" = "1" ]; then
  $START_CMD
fi
```

Windows 项目可以提供等价的 `init.ps1`，或把标准命令放进 `package.json` / `Makefile`，让 Agent 调用统一入口。

## 6. 文件 4：PROGRESS.md

用途：跨会话状态持久化。把 Agent 当成“每次下班都会失忆的工程师”，下班前必须把下一班需要知道的内容写清楚。

建议格式：

```md
# Project Progress

## Current State
- Current feature:
- Latest verification:
- Known failing checks:

## Completed
- [x]

## In Progress
- [ ]

## Blocked
- Blocker:
- Needed decision:

## Next Actions
1.
2.
3.
```

每次会话结束前必须更新：

- 当前 feature 状态。
- 最新验证结果。
- 未完成工作。
- blocker 和需要用户决策的地方。
- 下一次会话的第一步。

## 7. 标准工作流

### 阶段 A：建 Harness

输入：

- 一个已有项目或新项目。
- 目标 Agent：Codex、Claude Code、Cursor、Windsurf 等。
- 项目的标准运行和验证命令。

动作：

1. 创建 `AGENTS.md` 或 `CLAUDE.md`。
2. 创建 `feature_list.json`。
3. 创建 `PROGRESS.md`。
4. 创建 `init.sh` 或统一脚本入口。
5. 把依赖版本写进 `package.json`、`pyproject.toml`、`.nvmrc`、`.python-version`、Dockerfile 或 devcontainer。
6. 至少准备一个能通过的样例测试，证明测试框架可用。

产出：

- 新 Agent 不需要你口头解释，也能回答：项目是什么、如何启动、如何验证、当前进度是什么、下一步做什么。

验收：

- 开一个新 Agent 会话，不给额外上下文，只让它读仓库。
- 问它 5 个问题：系统是什么、结构如何、怎么运行、怎么验证、当前进度是什么。
- 如果答不出来，把缺失信息补进仓库。

### 阶段 B：初始化会话

Agent 开始每次工作前必须执行：

1. 读 `AGENTS.md` / `CLAUDE.md`。
2. 读 `PROGRESS.md`。
3. 读 `feature_list.json`。
4. 运行 `init.sh`、`npm run check`、`make check` 或项目标准验证。
5. 如果基线失败，先修复基线；不启动新 feature。
6. 选择优先级最高的 `not_started` feature。
7. 将其标为 `in_progress`。

产出：

- 明确的当前 feature。
- 明确的验证路径。
- 明确的排除项。

### 阶段 C：签订 Sprint Contract

编码前，让 Agent 写一个短合同：

```md
## Sprint Contract

Feature:

In scope:
- 

Out of scope:
- 

Acceptance:
- 

Verification:
- 

Risks:
- 
```

规则：

- 用户可见行为必须写清楚。
- 不做的内容也要写清楚。
- 验证命令必须可执行。
- 不允许把“将来可优化”混成当前目标。

### 阶段 D：实现

执行原则：

- WIP=1：只做当前 feature。
- 先让最小路径跑通，再扩展边界情况。
- 出现新问题时先分类：
  - 阻止当前 feature 完成：记录为 blocker 并处理。
  - 不阻止当前 feature：写入 `notes` 或新 feature，不扩大当前范围。
- 每次重大修改后运行相关局部验证。

Agent 可使用的工作提示：

```text
请只处理 feature_list.json 中当前 in_progress 的 feature。
先说明你将修改哪些文件和验证什么行为。
如果发现旁支问题，只记录，不要扩大范围。
完成后必须运行 verification 中列出的检查，并把证据写入 evidence。
```

### 阶段 E：三层验证

完成判断不能由 Agent 自己的信心决定，必须由外部证据决定。

第 1 层：静态和局部正确性

- 格式化。
- lint。
- 类型检查。
- 单元测试。

第 2 层：运行时行为

- 应用能启动。
- 关键页面或 API 能运行。
- 文件、数据库、网络等副作用正确。
- 错误路径不会静默失败。
- 资源能清理。

第 3 层：系统级确认

- 端到端测试。
- 集成路径。
- 用户场景模拟。
- 重启或重新运行后仍然正确。

状态流转规则：

```text
not_started -> in_progress -> passing
                         \-> blocked
```

只有三类信息都齐全，才能进入 `passing`：

- 运行了什么命令。
- 输出结果是什么。
- 对应了哪个验收条件。

### 阶段 F：观测

Harness 的观测分两层。

运行时观测回答“系统做了什么”：

- 日志。
- 健康检查。
- 进程状态。
- 关键事件。
- 测试输出。

过程观测回答“为什么可以接受这个改动”：

- Sprint Contract。
- feature evidence。
- evaluator rubric。
- 计划和决策记录。
- handoff。

最低要求：

- 每个 feature 的 evidence 里至少记录一次标准验证结果。
- 对端到端失败，要保留失败原因和修复方式。
- 重复出现的失败类别，要升级成自动测试或静态规则。

### 阶段 G：干净收尾

结束前运行 `clean-state-checklist`：

- 标准启动仍然可用。
- 标准验证仍然可运行。
- `feature_list.json` 状态真实，没有假 `passing`。
- `PROGRESS.md` 已更新。
- blocker 已写清。
- 临时文件、调试日志、无用 TODO 已处理。
- 下一次会话不需要你口头解释。

可复制 handoff：

```md
# Session Handoff

## Repo State
- Branch:
- Latest commit:
- Dirty files:

## Runtime State
- Startup:
- Verification:
- Known failures:

## Feature State
- Passing:
- In progress:
- Blocked:

## Decisions Made
-

## Next Actions
1.
2.
3.
```

## 8. 评估表

每个会话或里程碑后，从 0 到 2 分评估：

| 维度 | 0 分 | 1 分 | 2 分 |
| --- | --- | --- | --- |
| Correctness | 行为不符合目标 | 部分符合 | 完整符合 |
| Verification | 未运行或无证据 | 运行部分检查 | 完整检查且有证据 |
| Scope discipline | 明显越界 | 有轻微范围漂移 | 严格保持当前 feature |
| Reliability | 重启或重跑失败 | 部分稳定 | 可重复运行 |
| Maintainability | 难以接手 | 基本可读 | 下一会话可直接继续 |
| Handoff readiness | 无交接 | 交接不完整 | 仓库内信息足够恢复 |

结论：

- Accept：可接受。
- Revise：需要修正。
- Block：根本问题未解决。

调优规则：

- 如果评估表经常“看见问题但仍然放行”，就把放行条件写得更具体。
- 计划 3 到 5 轮人工校准，让 rubric 和人的判断逐渐对齐。

## 9. Project 01 实操：Prompt-only vs Minimal Harness

这个实验用来亲自验证 Harness 是否有效。

准备一个中等复杂度但不巨大的任务，例如：

- Electron 知识库应用壳。
- 左侧文档列表。
- 右侧问答面板。
- 本地数据目录。
- 简单启动和验证命令。

### 第一次：Prompt-only

只给 Agent 一个任务描述，不提供 `AGENTS.md`、`feature_list.json`、`init.sh`。

记录：

- Agent 花多久理解项目。
- 修改了多少文件。
- 是否越界。
- 是否运行验证。
- 是否过早宣布完成。
- 最终用户路径是否真的可用。

### 第二次：Minimal Harness

同样任务，预先放入：

- `AGENTS.md`
- `init.sh`
- `feature_list.json`
- `PROGRESS.md`

要求 Agent：

1. 先运行初始化。
2. 只处理一个 feature。
3. 按 feature verification 验证。
4. 写 evidence。
5. 收尾更新进度。

记录同样指标。

### 对比指标

| 指标 | Prompt-only | Minimal Harness |
| --- | --- | --- |
| 启动到可执行状态耗时 | | |
| 范围漂移次数 | | |
| 未验证就声称完成次数 | | |
| 端到端路径是否通过 | | |
| 下一会话恢复成本 | | |
| 人工纠偏次数 | | |

实验结论不要只看“有没有完成”，要看是否可复现、可验证、可交接。

## 10. 常见失败与修复

失败：Agent 写了很多代码，但核心功能不可用。

修复：为每个 feature 写用户可见行为和端到端验证，不允许只靠单元测试完成。

失败：Agent 顺手改了很多无关内容。

修复：`feature_list.json` 只允许一个 `in_progress`，旁支问题进入 notes 或新 feature。

失败：新会话不知道上次做了什么。

修复：每次结束前更新 `PROGRESS.md` 和 `session-handoff.md`，记录 commit、验证、blocker、next actions。

失败：AGENTS.md 越写越长，Agent 开始忽略规则。

修复：把规则分层。根文件只放硬约束和入口，把细节拆到专门文档或技能里，按需加载。

失败：测试失败信息只说“错了”，Agent 不知道怎么修。

修复：把错误消息写成可操作反馈，例如说明禁止的边界、应该移动到哪个层、应该调用哪个 API。

失败：Agent 每次都说“完成了”，但你一试就坏。

修复：完成判断外部化。必须通过静态、运行时、系统级三层验证，并写入 evidence。

失败：Harness 一开始有效，后来越来越不准。

修复：像维护代码一样维护 Harness。每次失败做归因，把重复失败提升为自动检查、模板规则或评估项。

## 11. 30 分钟落地清单

如果你现在就要在一个项目里开始：

1. 新建 `AGENTS.md`，写清启动命令、验证命令、一次一个 feature、完成定义。
2. 新建 `feature_list.json`，先放 3 个最重要 feature。
3. 新建 `PROGRESS.md`，写当前状态、已完成、下一步。
4. 创建统一验证命令，例如 `npm run check` 或 `make check`。
5. 让 Agent 开一个新会话，只读仓库，回答“项目是什么、怎么运行、怎么验证、下一步是什么”。
6. 选择一个 feature 标为 `in_progress`。
7. 要求 Agent 写 Sprint Contract。
8. 实施后运行三层验证。
9. 通过后写 evidence，状态改为 `passing`。
10. 收尾更新 `PROGRESS.md` 和 handoff。

## 12. 最佳使用方式

Harness 最适合用在这些场景：

- 多文件、多模块、跨会话的开发任务。
- 需要 Agent 长时间持续工作的项目。
- 经常出现“Agent 说完成了，但实际没跑通”的项目。
- 需要多人或多 Agent 接力的项目。
- 有明确验证命令、测试、构建或端到端流程的项目。
- 正在把 AI 编程从个人试用推进到团队流程的项目。

Harness 不适合被当成一次性提示词。它应该像工程基础设施一样存在于仓库里，持续被读取、执行、更新和审计。

推荐使用原则：

1. 从最小 Harness 开始，不要一开始就做复杂平台。
2. 先把验证命令跑通，再让 Agent 大规模写代码。
3. `feature_list.json` 只维护真正要交付的功能，不塞碎片任务。
4. 每次只允许一个 `in_progress`，用 WIP=1 换可靠完成。
5. 所有 `passing` 都必须有 evidence。
6. 每次 Agent 失败后，不只改代码，也要改 Harness。
7. 高频规则放进自动检查，低频背景信息放进文档，不要把根指令写成巨型文件。

## 13. 交给 Agent 一键设置

在一个已有项目里，可以直接把下面这段发给 Agent。让它自己识别项目技术栈、创建最小 Harness，并完成第一次验证。

```text
请在当前项目中一键设置最小 Harness。不要先写业务功能。

目标：
让任何新 Agent 会话只依赖仓库内容，就能知道项目是什么、如何启动、如何验证、当前进度是什么、下一步做什么。

请完成：
1. 检查项目结构、技术栈、包管理器、运行命令和测试命令。
2. 创建或更新 AGENTS.md。如果当前 Agent 使用 Claude Code，也创建或更新 CLAUDE.md。
3. 创建 feature_list.json，先放入 3-5 个你从项目现状推断出的核心 feature；如果无法推断，创建示例 feature 并标注需要用户确认。
4. 创建 PROGRESS.md，记录当前仓库状态、验证状态、已知问题和下一步。
5. 创建 init.sh；如果是 Windows 友好项目，也创建 init.ps1。脚本要包含依赖安装、基础验证、启动命令提示。
6. 创建 clean-state-checklist.md 和 session-handoff.md。
7. 如果项目已有测试/构建/lint，请把标准验证命令写入 AGENTS.md 和 init 脚本。
8. 运行一次基础验证。若失败，记录失败原因，不要伪装成通过。
9. 最后输出：
   - 新增或修改的 Harness 文件
   - 推断出的标准启动命令
   - 推断出的标准验证命令
   - 当前无法确认的信息
   - 下一步建议

硬性规则：
- 不要实现新业务功能。
- 不要把未验证的 feature 标为 passing。
- 不要删除用户已有文件。
- 如果命令不确定，写成候选项并请求确认。
```

如果希望更强约束，可以追加：

```text
完成前请自检：
- 一个新 Agent 是否能只读仓库回答：项目是什么、怎么运行、怎么验证、当前进度是什么、下一步是什么？
- feature_list.json 是否只有一个或零个 in_progress？
- 是否存在没有 evidence 的 passing？
- init 脚本是否真的能执行基础验证？
- PROGRESS.md 是否能支撑下一会话接手？
```

## 14. 一键设置后的验证方法

设置 Harness 后，不要只看文件是否创建，要验证它是否真的能约束 Agent。

### 验证 1：新会话恢复测试

开一个新的 Agent 会话，不给任何口头背景，只让它读取仓库，然后问：

1. 这个项目是什么？
2. 技术栈和关键目录是什么？
3. 如何安装依赖并启动？
4. 如何运行完整验证？
5. 当前进度和下一步是什么？

通过标准：

- 5 个问题都能从仓库文件中回答。
- 回答不依赖聊天历史。
- 回答里的命令和文件路径真实存在。

### 验证 2：基线启动测试

运行 Harness 指定的初始化命令：

```bash
./init.sh
```

Windows 项目运行：

```powershell
./init.ps1
```

通过标准：

- 能确认当前目录。
- 能安装或检查依赖。
- 能运行基础验证。
- 失败时能清楚说明失败项。
- 不会在失败时继续声称项目 ready。

### 验证 3：Feature 状态机测试

检查 `feature_list.json`：

- 是否每个 feature 都有 `id`、`priority`、`area`、`title`、`user_visible_behavior`、`status`、`verification`、`evidence`、`notes`。
- 是否最多只有一个 `in_progress`。
- 是否没有空 evidence 的 `passing`。
- 是否每个 feature 的 verification 都是可执行步骤，而不是泛泛描述。

通过标准：

- Agent 能选择优先级最高的 `not_started` feature。
- Agent 能解释为什么当前只做这个 feature。
- Agent 能说清楚完成它需要哪些验证。

### 验证 4：完成定义测试

让 Agent 做一个小 feature，然后观察它是否：

1. 先写 Sprint Contract。
2. 只处理当前 feature。
3. 运行局部验证。
4. 运行标准验证。
5. 把证据写进 `feature_list.json`。
6. 更新 `PROGRESS.md`。
7. 不把“代码写完”当成“完成”。

通过标准：

- 没有验证失败仍标记完成的情况。
- 没有明显范围漂移。
- 下一会话能接上。

### 验证 5：Prompt-only 对照实验

选一个小任务跑两次：

- 第一次只给普通提示词。
- 第二次使用 Harness。

对比：

- 启动耗时。
- 人工纠偏次数。
- 范围漂移次数。
- 验证是否真实执行。
- 端到端路径是否通过。
- 下一会话恢复成本。

如果 Harness 版本没有明显变好，说明 Harness 还太弱。优先检查验证命令、feature list、完成定义和 progress/handoff。

## 15. Harness 带来的好处

Harness 的收益不是“让 Agent 写得更多”，而是让 Agent 更稳定地完成正确的事。

### 1. 降低失控概率

没有 Harness 时，Agent 容易同时处理多个问题，最后每个都差一点。Harness 用 WIP=1、feature 状态机和完成证据，把工作收束到一个可验证目标。

### 2. 减少“过早宣布完成”

Agent 天然容易把“代码看起来合理”当成“任务完成”。Harness 用 Definition of Done、三层验证和 evidence，把完成判断外部化。

### 3. 提升跨会话连续性

长任务一定会遇到上下文耗尽、会话切换或人机接力。`PROGRESS.md`、`feature_list.json` 和 handoff 能让新会话快速恢复状态，减少重新理解成本。

### 4. 让仓库成为唯一事实源

Agent 看不到你脑子里的背景，也看不到散落在会议、聊天和口头说明里的决策。Harness 把运行方式、约束、决策、进度和验证写进仓库，降低信息不可见带来的误判。

### 5. 提高验证质量

Harness 要求把验证命令、端到端路径、运行时信号写清楚。这样 Agent 不只是写代码，还会被迫证明代码真的能跑。

### 6. 降低团队协作成本

不同人或不同 Agent 接手时，不需要重新解释项目状态。只要仓库里的状态文件可信，交接成本就会下降。

### 7. 让失败可复盘、可固化

每次失败都能归因到某个 Harness 层：任务、上下文、环境、状态、验证。重复失败可以升级为自动测试、静态规则、模板或检查清单。

### 8. 节省模型成本

与其换更贵模型，不如先补齐 Harness。很多失败来自工作系统缺陷，而不是模型能力不足。好的 Harness 能减少重试、返工和人工纠偏。

## 16. 完整工程形态：Wiki

最小 Harness 适合起步。项目一旦进入多模块、多团队、多 Agent 或长期迭代，完整形态应该升级为“仓库内 Wiki + 状态文件 + 可执行验证”的组合。

这里的 Wiki 不是外部知识库的随手记录，而是 Agent 可读取、可引用、可维护的工程事实源。推荐放在仓库内，例如 `docs/wiki/`。

外部 Wiki 可以同步展示，但不要让它成为唯一事实源。Agent 最稳定的输入仍然是仓库文件、脚本和工具输出。

### 16.1 Wiki 的定位

Wiki 承载稳定知识：

- 产品目标和用户场景。
- 系统架构和模块边界。
- 运行、部署、验证手册。
- 架构决策和约束。
- 功能说明和验收标准。
- 常见故障和处理方法。
- Agent 工作规则的详细解释。

状态文件承载动态状态：

- `feature_list.json`：当前功能状态和 evidence。
- `PROGRESS.md`：当前进度、blocker、下一步。
- `session-handoff.md`：会话交接。

脚本和测试承载可执行规则：

- `init.sh` / `init.ps1`
- `make check` / `npm run check`
- 单元、集成、端到端测试
- 架构边界检查

一句话原则：

> Wiki 解释为什么和怎么做；状态文件记录现在做到哪；脚本和测试证明是否真的做对。

### 16.2 推荐目录结构

```text
project-root/
  AGENTS.md
  feature_list.json
  PROGRESS.md
  session-handoff.md
  clean-state-checklist.md
  evaluator-rubric.md
  init.sh
  init.ps1
  docs/
    wiki/
      index.md
      product/
        overview.md
        user-scenarios.md
        feature-map.md
      architecture/
        system-map.md
        module-boundaries.md
        data-flow.md
        decisions/
          0001-record-architecture-decisions.md
      engineering/
        runbook.md
        verification.md
        local-development.md
        release.md
        troubleshooting.md
      agent/
        harness.md
        working-rules.md
        prompt-recipes.md
        failure-patterns.md
      features/
        F001-example-feature.md
      glossary.md
```

这个结构可以缩小。小项目保留 `index.md`、`runbook.md`、`verification.md`、`harness.md`、`glossary.md` 就够。

### 16.3 每个页面负责什么

`docs/wiki/index.md`

- Wiki 首页。
- 列出项目是什么、关键入口、必读页面。
- 告诉 Agent 新会话应该按什么顺序读取。

`docs/wiki/product/overview.md`

- 产品目标。
- 用户是谁。
- 核心使用场景。
- 什么不属于本项目。

`docs/wiki/architecture/system-map.md`

- 系统整体结构。
- 关键模块职责。
- 主要数据流。
- 外部依赖。

`docs/wiki/architecture/module-boundaries.md`

- 哪些模块可以互相调用。
- 哪些调用被禁止。
- 违反边界时应该怎么改。

`docs/wiki/engineering/runbook.md`

- 本地启动。
- 常用命令。
- 开发服务器。
- 数据准备。
- 环境变量。

`docs/wiki/engineering/verification.md`

- 标准验证命令。
- 局部验证命令。
- 端到端验证路径。
- 失败时的排查顺序。

`docs/wiki/agent/harness.md`

- Harness 的文件清单。
- Agent 开工流程。
- 完成定义。
- 收尾流程。
- 哪些文件由 Agent 自动更新。

`docs/wiki/agent/failure-patterns.md`

- 过去发生过的 Agent 失败。
- 根因归类。
- 已经固化成什么规则、测试或检查。

`docs/wiki/glossary.md`

- 项目术语表。
- 统一命名。
- 禁用或易混淆术语。

### 16.4 AGENTS.md 如何接入 Wiki

`AGENTS.md` 不应该复制整份 Wiki。它只需要做路由。

可复制写法：

```md
## Wiki Routing

Before starting work, read:
1. `docs/wiki/index.md`
2. `docs/wiki/engineering/runbook.md`
3. `docs/wiki/engineering/verification.md`
4. `docs/wiki/agent/harness.md`
5. The feature page under `docs/wiki/features/` if it exists

Use the Wiki as the source of stable project knowledge.
Use `feature_list.json` and `PROGRESS.md` as the source of current state.
If Wiki content conflicts with executable checks, trust the executable checks and update the Wiki.
```

这样根指令保持短，细节留在 Wiki。Agent 需要时按路由读取，不会被一个超长根文件淹没。

### 16.5 Feature 页面模板

当 feature 复杂到一个 JSON 字段说不清，可以给它建立 Wiki 页面。

```md
# F001 Example Feature

## User-visible Behavior

用户能看到什么变化。

## Scope

In:
- 

Out:
- 

## Acceptance Criteria

- 

## Verification

1. 
2. 
3. 

## Architecture Notes

- 涉及模块：
- 数据流：
- 边界约束：

## Evidence

完成后记录验证命令、结果和截图/日志位置。

## Open Questions

- 
```

`feature_list.json` 仍然保留机器可读状态。Feature Wiki 页面负责补充背景、边界和验收细节。

### 16.6 交给 Agent 一键搭建 Wiki

可以把下面这段直接发给 Agent：

```text
请把当前项目的 Harness 升级为仓库内 Wiki 形态。不要写业务功能。

目标：
建立 docs/wiki/，让稳定项目知识、Agent 工作规则、验证方式和功能背景都能从仓库读取。

请完成：
1. 阅读现有 AGENTS.md、feature_list.json、PROGRESS.md、package.json/pyproject.toml/Makefile 等项目入口。
2. 创建 docs/wiki/index.md，列出新 Agent 必读顺序。
3. 创建 docs/wiki/product/overview.md，说明产品目标、用户、核心场景和非目标。
4. 创建 docs/wiki/architecture/system-map.md，说明模块职责和数据流。
5. 创建 docs/wiki/architecture/module-boundaries.md，说明允许和禁止的跨模块调用。
6. 创建 docs/wiki/engineering/runbook.md，记录安装、启动、环境变量和常用命令。
7. 创建 docs/wiki/engineering/verification.md，记录标准验证、局部验证和端到端验证。
8. 创建 docs/wiki/agent/harness.md，记录 Agent 开工、执行、完成和收尾流程。
9. 创建 docs/wiki/agent/failure-patterns.md，用于记录 Agent 失败模式和固化规则。
10. 创建 docs/wiki/glossary.md，提炼项目术语。
11. 如已有 feature_list.json，为重要 feature 创建 docs/wiki/features/Fxxx-*.md 页面。
12. 更新 AGENTS.md，加入 Wiki Routing，要求新会话先读 docs/wiki/index.md。
13. 最后运行一次基础验证，并报告 Wiki 是否足以让新 Agent 接手。

硬性规则：
- Wiki 内容必须基于仓库现有事实，不确定的内容标注为“需要确认”。
- 不要编造不存在的命令、模块或业务规则。
- 不要删除现有文档。
- 如果发现 Wiki 与可执行命令冲突，以命令为准，并在 Wiki 中记录冲突。
```

### 16.7 Wiki 的验证方法

Wiki 搭好后，要验证它是否真的能服务 Agent。

冷启动验证：

- 开新会话，不提供口头背景。
- 让 Agent 先读 `docs/wiki/index.md`。
- 要求它说出项目目标、架构、运行命令、验证命令、当前状态和下一步。

链接验证：

- `docs/wiki/index.md` 中列出的页面都必须存在。
- `AGENTS.md` 引用的 Wiki 页面都必须存在。
- feature 页面引用的命令和文件路径必须真实。

命令验证：

- `runbook.md` 里的启动命令能执行。
- `verification.md` 里的验证命令能执行。
- 如果命令失败，Wiki 要说明失败含义和排查顺序。

状态一致性验证：

- Wiki 的 feature 说明不能和 `feature_list.json` 冲突。
- Wiki 的当前状态不能替代 `PROGRESS.md`。
- `passing` 状态必须仍以 evidence 为准。

重复信息验证：

- 根指令只放路由和硬规则。
- Wiki 放稳定知识。
- 状态文件放当前进度。
- 同一条规则不要在 5 个地方复制粘贴。

### 16.8 Wiki 维护节奏

每次会话结束：

- 更新 `PROGRESS.md`。
- 必要时更新 feature 页面 evidence。
- 如果发现 Wiki 错误，顺手修正。

每个里程碑结束：

- 更新 `system-map.md`。
- 更新 `verification.md`。
- 把重复 review 反馈写入 `failure-patterns.md`。
- 把稳定的新术语写入 `glossary.md`。

每月或每个大版本：

- 删除过期页面。
- 合并重复页面。
- 检查所有启动和验证命令。
- 检查 AGENTS.md 的 Wiki Routing 是否仍然正确。

### 16.9 Wiki 反模式

反模式：把 Wiki 当成静态说明书。

修正：把 Wiki 纳入每次开发收尾。架构、验证、术语变化后必须更新。

反模式：把所有内容都塞进 `AGENTS.md`。

修正：`AGENTS.md` 做入口和硬约束，Wiki 做分层知识。

反模式：外部 Wiki 很完整，仓库里什么都没有。

修正：至少把 Agent 必须读取的内容放进仓库。外部 Wiki 只能做展示或补充。

反模式：Wiki 写了验证方式，但命令不可运行。

修正：验证页只记录真实命令。命令不确定就标注为候选，不要写成事实。

反模式：Wiki 和状态文件互相冲突。

修正：稳定知识归 Wiki，动态状态归 `feature_list.json` 和 `PROGRESS.md`。

## 17. 成功标准

一个项目的 Harness 算初步成功，需要满足：

- 新 Agent 不需要口头背景也能启动工作。
- 标准启动和标准验证路径可重复。
- 当前进度在仓库里可见。
- 每个 feature 都有用户可见行为和验证步骤。
- 同时只有一个主要 feature 在推进。
- Agent 不能无证据地标记完成。
- 会话结束后能留下干净状态。
- 重复失败会被转化为更强的 Harness 规则。

更高阶的成功标准：

- 端到端测试覆盖关键用户路径。
- 架构边界有自动检查。
- 错误消息包含修复指引，Agent 能根据失败信息自我纠正。
- 评估表和人工判断基本一致。
- 多个 Agent 或多次会话能稳定接力完成复杂任务。
