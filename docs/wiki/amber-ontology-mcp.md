# Amber Ontology MCP 协议设计文档

Last Reviewed: 2026-08-14

**版本**：0.7（F018 治理与仓库隔离修复已落地）
**状态**：`implemented` — 协议契约、stdio 服务器、OAG 查询层、学习回路、结构化返回、多目标、Functions、并发守卫、跨仓库视图、所有权写回、函数 schema 校验、结果缓存均已落地；F018 在此之上强制了已配置仓库不变量、契约一致性、只读/受治理执行分离与 fail-closed 语义。
**相关工件**：`schemas/action.type.schema.json`、`action-types/`（白名单）、`action-functions/`（Functions）、`scripts/amber-mcp.js`（服务器）、`scripts/lib/mcp-targets.js`（已配置仓库模块）、`scripts/lib/mcp-action-contracts.js`（命令能力注册表 + 契约校验）、`tests/unit/mcp-targets.test.js`、`tests/unit/mcp-action-contracts.test.js`、`tests/integration/amber-mcp.test.js`

---

## 1. 背景与动机

Amber 当前是「仓库本地治理层」：命令（session、route、gate、ledger）约束、
验证、审计 agent 在仓库内的操作。它拥有「名词」（session、route、wiki、
evidence）与「门」（approval、verify、ledger），但缺少一层让外部 agent 以
类型化、可审计方式调用这些能力的「动词」接口。

本设计把 Amber 的治理能力表达为**操作型本体**（operational-ontology 定位，
见 CLAUDE.md「治理哲学」章节）：外部 agent 不再绕过 Amber 直接改仓库，
而是通过 Amber 暴露的受治理操作（Action Type）完成任务。

## 2. 目标与非目标

**目标**

- 为外部 agent（Claude、Codex、Grok 等支持 MCP 的客户端）提供安全的
  Amber 操作入口。
- 每个操作可声明：参数、提交条件、副作用、回滚、证据要求、审批方。
- 与现有产物完全兼容：`governed-runner.js` 门控、`ledger.jsonl`、
  `timeline-event`、session manifest 均不改变格式。

**非目标（当前版本不包含）**

- 不引入新的持久化存储；复用 `.amber/sessions/<id>/` 现有结构。
- 不绕过人工审批：所有 `amber.*` 操作沿用现有 approval gate。
- 不为 agent 提供任意 shell/文件写能力——操作类型白名单之外一律拒绝。
- 查询层只覆盖白名单内的 object 族（session/route/context/ledger）；
  `amber.object.query` 之外的 OAG 能力（如自动学习回路）留待后续。

## 3. 核心概念映射

| Amber 现有概念 | 本体角色 | 说明 |
| --- | --- | --- |
| session / route / wiki / evidence | Object Type | 仓库内可操作的对象 |
| `amber session start`、`amber gate` | Action Type | 类型化的受治理事务 |
| `governed-runner.js`（policy、approval、worktree） | Governance Gate | 执行前门控 |
| `timeline.jsonl` + `ledger.jsonl` | Evidence Recorder | 执行后留痕 |
| `schemas/*.schema.json` | Language | 对象与操作的契约层 |

**Action Type 契约**（`schemas/action.type.schema.json`）声明一个操作
「能干什么、需要什么参数、谁可以批准、必须留下什么证据」，是协议层与
执行层之间的唯一接口。

## 4. 协议形状（JSON-RPC 2.0 over MCP）

当前服务器（v0.7）只实现 MCP 原生工具形态：`tools/list` 返回 Action Type
与 Function 工具，`tools/call` 提交调用。没有实现 `amber.action.*` 自定义
JSON-RPC 方法、server-to-client 审批推送或变更执行队列。

MCP（Model Context Protocol）以 JSON-RPC 2.0 承载请求。Amber 实现以下
原生方法：

| Method | 方向 | 说明 |
| --- | --- | --- |
| `initialize` | client → server | 协商协议版本并声明 tools capability |
| `tools/list` | client → server | 列出 Action Type 与 Function 工具 |
| `tools/call` | client → server | 调用一个工具；只读操作可执行，变更操作只形成待审批提交 |
| `ping` | client → server | 存活检查 |

### 4.1 `tools/call` 请求

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "amber.session.start",
    "arguments": { "goal": "fix login bug", "route": "bugfix-quick", "_agent": "claude" }
  },
  "id": 1
}
```

### 4.2 响应

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "{...structured outcome...}" }],
    "isError": false
  }
}
```

