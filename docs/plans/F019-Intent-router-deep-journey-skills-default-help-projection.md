# Plan: Intent router + deep journey skills + default-help projection

Feature: F019
Status: passing
User Confirmation: confirmed

> 本文件既是 F019 实施计划,也是给接手 agent 的**交接文档**(self-contained)。
> 前置 F018 已完成并提交;本特性在 F018 的 typed seam 之上做命令面收敛,**不引入任何执行能力**。

## Goal

把当前 ~35 个并列 CLI / 11 个浅层 skill 收敛为「一个意图路由 → 少数深度 journey skill」的发现路径,并让默认 help 只投影 journey 与核心治理原语。确定性治理原语保留为 implementation,journey 穿过 F018 的 typed seam,绝不绕过。

## 起点状态(交接)

- 分支:`feature/f018-mcp-governance-seam`(从 `master` 切出)。工作树干净。
- 提交:`ec1f65d` feat(mcp): F018 governed typed seam;`2d01ed4` docs(f019): 本计划 scaffold。
- F018 已 `passing`(两条 verify 证据已记入 `feature_list.json`)。
- 基线快照评审:`architecture-review-final-20260812-005749.html`(`HEAD eeef260 · ontology v0.6`)。其「先修条件(红色阻塞区)」4 项已由 F018 全部解决;本特性对应其三条**后续建议**(评审自身用「待安全不变量修复后」排序)。

## F018 基础:F019 必须穿过、不得破坏的 typed seam

F018 把治理不变量沉到两个深度模块,`scripts/amber-mcp.js` 退化为纯适配器。F019 的 journey/CLI 收敛**必须复用同一条 seam**,不得在 journey 或 CLI 里另开一条绕过门控的执行路径:

- `scripts/lib/mcp-targets.js` — 已配置仓库规范化、`_target` 精确匹配、真实路径感知 containment(`..`/绝对/symlink/Windows junction 越界 fail-closed)。
- `scripts/lib/mcp-action-contracts.js` — `COMMAND_CAPABILITIES` 注册表(Action 注册唯一比较面)、`isReadOnlyExecutable`/`selectedVariantIsReadOnlyExec` 分类、`validateWhitelist` 启动校验。
- `scripts/lib/mcp-registry-loader.js` — fail-closed 的 action/function 加载器(非法/重复条目即拒)。
- 不变量(任一被破坏即 F018 回归):已配置仓库 / 只读 / 受治理执行(变更类从不 spawn,只 `approvalRequired`)/ 契约一致性 / fail-closed / 协议真值。

**硬约束**:F019 不新增执行能力——不引入四门 governed runner、不派发 live agent、不自动执行目标项目命令、不覆盖用户文件。这是 UI/命令面收敛,不是执行域扩张。

## 评审建议(F019 的范围来源)

来自 `architecture-review-final-20260812-005749.html`,按其自身排序为「安全不变量修复后」:

1. **意图路由 + 渐进披露**(Strong)— 参考 `ask-matt` skill:一个 user-invoked router 路由到少数可组合 journey skill。选择知识集中(locality)、一份 skill 多平台(leverage)、意图→结果可测(tests)。
2. **深化 Journey modules**(Strong)— 现有 skill 多为步骤清单,跨 session/route/context/evidence 的阶段判断、证据顺序、失败恢复知识分散;按用户旅程集中,治理原语留 implementation。
3. **Typed governance seam + public projections**(Worth exploring)— Action Types 承载 typed invariants,MCP/CLI 做 adapter;默认 help 只投影 journey + 核心原语。

评审明确的边界(必须遵守):
- **ADR-0014**:`amber next --objective` 是**确定性只读**路由顾问(route manifest 关键词匹配,**非 LLM**)。router 可包装它,但**不得用 LLM 替代 route matching**。见 `docs/adr/0014-routing-advisor.md`。
- **ADR-0001/0003/0005**:journey 必须继续穿过 approval / isolation / ledger 门。
- 保留(deterministic implementation):`gate`/`verify`/`approve`/`ledger`/`session`/`route`/`context`。
- 隐藏(deprecated):`profile`/`task`/`result`/`agent`/`team`/`adoption`,以及迁移/维护/专家诊断原语。

