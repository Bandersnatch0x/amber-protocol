# 03 首页 IA 瘦身与失败态友好化

## Objective

重构 Operator Console 首页（任务 #18），从 6 区块瘦身为 5 区块 + 折叠参考区，并把三处原始 JS 错误串直出替换为友好失败态：

1. **失败态友好化**（Critical）：新增 `QueryFailure` 组件（本地化标题 + 说明 + 重试 `refetch()`），应用于活跃会话卡、待审 gate 卡、下一动作卡；不再渲染 `error.message`。
2. **加载骨架**：`ListSkeleton`（animate-pulse，尺寸匹配最终列表项与 StatusBadge pill）替换所有 "loading..." 纯文字。
3. **IA 瘦身**：AmberField WebGL 面板改为默认折叠 `<details>` 且 `onToggle` 惰性挂载（折叠时零 WebGL 初始化）；lifecycle 讲解与 artifacts 下沉为底部折叠区；移除首屏整张 amber-loop-card。
4. **动线修正**：待审 gate 行动链接由 `/sessions/$id` 改为 `/gates`。
5. **文案本地化**：lifecycle STEPS 13 个 id 建 `home.step.<id>.title/.reason` 中英映射，未知 id 降级 mono 原文。

## Blocking edges

- blocked by：任务 #14 实测问题清单（首页失败态/IA 条目）、任务 #16 双轨审查报告（数据优先 AC）。
- blocks（回溯）：票据 05 的「打开治理概览」链接落位首页折叠区头部；票据 10 重排覆盖本票改动文件。

## Status: DONE

## TDD evidence

- e2e：`apps/web/tests/e2e/home-visual.spec.ts` — 5 例（桌面五块布局 + `.amber-field` 默认不挂载断言；移动端无横向溢出；深色 graphite 调色板；WebGL2 缺失→CSS fallback；reduced-motion 时序坍缩）
- e2e：`apps/web/tests/e2e/completion-handoff.spec.ts` — 其中 1 例断言首页→governance 链接常驻（共 5 例，其余属票据 04/05）
- 单测侧由 i18n parity 测试守卫新增 45 键：`apps/web/tests/client/i18n-keys.test.ts`（键集相等 + 无空值）

## Browser evidence

- `.scratch/01-home-zh.png`、`.scratch/02-home-fixed-zh.png`（缺陷现场与首轮修复）
- `.scratch/recheck-01-home-zh.png`、`.scratch/recheck-02-home-skeleton.png`、`.scratch/recheck-10-home-en.png`（任务 #22-B 复检：IA/骨架/失败态）
- `.scratch/ux-25-01-home-zh.png`、`.scratch/ux-25-02-home-references-expanded.png`、`.scratch/ux-25-14-home-en.png`（任务 #25 首次使用者走查）

## Verification

- 任务 #18 执行时：vitest 58 文件 / 470 例全绿（含 i18n parity）；`tsc --noEmit` 通过；`home-visual.spec.ts` 5/5、`completion-handoff.spec.ts` 5/5。
- 会话收敛口径（任务 #36/#37 复验）：vitest 65 文件 / 555 例；根测 2003 例 0 fail；Playwright 40/40；tsc 0 错误。

## Notes

- 决策：`AmberField.tsx`/`experience.css` 零改动（最小 diff），收纳完全在路由层用 `<details>` + 惰性挂载完成。
- `home-visual.spec.ts` 由 leader 授权本票独占更新：移除 amber-field 首屏可见断言，新增五块布局与默认不挂载断言。
- i18n 编辑期间检测到文件被并行修改（1241→1451 行），重读锚点确认 home 段无漂移后一次替换成功。