执行结果语义：未知的工具名、非法参数、提交条件未满足一律以 **MCP 原生
JSON-RPC 错误**返回（`tools/call` → `-32602`，未知方法 → `-32601`），
而非自定义的 `accepted=false` 字段——P1 服务器（v0.3）只暴露 MCP 原生
工具形态，不实现 `amber.action.*` 自定义方法，因此错误形状以 JSON-RPC
为准。`mode=dry-run` 表示只校验并报告预期效果；`approvalRequired=true`
表示执行需人工审批（变更类操作从不由适配器直接 spawn）。

## 5. 操作生命周期

```
describe → submit(execute) → gate(dry-run/validation)
   → approve (human | loop-contract | system)
   → execute (worktree-isolated)
   → record (timeline + ledger)
   → verify (evidence hash)
   → [rollback]
```

每个阶段失败都写 `timeline-event` 并停止，绝不静默继续。

## 6. 与现有 CLI 的映射（P1 白名单，已实现）

| Action Type | 映射命令 | approver | 证据 |
| --- | --- | --- | --- |
| `amber.session.start` | `amber session start` | system | timeline-event |
| `amber.session.verify` | `amber session verify` | system | timeline-event |
| `amber.session.approve` | `amber session approve` | human | approval-record |
| `amber.session.status` | `amber session status` | system | —（只读） |
| `amber.route.test` | `amber route test` | system | —（只读） |
| `amber.context.ingest` | `amber context ingest` | human | ingest-record |
| `amber.memory.approve` | `amber memory approve` | human | approval-record |
| `amber.memory.abandon` | `amber memory abandon` | human | ingest-record |
| `amber.memory.status` | `amber memory status` | system | —（只读） |
| `amber.governance.report` | `amber governance report` | system | —（只读） |
| `amber.object.query` | 按 `objectType` 变体分发（见下） | system | —（只读查询） |

**M3 记忆动词边界注记（批次 A）**：`memory/approve` 是唯一人工批准闸门（条目级，恰一个 entryId，reject 必须非空 reason）；`memory/request`、`memory/ingest`、`memory/book` 为非类型化白名单表面（动词内联身份门 M12，非 TTY 无 `--yes` 拒绝），不经 MCP 工具暴露——Amber 从不写 MEMORY.md，人写入后经 `book` 追认登记（追认轨：`book --ratify --claim <text>` 直接创建 active 条目，无前置 request/ingest/approve，不耗 γ）。`memory/abandon` 复用 ingest-record 语义扩注：ingest-record 在 memory 域 = “记忆管道治理记录写入事件账本”，覆盖四类生命周期处置（提名创建 request / 准入 ingest / 账面登记 book / 放弃 abandon）；事件载荷 `{scope(request|entry), targetId, triggerSource(auto-threshold|explicit), requestId?, entryId?}`，abandoned 是账本终态标记，仅进 doctor 统计，消费面一律过滤。拒绝新造 book-record/abandon-record/request-record（零消费者、稀释词表）。

`amber.object.query`（P2，OAG 查询层）通过 `execution.variantParam` 按
`objectType` 分发到不同只读命令：

| objectType | 映射命令 | 说明 |
| --- | --- | --- |
| `session` | `amber session status [<id>] --json` | 会话状态 |
| `route` | `amber route list --json` | 路由清单 |
| `context` | `amber context load --route <id> [--feature <id>] [--page <id>]` | 任务级 Loadout 组装（上下文注入锚点） |
| `ledger` | `amber ledger export --home all --format json` | 证据账本 |
| `loop` | `amber loop recommend [--goal <g>] --json` | 学习回路推荐（基于证据的改进建议） |

**结构化返回**：查询命令输出 JSON 时，结果经 `structuredContent` 原样回传
（MCP 2025-03-26+ 客户端可用），tools/list 同时声明 `outputSchema`；
非 JSON 输出回退纯文本。

**多目标仓库（已配置仓库不变量）**：每个工具的 inputSchema 含保留参数
`_target`（可选），按调用覆盖服务器 `--target`。`--target` 与 `--targets`
在启动时一次性规范化为真实路径（`realpath`），缺失、重复、非目录条目一律
显式拒绝（fail-closed）。`_target` 相对路径先按服务器 cwd 解析、再规范化
为真实路径，**必须精确匹配某个已配置仓库**，否则 JSON-RPC `-32602` 拒绝。
即：`_target` 不能逃逸出启动时配置的仓库集合。迁移：先前依赖任意已存在
目录的客户端，请改用 `--targets <a,b,c>` 在启动时声明全部受治理仓库。
Function 的所有路径读取经真实路径感知的 containment 检查，拒绝 `..`、
绝对路径、symlink/Windows junction 越界。

