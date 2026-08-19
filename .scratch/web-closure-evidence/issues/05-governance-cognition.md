# 05 governance 认知修复：导航 / 骨架 / 标签 / learnings / 分数口径

## Objective

修复 governance 概览页五类问题（任务 #20）：

1. **进主导航**：`__root.tsx` navItems 在 Gates 与 Settings 之间插入 `/governance`（`nav.governance`：Governance / 治理），桌面与移动端同时生效。
2. **页面状态完善**：加载态改三段 pulse 骨架卡（`aria-busy` + sr-only）；错误卡加内联「重试」+「返回首页」双出口。
3. **计数卡标签缺陷**：根因为后端 summary 键名（`featureEvidence` 等）直出到 `uppercase` CSS 类变成 "FEATUREEVIDENCE"。新增 `METRIC_LABEL_KEYS` 键名→i18n 映射，未知键走 camelCase 拆词降级。
4. **learnings 登记引导**：「未登记评审」状态旁新增 copy-only `CommandCopyBlock`（`amber learnings --reviewed --feature <id> --target .`，hint 明确"仅复制不执行"，ADR-0007 合规）。
5. **featureId 聚焦选择器 + 后端文案本地化 + ErrorBoundary**：候选来自现有只读 query 去重、URL search 参数驱动；`BACKEND_STRING_KEYS` 覆盖 ACTION_LIBRARY 15 组 why/expectedOutcome + 4 条 finding；ErrorBoundary 对齐 slate 令牌、原始 message 收入 `<details>`。

## Blocking edges

- blocked by：任务 #16 双轨审查报告；票据 01（dev 端口稳定才可做页面级 e2e）。
- blocks（回溯）：票据 07 的分数口径副标题与术语解释直接叠加在本页；票据 10 重排覆盖 governance.tsx。

## Status: DONE

## TDD evidence

- 服务端契约：`apps/web/tests/server/continuity-router.test.ts` — 11 例，其中 `governance.summary` 2 例（报告形状含 learnings 块；可选 featureId 不改判决形状）
- e2e：`apps/web/tests/e2e/governance-nav.spec.ts` — 3 例（桌面/移动导航入口路由；feature 选择器或空态；大写裸键名 FEATUREEVIDENCE/READINESSFINDINGS/STALEDOCS/MAINTENANCEERRORS 零出现断言）
- e2e：`apps/web/tests/e2e/completion-handoff.spec.ts` — 5 例中 2 例属本票（首页→governance 链接；on-demand 概览渲染无轮询控件）

## Browser evidence

- `.scratch/03-governance-zh.png`（缺陷现场）、`.scratch/12-governance-en.png`
- `.scratch/recheck-08-governance-zh.png`、`.scratch/recheck-09-governance-en.png`（任务 #22-E 复检：导航入口/中文下一步/骨架）
- `.scratch/ux-25-09-governance-zh.png`（任务 #25 走查：分数无口径说明的现场）
- `.scratch/ux29-07-governance-zh.png`（#27 轮：口径副标题 + 中文下一步 + learnings 落地确认）

## Verification

- 任务 #20 执行时：vitest 58 文件 / 470 例全绿；`tsc --noEmit` 通过；新 `governance-nav.spec.ts` 3/3；`completion-handoff.spec.ts` 5/5；routes/timeline/health 全过。
- 会话收敛口径（任务 #36/#37 复验）：vitest 65 文件 / 555 例；根测 2003 例 0 fail；Playwright 40/40；tsc 0 错误。

## Notes

- 决策：feature 选择器不新增后端端点（受约束不触碰 server），候选完全由现有只读 query 合成。
- 执行期间 gates.spec 2 例失败经 `git diff` 取证系票据 02 的在途 WIP，与本票无关（本票对 gates.tsx 增量仅错误卡一处）。
- learnings 命令中 feature id 取值链：`learnings.featureId` → URL featureId → `<feature-id>` 占位。
