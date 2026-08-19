# Web 收尾证据索引（web-closure-evidence INDEX）

> 回溯票据（retroactive tracer-bullet tickets）总索引。收敛提交：`3b392b73`
> （feat(web): complete governance closure, transcript timeline & format gate）。
> 票据正文见 `issues/01-*.md` … `issues/10-*.md`，以磁盘版本为准。

## 任务板 ↔ 票据 ↔ 测试 ↔ 截图 映射表

| 票据 | 主题 | 任务 | TDD 测试（用例数） | 浏览器截图证据 |
| --- | --- | --- | --- | --- |
| 01 | 端口竞态根治：dev-bootstrap 单次预解析 | #14（输入）→ #15 | `tests/server/api-port.test.ts`(17) / `tests/server/vite-config.test.ts`(2) / e2e `health.spec.ts`(2) | `13-drift-evidence-api-4101-health.png`、`14-drift-evidence-4102-refused.png`、`recheck-01-home-zh.png` |
| 02 | gates 缺陷：feedback 双通道 / reviewer 收纳 / 筛选 URL 化 / 审计口径 | #17 | `features/gates/gate-feedback.test.ts`(14) / e2e `gates.spec.ts`(8) | `05/06-gates-*-zh.png`、`recheck-05/06/11-gates-*.png`、`ux29-06-gates-review-panel-zh.png` |
| 03 | 首页 IA 瘦身与失败态友好化 | #18 | e2e `home-visual.spec.ts`(5) / e2e `completion-handoff.spec.ts`(1/5) / i18n-keys parity(45 键) | `01/02-home-*.png`、`recheck-01/02/10-home-*.png`、`ux-25-01/02/14-home-*.png` |
| 04 | 会话详情工作台：审批误判 / 清单字段 / 主次分层 | #19 | `SessionCompletionWorkbench.test.ts`(17) / `.render.test.tsx`(3) / `HandoffCard.test.ts`(4) / e2e `completion-handoff.spec.ts`(3/5) | `08/09-session-*.png`、`recheck-03/04/07-*.png`、`ux-25-03/11/12/13-*.png`、`ux29-05-*.png` |
| 05 | governance 认知修复：导航 / 骨架 / 标签 / learnings / 分数口径 | #20 | `tests/server/continuity-router.test.ts`(11，其中 2 例) / e2e `governance-nav.spec.ts`(3) / e2e `completion-handoff.spec.ts`(2/5) | `03/12-governance-*.png`、`recheck-08/09-governance-*.png`、`ux-25-09-*.png`、`ux29-07-*.png` |
| 06 | transcript 时间轴重构：降噪 R1–R9 / 左轴连接线 / Markdown 启发式 / tool-only 徽章 / 骨架屏 | #26/#30/#32 | `features/transcripts/transcript-denoise.test.ts`(29) / `tests/client/MarkdownMessage.test.tsx`(5) / `tests/client/TranscriptBadge.test.tsx`(3) / e2e `transcript-timeline.spec.ts`(3) | `ux31-01-*.png` ×2、`ux31-02*.png` ×3、`ux31-03-*.png`、`ux31-04-*.png` ×4、`ux31-05-*.png` |
| 07 | 认知设计：页面互链 / 后端文案本地化 / 分数口径副标题 / 术语内联解释 | #27 | `features/backend-copy/backend-copy.test.ts`(14) / e2e `governance-nav.spec.ts` + `completion-handoff.spec.ts`（互链与口径） | `ux29-07-governance-zh.png` |
| 08 | away_summary subtype 加固：两级判断 + 尾缀兜底钉死 | #33 | denoise 套件内 `away_summary` 相关用例 3 处（精确优先 / 尾缀兜底 / 降级 plain） | —（纯逻辑加固，复用 ux31 管线截图） |
| 09 | 转录-会话推断关联：路径归一 + 闭区间相交 + 前端三态 + 诚实标注 | #34 | `tests/transcript-session-match.test.ts`(15) / e2e `transcript-session-link.spec.ts`(2) | `ux36-01-*.png` … `ux36-05-*.png` |
| 10 | apps/web 格式门禁与 113 文件零行为重排 | #35/#37 | `npm run format:check`（根聚合：根 prettier 段 + apps/web 子门禁） | —（门禁输出为证） |

> 06-10 各票正文末尾均标注 `Commit: 3b392b73` / `Status: DONE (retroactive evidence)`。

## 收尾评审结论（三轴）

### Standards：0 Critical / 1 Major / 0 minor

- **Major（已修复）**：`apps/web/server/services/evidence-jobs.ts` 曾深缝直引
  `loop-policy` / `loop-ledger`，绕过 web-adapter 窄面。已在 commit `3b392b73`
  之前通过 web-adapter 窄面折叠修复（folds 收口，`tests/unit/web-adapter-folds.test.js`
  守卫）。修复后验证口径全绿：apps/web vitest 555 例 / 根测 2003 例（1999 pass / 0 fail / 4 skip）。

### Spec：7 PASS / 0 FAIL（唯一 DEVIATION 经核实为误报）

- 评审阶段报出的 DEVIATION 系评审读取了**根 `.prettierrc.json`** 所致；
  apps/web 实际生效的是 `apps/web/.prettierrc.json`：`singleQuote: true` /
  `endOfLine: "auto"`（量化取证见票据 10 Notes）。
- `src/routeTree.gen.ts`（TanStack Router 生成产物）已列入
  `apps/web/.prettierignore` 第 17 行，生成物不参与格式门禁。

### Impact：0 / 0 / 0 安全

- 重排为纯格式（113 文件零行为改动）；
- i18n 中英双字典锁步（i18n-keys parity 守卫）；
- 契约仅加法式（无破坏性变更）；
- dev-bootstrap 向后兼容（显式 env 保持最高优先级逃生门）。

### 遗留动作

- **GitHub Issue #130**（seam guard test，needs-triage）：为 web-adapter 窄面折叠
  补一条回归守卫测试，防止深缝直引复发。

## GitHub Issues 清单（#130–#140）

| Issue | 标题 | 对应票据 |
| --- | --- | --- |
| #130 | seam guard test（needs-triage） | —（收尾遗留动作） |
| #131 | 端口竞态根治：dev-bootstrap 单次预解析 | 01 |
| #132 | gates 页缺陷修复：feedback 双通道 / reviewer 收纳 / 筛选 URL 化 / 审计口径 | 02 |
| #133 | 首页 IA 瘦身与失败态友好化 | 03 |
| #134 | 会话详情工作台：审批误判 / 清单字段 / 主次分层 | 04 |
| #135 | governance 认知修复：导航 / 骨架 / 标签 / learnings / 分数口径 | 05 |
| #136 | transcript 时间轴重构：降噪 R1–R9 + 左轴连接线 + Markdown 启发式 | 06 |
| #137 | 认知设计修复：页面互链 / 后端文案本地化 / 分数口径副标题 | 07 |
| #138 | away_summary subtype 加固：两级判断 + 尾缀兜底钉死 | 08 |
| #139 | 转录-会话推断关联：路径归一 + 时间窗相交 + 诚实标注 | 09 |
| #140 | apps/web 格式门禁与一次性重排 | 10 |

## 会话收敛口径（任务 #36/#37 复验）

- apps/web vitest：65 文件 / 555 例全绿
- 根 `npm test`：2003 例（1999 pass / 0 fail / 4 skip）
- Playwright e2e：40/40
- `tsc --noEmit`：0 错误；`npm run format:check`：全绿