白名单文件在 `action-types/*.json`，每个文件声明一个 Action Type（含 `execution`
映射：command/subcommand + 参数模板）。启动时全部经
`schemas/action.type.schema.json` 校验；任一 JSON、schema、execution mapping
或重复标识错误都会使整个 registry 拒绝启动，不发布部分工具面。Function
registry 采用相同的整体 fail-closed 语义。

映射规则（**契约一致性不变量**，F018）：命令能力注册表
（`scripts/lib/mcp-action-contracts.js` 的 `COMMAND_CAPABILITIES`）是
Action 注册的唯一比较面。Action 的 `governance.approver`、`evidenceRequired`、
`governance.evidence`、`effects.edits`、`effects.sideEffects`、`mode` 必须与
其映射命令的 effect/approver/evidence/
directReadOnlyExec 全部一致，且只读声明之后不得隐藏写能力参数（如
`governance report --output` 已从只读接口移除，报告经 content/
structuredContent 回传）。启动时对全部 Action Type 做一致性校验，任一不
匹配即 fail-closed 退出。`amber.session.verify` 的证据为 `timeline-event`
（命令实际写入 `stage_completed` 时间线事件 + ledger），而非 `verify-result`。

**执行语义（F018）**：适配器只直接 spawn 经注册表证明的只读命令变体
（read + directReadOnlyExec + 不绑定写标志）。变更/交互类 Action **从不
被适配器直接执行**——默认返回 `dryRun`，`--execute` 下返回
`approvalRequired`；未来若需 MCP 直接执行变更，须另立带 policy/approval/
isolation/ledger 四道门控的 governed runner 适配器（本次修复不引入）。
`autonomous` 模式因无受治理适配器而在注册时拒绝。

## 7. 安全与治理边界（F018 强制）

1. **白名单制**：只有已注册 Action Type 可执行；未知工具名一律以 MCP
   原生 JSON-RPC `-32602` 拒绝（不使用自定义 `accepted=false` 形状）。
2. **只读不变量**：一个操作仅在**完整参数化行为**经注册表证明为只读
   （read + directReadOnlyExec + 不绑定写标志）时才可免审批直接执行。
   任何写能力参数都不得藏在只读声明之后。
3. **受治理执行不变量**：适配器从不直接 spawn 变更类 Action；变更操作
   返回 `approvalRequired` 提交，绝不自动执行。
4. **fail-closed**：损坏的治理状态（如不可读的活跃会话 manifest）、
   未知的命令能力、命令的非零退出/超时/信号/spawn 失败、契约失败，一律
   作为 MCP 错误（`isError: true`）上抛，绝不退化为空/成功状态。合法的
   空查询（如 `session status` 无会话）返回 exit 0。并发守卫读取每个
   session manifest 时也逐路径执行 realpath containment，拒绝子目录 junction。
5. **已配置仓库不变量**：每个 Action 与 Function 只作用于启动时配置的
   仓库真实路径；`_target` 必须精确匹配已配置成员，Function 读取经真实
   路径感知 containment 防护。Function handler 提供的目标 base 也必须是
   已配置成员；每个实际读取路径都会再次检查 symlink/Windows junction，
   不允许回退读取 MCP 服务器源码目录。
6. **产品边界声明**：本协议仅用于 Amber 内部治理与外部 agent 的安全协作。
   外部系统不得绕过 Amber 直接操作仓库；Amber 不自动执行目标项目命令、
   不派发 live agent、不运行动态工作流（与 AGENTS.md 安全边界一致）。

## 8. 分阶段落地

- **P0（已完成）**：Action Type schema + 本文档 + 治理哲学定位文档。
  校验：`schemas/action.type.schema.json` 通过 ajv 编译，
  `tests/integration/action-type-schema.test.js` 覆盖。
- **P1（已实现，v0.2）**：`scripts/amber-mcp.js`（stdio MCP server）。
  读取 `action-types/` 白名单，暴露 `amber.*` 工具（tools/list / tools/call），
  映射到现有命令。默认 dry-run：不生成任何命令；`--execute` 仅允许
  只读/dry-run 类 Action 执行；含 human approver 或 interactive 模式的
  变更类操作一律返回 `approvalRequired`，绝不自动执行。
  运行方式：`node scripts/amber-mcp.js --target <repo>`（stdio、
  换行分隔 JSON-RPC 2.0；可与任何 MCP 客户端对接）。