## 命令面盘点(35 命令分类建议)

`COMMANDS` 与 `COMMAND_DEFINITIONS` 在 `scripts/lib/command-help.js`;`bindCommandHandlers` 强制 handler 与定义一一对应(加命令须同步两处)。`scripts/lib/command-dispatcher.js` 的 `DEPRECATED_COMMANDS = {profile, task, result, agent, team, adoption}` 已存在。

建议的可见性分层(供 Slice 1 落地为单一注册表字段,如 `tier: core|journey|deprecated|expert`):

- **Journey 入口(默认可见)**:`next`(确定性路由顾问,ADR-0014)+ 未来 router/journey skill。
- **核心治理原语(默认可见)**:`init, audit, wiki, doctor, session, route, context, governance, ledger, gate, plan, review, accept, loop, handoff, feature`。
- **Deprecated(默认隐藏,`--all` 可见)**:`profile, task, result, agent, team, adoption`。
- **专家/维护(默认隐藏,`--all` 可见)**:`pack, status, drift, sync, migrate, maintenance, execution, security, clean, explain, hooks, workflow`。

> 注:具体归层是设计决策(Slice 1 产出),上表是出发点,接手 agent 可调整但须有测试固化。

## High Level Design

- Context:
  - F018 已把不变量沉到 seam;MCP 已是 adapter。CLI 仍走自己的 `command-dispatcher`,尚未统一穿入 seam。
  - 11 个 amber skill 多为 1:1 绑命令的浅层菜单(例:`skills/amber-session/SKILL.md` 列 5 条命令)。`gen-agent-commands.js` 从 skill 生成多平台命令文件(`npm run gen:agents`,CI 用 `gen:agents:check` 守护漂移)。
  - 默认 help(`scripts/amber.js` 的 `usage()`、`command-help.js`)把 35 命令并列展示,兼容/专家原语与用户 interface 同等曝光。
- Proposed approach:
  - 引入**命令可见性注册表**(单一真相),`COMMAND_DEFINITIONS` 增 `tier`;默认 `amber` help 与生成命令只投影 `journey+core`。
  - 建一个 **router skill**(ask-matt 风格):意图 → journey;目标→route 的子决策**委托 `amber next --objective`**(确定性,ADR-0014)。
  - 把 11 个浅 skill **重组为少数深度 journey skill**(建议 4 个:Governed delivery / Diagnosis & adoption / Context / Continuous improvement),每个拥有跨原语的顺序、证据顺序与失败恢复,调用确定性 implementation。
  - **CLI 穿入 typed seam**:对已有 Action Type 映射的命令族(session/route/context/governance/ledger/loop),让 CLI 执行路径复用 seam 的分类/校验,使 CLI 与 MCP 共享不变量;无映射的命令保留现 dispatcher。
- Risks:
  - Help 投影是面向人的兼容变更:脚本若依赖完整命令列表,需保留 `--all`/`amber help <cmd>` 全量入口。
  - Journey 重组会改变 skill 命名/路径,影响 `gen:agents` 产物与外部 `/loop`、`$skill` 引用——须同步再生并更新文档。
  - CLI 穿入 seam 若过度扩张,易把非治理命令强行类型化;**建议只覆盖有 Action Type 等价物的族**,其余不动。
  - 不得借机引入 LLM 路由或执行能力(违反 ADR-0014 与产品边界)。

## Vertical Slices

- [x] Slice 1: 命令面审计 + 可见性注册表(单一真相)。
  - 给 35 命令分类(`core|journey|deprecated|expert`),落为 `COMMAND_DEFINITIONS` 的 `tier` 字段(或独立注册表),`bindCommandHandlers` 校验全覆盖。
  - 用测试固化分类(含 `DEPRECATED_COMMANDS` 一致性)。
