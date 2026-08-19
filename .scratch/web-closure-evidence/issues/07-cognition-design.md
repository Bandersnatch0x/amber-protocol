# 07 认知设计修复：页面互链 / 后端动态文案本地化 / 分数口径副标题 / 术语内联解释

## Objective

对应任务 #27。补齐跨页认知连贯性，让用户在页面间自由穿梭且能读懂后端术语：

- **页面互链**：Home ↔ Sessions ↔ Gates ↔ Governance ↔ Transcripts 双向可达，关键页面互相提供上下文出口。
- **后端动态文案本地化**：`BACKEND_STRING_KEYS` 映射覆盖 ACTION_LIBRARY 的 why / expectedOutcome 与 finding 文案；未知键降级为原文等宽（monospace）显示，保证不丢信息。
- **分数口径副标题**：`SCORE_EXPLAIN_KEYS` 为 governance 计数卡补一句口径说明（避免"分数从哪来"的认知黑洞）。
- **术语内联解释**：`ux.terms.*` 为术语提供内联解释（hover/title 提示），降低首次阅读门槛。

## Blocking edges

- blocked by：票据 05（governance 页认知修复打底：导航 / 骨架 / 标签 / learnings / 分数口径基座）。
- blocks：—（认知收尾，无下游）。

## Status: DONE

## TDD evidence

从仓库取证（计数文件内 `test(` 或 `it(` 出现次数）：

- `apps/web/src/features/backend-copy/backend-copy.test.ts` — 14 例（BACKEND_STRING_KEYS 映射、未知键降级原文等宽）
- e2e：governance 相关 spec（`apps/web/tests/e2e/governance-nav.spec.ts`、`apps/web/tests/e2e/completion-handoff.spec.ts`）覆盖页面互链与分数口径副标题。

## Browser evidence

- `.scratch/ux29-07-governance-zh.png`（任务 #27 轮：口径副标题 + 中文下一步 + learnings 落地确认）

## Verification

- 会话收敛口径（任务 #36/#37 复验）：apps/web vitest 65 文件 / 555 例；根测 2003 例 0 fail；Playwright 40/40；`tsc --noEmit` 0 错误。

---
Commit: `3b392b73`
Status: DONE (retroactive evidence)
