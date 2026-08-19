# 04 会话详情工作台：审批误判 / 清单字段 / 主次分层

## Objective

修复 SessionCompletionWorkbench 两个缺陷并做主次分层重构（任务 #19）：

1. **审批缺口误判**：根因核实——后端 `completion-check.js` 的 `reasons` 装的是已满足项肯定句（`"approval present"`），旧正则无差别匹配导致已完成会话必误报。`includesApprovalGap` 改为只认缺失语义（missing 含审批族关键词，或 reasons 含审批词+否定词且不含肯定短语），并导出为可测纯函数。
2. **生命周期清单恒为待处理**：后端输出 `{id, label, done}`，前端旧归一化只读 `complete/current/status`。`normalizeLifecycleChecklist` 改以 `done` 为规范字段，`complete/status` 保留为容错别名。
3. **主次分层**：主区默认可见（状态徽章/nextActions 引导/审批横幅/验证表单与进度/结果）；次级证据区（missing/reasons/lifecycle/报告原文）默认收起，`aria-expanded` 受控折叠。
4. **后端文案本地化**：`localizeBackendValue`/`localizeCompletionText` 覆盖 9 missing 枚举 + 7 reason 枚举 + 13 步骤 label；`"Completion check status: …"` 由结构化 summary 重新渲染，无结构化数据回退原文。

配套：HandoffCard 只读连续性卡片（copy-only CLI 补救命令，ADR-0007 合规）与异步验证状态机（denied 同步落定 / accepted job 四相位 `idle→submitting→running→settled`，SSE 为主 + 轮询兜底）。

## Blocking edges

- blocked by：任务 #16 双轨审查报告（workbench 条目）；票据 02 的 `gate-feedback.ts` 决策后引导模式。
- blocks（回溯）：票据 05 的 governance 链接与票据 07 的互链落在同一会话详情页；票据 09 升级本页「查看记录」区块。

## Status: DONE

## TDD evidence

- `apps/web/src/components/session/SessionCompletionWorkbench.test.ts` — 17 例（view model 6 含两条审批回归与 `{id,label,done}` 清单回归；backend copy 本地化 2；next-actions 映射 3；异步验证状态机 6）
- `apps/web/src/components/session/SessionCompletionWorkbench.render.test.tsx` — 3 例（happy-dom 分层渲染：默认收起 / 展开后本地化证据 / pass 态无审批横幅）
- `apps/web/src/components/session/HandoffCard.test.ts` — 4 例（live+deliveryReady / 未知负载降级 / scaffold 与未交付需 CLI 补救 / 命令优先级链）
- e2e：`apps/web/tests/e2e/completion-handoff.spec.ts` — 5 例中 3 例属本票（handoff 只读卡+CLI 补救、handoff 预览惰性加载、workbench next-action 行）

## Browser evidence

- `.scratch/08-session-detail-zh.png`、`.scratch/09-session-completed-workbench-zh.png`（缺陷现场）
- `.scratch/recheck-03-session-completed-top-zh.png`、`.scratch/recheck-04-session-completed-workbench.png`、`.scratch/recheck-07-session-completed-workbench.png`（任务 #22-D 复检）
- `.scratch/ux-25-03-session-detail-top-zh.png`、`.scratch/ux-25-11-session-completed-zh.png`、`.scratch/ux-25-12-session-completed-evidence-expanded-zh.png`、`.scratch/ux-25-13-session-handoff-preview-zh.png`（任务 #25 走查）
- `.scratch/ux29-05-session-detail-27de0ce6-zh.png`（#26/#27 轮回归：已完成会话「已就绪」+证据默认折叠）

## Verification

- 任务 #19 执行时：vitest 58 文件 / 470 例全绿；`tsc --noEmit` 0 错误；ESLint 0 错误；`completion-handoff.spec.ts` 5/5。
- 会话收敛口径（任务 #36/#37 复验）：vitest 65 文件 / 555 例；根测 2003 例 0 fail；Playwright 40/40；tsc 0 错误。

## Notes

- 偏差：`sessions/$id/index.lazy.tsx` 仅透传 props 无需改动；HandoffCard/gates/首页/governance/server 端均未触碰。
- i18n 新增 37 键仅插入 sessions 段锚点（`closing.detail` 与 `handoff.title` 之间），两语言一次命中。
- 并行冲突记录：任务 #15/#17 执行期间本票文件在途编辑曾致其单测短暂红，收敛后全绿（属并行窗口噪音，非回归）。