- [x] Slice 2: 默认 help 分层投影(向后兼容)。
  - 默认 `amber`(无参/`--help`)只列 `journey+core`;`--all` 列全部;`amber help <cmd>` 仍给单命令全量。
  - 更新 `scripts/amber.js usage()` 与 `command-help.js`;测试覆盖三种入口。
- [x] Slice 3: 意图 router skill(ask-matt 风格,确定性优先)。
  - 一个 user-invoked router skill:意图 → journey;目标→route 子决策委托 `amber next --objective`(ADR-0014,禁止 LLM 路由)。
  - 测试验证「意图→journey」映射与 `next --objective` 透传。
- [x] Slice 4: 深度 journey skill(把 11 个浅 skill 重组为 ~4 个)。
  - 每个 journey 拥有跨 session/route/context/evidence 的顺序、证据顺序、失败恢复;确定性原语留 implementation。
  - 经 `gen:agents` 再生多平台产物;更新外部引用(`/loop`、`$skill`、`.claude/.gemini/.agents`)。
- [x] Slice 5: CLI 穿入 typed seam(有 Action 等价物的命令族)。
  - 对 session/route/context/governance/ledger/loop 族,CLI 执行路径复用 F018 seam 的分类/校验(只读 vs 变更、fail-closed);无映射命令保留现 dispatcher。
  - **不破坏 F018 任何不变量**:新增 seam 共享测试(只读直接执行、变更 approvalRequired、fail-closed)。
- [x] Slice 6: 文档对齐与产物再生。
  - 更新 `docs/wiki/`、`AGENTS.md`/`CLAUDE.md`、`CLI_REFERENCE.md`(若存在)、ontology 文档的命令面章节;`npm run gen:agents`。
  - 复跑 `validate-wiki` 与 `gen:agents:check`。
- [x] Slice 7: 评审收尾。
  - 对最终补丁跑 `amber review`(两轴)与 `amber gate`,要求 0 findings;记录证据后将 F019 置 `passing`。

## 待决设计问题(接手 agent 决策点)

1. **Router 落点**:纯 skill,还是同时在 CLI `amber`(无参)做交互式 router?(建议:skill 为主,CLI help 投影为辅。)
2. **Journey 数量与边界**:4 个?命令→journey 的精确映射表由 Slice 1/4 产出。
3. **Help 投影机制**:`COMMAND_DEFINITIONS` 增 `tier`,还是独立 visibility 注册表?(建议:复用 `COMMAND_DEFINITIONS`,减少真相源。)
4. **CLI seam 收敛范围**:全量 vs 务实(仅 Action Type 等价族)。(建议:务实,避免把非治理命令强行类型化。)
5. **Deprecated 命令**:仅隐藏,还是顺带移除?(建议:仅隐藏;移除另立 feature。)

## Acceptance Criteria

- 默认 `amber` help 只投影 journey + 核心治理原语;deprecated 与专家/维护原语经 `--all` 或 `amber help <cmd>` 可见;向后兼容(全量入口不丢)。
- 存在一个 user-invoked 意图 router,能从用户意图路由到 journey;目标→route 子决策由 `amber next --objective`(确定性)承担,无 LLM 路由(ADR-0014)。
- 命令面有单一可见性真相源,且与 `DEPRECATED_COMMANDS` 一致;分类由测试固化。
- 浅层 skill 重组为少数深度 journey,每个 journey 拥有跨原语的顺序、证据顺序与失败恢复;确定性原语保留为 implementation。
- 对有 Action Type 等价物的命令族,CLI 执行路径复用 F018 typed seam 的分类/校验;CLI 与 MCP 共享不变量。
- F018 的六条不变量无回归(已配置仓库 / 只读 / 受治理执行 / 契约一致性 / fail-closed / 协议真值),既有 1710 测试与 F018 负面路径测试全绿。
- journey/CLI 均穿过(而非绕过)ADR-0001/0003/0005 的 approval/isolation/ledger 门。
- **Phase boundary guardrails**:本特性只做命令面/UI 收敛,不扩张执行域——不引入四门 governed runner、不派发 live agent、不自动执行目标项目命令、不覆盖用户文件;deprecated 命令仅隐藏不移除。

