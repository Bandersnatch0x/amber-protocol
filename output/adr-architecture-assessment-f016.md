# F016 架构修复评估（实现提交绑定）

- 评估日期：2026-08-07
- 远端基线：`origin/master@ef0ea4576291bad466dd89a7e2ee33a8d051e6b6`
- 评审前本地 HEAD：`ef57fc533ab4b342b1980f3752edc68b9825ac33`
- F016 补丁指纹：`c05b0d67aea3d0c174332d5e206ddc0370e7b731`
- 指纹覆盖：95 个路径
- 最终实现提交 SHA：`1b50dfb28ac05cab9f3a60d11c1e15ed676d29e6`

## 结论

F016 已提交并保持 `passing`。针对 `origin/master...1b50dfb28ac05cab9f3a60d11c1e15ed676d29e6` 的最终双轴复评结果为：blocker 0、high 0、P2 0、P3 0。

本评估通过远端基线、评审前 HEAD、补丁指纹和最终实现提交 SHA 绑定到已测试的确切内容。承载本报告最终化文本的 evidence 提交不作为实现提交，避免报告对自身提交 SHA 形成不可满足的自引用。

## 指纹方法与边界

补丁指纹使用临时 Git index 计算，不修改仓库真实 index：

1. 以 `origin/master` 初始化临时 index。
2. 将当前工作树完整加入临时 index，包括 F016 新增文件。
3. 恢复约定排除项到基线：`output/**`、`.workbuddy/**`、`docs/quality/release-readiness-1.3.12.md`、`session-handoff.md`。
4. 对 `git diff --cached --binary origin/master -- .` 执行 `git hash-object --stdin`。

`output/**` 被排除是为了避免报告自引用；其余排除项属于用户已有或 F016 明确不接管的工作树内容。历史报告 `output/adr-architecture-assessment.md` 未被覆盖或修改。

## 架构不变量

| 边界 | 最终不变量 | 评估结果 |
| --- | --- | --- |
| Context 路径 | 所有 source、Page、request、payload 与 Loadout I/O 同时受 lexical 与 real-path target confinement 约束 | 通过 |
| Context ingest | 每个 ingest 结局都绑定已存在 request；scope 只来自 request；`no-change` 不能绕过绑定或 source 完整性 | 通过 |
| Source 快照 | mutable source 必须由 request bundling 且请求后未变化；immutable source 的 `ref`、`excerpt`、`excerptHash` 必须一致 | 通过 |
| Loadout | `schemaVersion: 1.0.0`；三个 Required Artifacts 为 target-local、预算内且 fail closed 校验 | 通过 |
| Governed execution | ledger hash chain 首先验证；必须存在显式有效 policy；deny-wins policy 与 confidence gate 在 `spawnSync` 前执行；只有 high confidence 可进入真实执行 | 通过 |
| Handoff | layout 逻辑由 `core/handoff-layout.js` 持有；workflow assessment 仅经公共 facade 使用，无新增循环依赖 | 通过 |
| Migration | 默认 migrate 扫描 `.amber/`、`routes/` 与 `workflow-packs/`；只改写已识别 artifact，并保留 dry-run、备份与幂等语义 | 通过 |
| Agent orchestration | 多 worker dispatch 自动要求审批；low-confidence swarm 的有效并发降为 1 | 通过 |
| Routing | `next --objective` 从目标仓库解析状态，不再读取工具仓库状态 | 通过 |
| Workflow assessment | no-progress timeline 与 result evidence 只按 active Session 消费 | 通过 |
| Task evidence producer | `task prepare` 在任何写入前要求 target-local、合法、非终态 Session；显式缺值/空白/未知/冲突均 fail closed | 通过 |
| 结构质量 | 本轮新增或扩大的目标函数均低于 50 行；task、Session、plan 由同一 `boundCoordinates` 传递 | 通过 |

## 已修复评审发现

- Context lexical/realpath 越界与悬空外部 symlink 写入逃逸。
- ingest request 缺失/错配、scope 自授权和 `no-change` 绕过。
- immutable excerpt 自身 hash 绕过与 persisted source 绑定不完整。
- Loadout schema、Required Artifacts、预算和 fail-closed 校验缺口。
- `--since` 将纯 `request-created` 错算为新增或重哈希。
- confidence gating 丢失、handoff facade cycle、migration 未接线与 target-insensitive routing。
- governed execution 未验证 ledger chain、缺失显式 policy 或 high-confidence gate 时仍可能继续。
- swarm 未自动标记审批且 low-confidence dispatch 未降级；migration 根目录不完整并可能改写未知 JSON。
- CLI/README/CLAUDE 文档未覆盖新增迁移写入范围、objective 路由、Loadout 和核心架构，且 legacy 状态迁移遗漏 `state` 子命令；dispatch 函数混合策略、校验与持久化职责。
- no-progress 与 execution evidence 跨 Session 污染。
- `task prepare` 无 Session、伪 Session、终态 Session及显式空值时仍写入的 fail-open 行为。
- Context、governance、migration 与 task execution 中本轮引入或扩大的长函数、参数簇和重复持久化逻辑。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| Focused Session/producer/governance/structure tests | 23 passed, 0 failed |
| `npm test` | 1621 total, 1617 passed, 4 skipped, 0 failed；72.5 秒 |
| `npm run manifests` | Errors: 0 |
| `npm run doctor` | Errors: 0；Warnings: 0 |
| `npm run gen:agents:check` | 31 files current |
| `node scripts/validate-wiki.js --target .` | Errors: 0 |
| `npm run lint` | exit 0 |
| `git diff --check origin/master` | exit 0 |
| 最终 Specification 复评 | blocker/high/P2/P3 全部为 0 |
| 最终 Standards 复评 | blocker/P2/P3 全部为 0 |

## 与历史评估的关系

历史 `output/adr-architecture-assessment.md` 是 pre-`ef57fc5` 的调查输入，不是 F016 验收证据。其主要状态变化如下：

- ADR-0011 至 ADR-0014 已落盘，不再是“决策悬空”。
- ADR-0013 no-progress detection 与 ADR-0014 `next --objective` 已产品化，并在 F016 中补齐 Session/target 边界。
- ADR-0009/0010 的 Context 与 Loadout 不再只以功能存在为完成标准；F016 增加了 request ownership、真实路径限制、snapshot 完整性和 Required Artifacts 的 fail-closed 契约。
- 历史报告中的 ADR-0008 web 可视化、结构化干预台账和 doctor 检查注册表等非 F016 尾项未被本次评估重新声明为完成，也不构成本次补丁的验收阻塞项。

## 最终化状态

commit-SHA binding 已完成：实现与测试由 `1b50dfb28ac05cab9f3a60d11c1e15ed676d29e6` 承载。报告、计划与 feature 记录的 evidence 最终化不改变产品行为；当前未执行 push、版本升级、标签或发布。