- **P2（已实现，v0.3）**：OAG 查询层——`amber.object.query` 工具（只读，
  默认模式即可执行），按 `objectType` 变体分发到 session/route/context/ledger
  只读命令。`context` 变体复用 Context Loadout（`amber context load`），
  为 agent 提供任务级语义锚定。闭合回路成形：
  query（object.query）→ decide（工具选择）→ act（受治理 Action，
  变更类仍人工审批）→ verify（session 状态/证据查询）→ learn
  （timeline/ledger 证据累积 + governance report 就绪度信号）。
  安全细化：只读查询豁免 dry-run 默认（零 edits 声明 + dry-run 模式），
  但变更类 Action 的审批门禁不变。
- **后续项（已实现，v0.4）**：
  - 学习回路深集成：`amber.object.query` 新增 `loop` 变体（`loop recommend`），
    agent 基于累积证据（timeline/ledger）取改进建议，闭合
    query → decide → act → verify → **learn** 回路。
  - 结构化返回：JSON 输出解析进 `structuredContent` + `outputSchema` 声明。
  - 多目标仓库：保留参数 `_target` 按调用覆盖仓库目标。
- **Functions（已实现，v0.5）**：`action-functions/*.js` 注册 `amber.fn.*`
  工具（in-process、只读）。上下文 ctx 提供 `target`、`targets`（跨仓库）、
  `resolvePath`（越界防护），无 shell、无执行——确定性辅助（如
  `amber.fn.sessionEvidence`、`amber.fn.repoOverview`），与 Action 白名单
  并列暴露。
- **并发治理（已实现，v0.5）**：每仓库单活跃会话。变更类 Action 在目标
  已有活跃会话（created/routed/executing/paused）且非自身引用的会话时
  拒绝，返回 `conflict: { activeSessions }`；引用活跃会话的操作（verify/
  approve）豁免。保留参数 `_agent` 记录归属。
- **跨仓库统一视图（已实现，v0.5）**：服务器 `--targets <a,b,c>` 配置多
  仓库；`amber.fn.repoOverview` 一次调用聚合所有仓库的会话/活跃态/路由
  清单。
- **所有权写回（已实现，v0.6）**：`amber session start --agent <id>` 将
  `agentId` + `agentClaimedAt` 写入 manifest（schema 可选字段，向后兼容）；
  MCP `session.start` 通过保留参数 `_agent` 渲染 `--agent`；
  `amber.fn.sessionEvidence` 摘要暴露所有权；busy-guard 的
  `conflict.owners` 标出活跃会话归属。
- **函数 schema 校验（已实现，v0.6）**：加载时 ajv 编译每个
  `amber.fn.*` 的 inputSchema；任一 Function 无法加载、缺少 handler/name/
  schema、schema 非法或名称重复时，整个 registry fail-closed 拒绝启动。
  调用时继续执行参数校验
  （`additionalProperties: false` 拒绝未知参数）。
- **跨仓库视图缓存（已实现，v0.6）**：函数结果 TTL 缓存（默认 5s，
  `--cache-ttl-ms <n>` 调整，`--no-cache` 关闭），outcome 带
  `cached` 标记；键 = 函数 + 仓库集 + 输入。
- **F018 治理与仓库隔离修复（已实现，v0.7）**：抽出深度模块
  `scripts/lib/mcp-targets.js`（已配置仓库规范化、`_target` 精确匹配、
  真实路径感知 containment）、`scripts/lib/mcp-action-contracts.js`
  （命令能力注册表为注册唯一比较面 + 契约一致性校验）。删除泛化
  `mayExecute`；只读直接执行仅限注册表证明的只读变体，变更类从不 spawn。
  fail-closed：损坏 manifest / 非零退出 / 超时 / 信号 / 契约失败均为
  `isError: true`；合法空查询 exit 0。`session.verify` 证据订正为
  `timeline-event`；只读 `governance report` 移除 `--output`。未知工具采用
  MCP 原生 JSON-RPC 错误形状。`scripts/lib/mcp-registry-loader.js` 保证 Action
  与 Function registry 任一坏条目都会整体拒绝启动。
- **后续（未实现）**：MCP 资源订阅推送（resources/subscribe）、
  多 agent 会话所有权转移（claim/release）、跨进程缓存（Redis/文件）、
  四道门控 governed runner 适配器（若需 MCP 直接执行变更类操作）。

## 9. 与本文档相关的既有约束

- Amber 安全边界见 `AGENTS.md`（read-only-first、不覆盖用户文件、
  `executesAnything: false`）。
- 新 Action Type 的 schema 变更遵循仓库规则：更新
  `schemas/*.schema.json`，并保持测试绿（见 CLAUDE.md「Modifying schemas」）。
