# 06 transcript 时间轴重构：降噪规则 R1–R9 + 左轴连接线 + Markdown 启发式 + tool-only 徽章 + 骨架屏

## Objective

对应任务 #26/#30/#32。重构转录时间轴可读性，落地一整套降噪与渲染规则：

- **降噪规则 R1–R9**：
  - R1/R6：整条隐藏的噪声 turn 改入 MetadataPanel 收纳；
  - R2：芯片卡式呈现；
  - R3：stdout 折叠，仅显首行 ≤120 字符；
  - R4：ANSI 全局剥离（CSI + OSC 序列）；
  - R5：task-notification 取 `summary` 字段；
  - R8：recap 按 subtype 精确优先（`away_summary` 主信号），尾缀仅兜底旧数据，皆无降级 plain，兜底 plain +1200 截断 + 可展开；
  - turn 分隔：相邻 turn 时间差 >15min 触发分隔。
- **时间轴左轴**：竖向 timeline rail 连接线。
- **列表标题**：改用 `readableOutlineText`（人类可读概要）替代原始 id。
- **Markdown 启发式**：`naturalLanguageRatio` 判定正文/数据，`isProseBulletLine` 区分散文 bullet 与列表项，决定是否走 Markdown 渲染。
- **tool-only turn**：显示 slate 色「工具」徽章。
- **空态骨架屏**：转录详情 0 内容时渲染 pulse 骨架占位。

## Blocking edges

- blocked by：票据 01（dev 端口稳定 → e2e webServer 可起）。
- blocks：票据 08（away_summary 加固依赖降噪管线 R8 基座）；票据 09（推断关联读取降噪后的 transcript）。

## Status: DONE

## TDD evidence

从仓库取证（计数文件内 `test(` 或 `it(` 出现次数）：

- `apps/web/src/features/transcripts/transcript-denoise.test.ts` — 29 例（R1–R9 降噪规则、recap/plain 降级、截断、turn 分隔）
- `apps/web/tests/client/MarkdownMessage.test.tsx` — 5 例（Markdown 启发式 naturalLanguageRatio / isProseBulletLine）
- `apps/web/tests/client/TranscriptBadge.test.tsx` — 3 例（tool-only slate 徽章）
- e2e `apps/web/tests/e2e/transcript-timeline.spec.ts` — 3 例（时间轴左轴连接线、列表 readableOutlineText、骨架屏）

## Browser evidence

- `.scratch/ux31-01-transcripts-list-full.png` / `ux31-01-transcripts-list-top.png`（列表 readableOutlineText 标题）
- `.scratch/ux31-02-assistant-markdown-rendered.png` / `ux31-02b-edge-stat-list-as-code.png` / `ux31-02c-real-codeblock-diff.png`（Markdown 启发式渲染）
- `.scratch/ux31-03-tool-only-badge-slate.png`（tool-only slate 徽章）
- `.scratch/ux31-04-skeleton-attempt1.png` … `ux31-04-skeleton-loading.png`（骨架屏迭代）
- `.scratch/ux31-05-detail-top-timeline.png`（时间轴左轴连接线）

## Verification

- 会话收敛口径（任务 #36/#37 复验）：apps/web vitest 65 文件 / 555 例全绿；根 `npm test` 2003 例（1999 pass / 0 fail / 4 skip）；Playwright e2e 40/40；`tsc --noEmit` 0 错误。

---
Commit: `3b392b73`
Status: DONE (retroactive evidence)