## Verification

- `node --test tests/unit/mcp-targets.test.js tests/unit/mcp-action-contracts.test.js tests/unit/mcp-registry-loader.test.js`(F018 seam 无回归)
- 针对新代码的单元/集成测试(命令分类、help 投影三入口、router 映射、journey 成功/失败路径)
- `npm test`
- `npm run manifests` / `npm run doctor` / `npm run gen:agents:check` / `node scripts/validate-wiki.js --target .`
- `node scripts/amber.js review --target . --plan docs/plans/F019-...md --json`(两轴,0 findings)
- `node scripts/amber.js gate --target . --plan docs/plans/F019-...md`
- 提交前:`npm run lint` 与 `npm run format:check`(pre-commit 钩子强制)

## 关键文件地图

- 命令面:`scripts/amber.js`(`usage`)、`scripts/lib/command-help.js`(`COMMANDS`/`COMMAND_DEFINITIONS`/`commandSummary`)、`scripts/lib/command-dispatcher.js`(`DEPRECATED_COMMANDS`、`dispatch`)。
- F018 seam(复用):`scripts/lib/mcp-targets.js`、`scripts/lib/mcp-action-contracts.js`、`scripts/lib/mcp-registry-loader.js`、`scripts/amber-mcp.js`、`action-types/`、`action-functions/`、`schemas/action.type.schema.json`。
- skills:`skills/<name>/SKILL.md`(单一真相);`scripts/gen-agent-commands.js` 再生 `.claude/`、`.gemini/`、`.agents/skills/`。
- ADR:`docs/adr/0014-routing-advisor.md`(`amber next --objective` 确定性)、`0001`/`0003`/`0005`(门控)。
- 评审基线:`architecture-review-final-20260812-005749.html`。

## Resume Checkpoint

- Resume Point: F019 已完成实现、验证与三轴复审；计划和 feature evidence 已落盘。
- Blockers: 无。`amber review` findings 为空，`amber gate` errors 为 0。
- Next Action: 后续改动从新的 feature/plan 开始，不在本计划追加未审范围。
- Recovery Instructions: 若会话中断，先运行 `npm test`、`npm run doctor`、`npm run gen:agents:check` 与本计划 review/gate，确认仍为绿色后再继续新的工作。

## Evidence Schema

- Command: `node --test` expanded F019 targeted suite
- Result: 184 passed, 0 failed, 0 skipped
- Date: 2026-08-13
- Notes: Covers registry/tier/help projection, router and journey contracts, typed CLI seam, session/governance fixtures, MCP integration, E2E and regression paths.
- Artifact or session id: F019 targeted verification
- Remaining risk: No known High/Medium findings; generated mirrors remain guarded by `gen:agents:check`.

- Command: `npm test`
- Result: 1737 total, 1733 passed, 4 skipped, 0 failed
- Date: 2026-08-13
- Notes: Full repository test suite after explicit confirmation was added to typed-write fixtures.
- Artifact or session id: full test run
- Remaining risk: Four pre-existing skipped tests remain skipped by suite policy.

- Command: `npm run manifests`; `npm run doctor`; `npm run gen:agents:check`; `node scripts/validate-wiki.js --target .`; `npm run lint`; `npm run format:check`
- Result: all exit 0; manifest/doctor/wiki errors 0; 15 generated agent files current; lint clean; Prettier clean
- Date: 2026-08-13
- Notes: Repository health and generated-platform projections validated after documentation and demo updates.
- Artifact or session id: F019 quality gates
- Remaining risk: None observed.

- Command: `amber review --target . --plan docs/plans/F019-Intent-router-deep-journey-skills-default-help-projection.md --json`; `amber gate --target . --plan docs/plans/F019-Intent-router-deep-journey-skills-default-help-projection.md`
- Result: review findings 0, releaseReadiness ready, gate errors 0
- Date: 2026-08-13
- Notes: Plan scope, confirmation, evidence, and phase-boundary checks passed.
- Artifact or session id: F019 review/gate
- Remaining risk: None known.
