# 02 gates 页缺陷修复：feedback 双通道 / reviewer 收纳 / 筛选 URL 化 / 审计计数口径

## Objective

修复 gates 审阅页四项缺陷（任务 #17）：

1. **feedback 条残留**：校验失败分支同时写 inline 错误与顶部 `actionFeedback`，导致校验错误长期滞留 aria-live 区。修复为双通道生命周期：顶部 banner 只承载已发起 mutation 的结果；inline 错误绑定字段、编辑即清除、永不写 banner。
2. **reviewer 输入框收纳**：从卡片行移入展开的 Review 面板（仅 pending 显示）；提交时校验失败自动展开面板（`flagReviewerError`）保证错误可见。
3. **筛选状态 URL 化**：新增 `validateSearch`（`?status=pending|approved|rejected`，非法值降级"全部"），解析函数 `parseStatusFilter` 落 `gate-feedback.ts` 便于单测；与 `from=gates` 深链兼容。
4. **审计计数口径矛盾**：根因为服务端计数是会话文件总量、最新条目是 gate 级过滤。UI 侧改为「Session ledger records / Session timeline events」标签 + `gates.audit.detail` 口径说明。

附带：gate 类型 / stage / resolvedBy 三张后端枚举→i18n 映射表（未知串降级原文）。

## Blocking edges

- blocked by：任务 #14 实测问题清单（gates 页条目）、任务 #16 双轨审查报告。
- blocks（回溯）：票据 04 的决策后引导复用 `gate-feedback.ts`；票据 07 在 gates 证据区追加互链。
- 并行冲突记录：任务 #20 执行期间 gates.spec 2 例失败系本票在途 WIP 所致，本票完成后恢复全绿（任务 #21/#22 复验）。

## Status: DONE

## TDD evidence

- `apps/web/src/features/gates/gate-feedback.test.ts` — 14 例（feedback 构建 4：审计警告降级/无 resume 警告/拒绝警告/收尾引导；`parseStatusFilter` 10：合法状态 3 + 非法值降级 7）
- e2e：`apps/web/tests/e2e/gates.spec.ts` — 8 例（列表/计数/筛选 URL 化与返回恢复/证据轨迹口径标签/inline 校验不污染 banner/审批后 completion 引导+reviewer 回显/拒绝后 rework 引导；消费型 seed 隔离，基线会话不被触碰）

## Browser evidence

- `.scratch/05-gates-reviewer-validation-zh.png`、`.scratch/06-gates-review-panel-zh.png`（缺陷现场）
- `.scratch/recheck-05-gates-list-zh.png`、`.scratch/recheck-06-gates-review-panel.png`、`.scratch/recheck-11-gates-en.png`（任务 #22-C 复检）
- `.scratch/ux29-06-gates-review-panel-zh.png`（#26/#27 轮回归确认）

## Verification

- 任务 #17 执行时：`gate-feedback.test.ts` 与 gate-router/gate-reader 合计 52 passed；`tsc --noEmit` 干净；`gates.spec.ts` 8/8 全绿。
- 会话收敛口径（任务 #36/#37 复验）：vitest 65 文件 / 555 例；根测 2003 例 0 fail；Playwright 40/40；tsc 0 错误。

## Notes

- 决策：校验错误"只走 inline"优于"清 banner"，语义上校验尚未进入 mutation 生命周期。
- 审计计数未改服务端口径（server 与 `AuditEvidenceCard` 不在触碰范围），以标签+说明消除矛盾表述；如未来改为 gate 级计数需同步 e2e 断言。
- reviewer 身份随决策写入审计链（`resolvedBy`），留空记为 `web:anonymous`（ADR-0007 amendment (c) 缓解项，见 BACKLOG）。
