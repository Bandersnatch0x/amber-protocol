# Plan: Read-only feature delivery board

Feature: F092
Status: reviewed-pending-publish
User Confirmation: confirmed
Delivery: pending-publish
Session: ffae7bbd-28bc-4bc9-905e-038ca9cdeacf

## Goal

按已确认的 F092 规范，在既有治理页增加只读交付列表和续接导航。

## High Level Design

- Context: `docs/specs/F092-feature-delivery-board.md` 为规范；沿用既有 web-adapter、continuity router、i18n 和治理页，不新建工作台。
- Proposed approach: 读取模块返回 `{ generatedAt, statuses, features: { state, items, errors }, sessions: { state, items, errors } }`。页面保留原五状态，用状态筛选与原生 details 展示完整记录。只按 manifest.feature 关联 Session，不提高原状态和 evidence 的可信度。
- Risks: 损坏来源被误报为空、符号链接越界、错绑 Session、刷新后显示失效快照。用独立来源状态、既有路径约束与校验、显式关联和失效提示处理。
- 本人实施同一条耦合链，避免共享工作区并发写入。独立评审只读执行。禁止提交、推送和自动验收。

## Context manifests

- implement: docs/specs/F092-feature-delivery-board.md, docs/adr/0007-web-viewer-role.md, docs/product/DESIGN.md
- review: docs/specs/F092-feature-delivery-board.md, docs/adr/0007-web-viewer-role.md

## Vertical Slices

- [x] Slice 1: 确定性只读快照，先测试再实现。
  - paths: scripts/lib/core/feature-board.js, apps/web/tests/server/feature-board.test.ts
  - depends-on: none
  - verify: npm --prefix apps/web test -- tests/server/feature-board.test.ts
  - evidence: 模块缺失时RED，最初9/9；最终补缺失Session目录与合法空的区分，10/10，撤修RED、恢复GREEN。固定来源、显式关联、路径边界、部分失败及字节不变已覆盖。
- [x] Slice 2: 通过既有 adapter 公开有类型的只读快照。
  - paths: scripts/lib/web-adapter.js, scripts/lib/web-adapter.d.ts
  - depends-on: 1
  - verify: npm --prefix apps/web run typecheck
  - evidence: runtime 导出和 WebAdapter 声明已接线，typecheck 通过。
- [x] Slice 3: A 聚焦列表，保留原五状态筛选、来源错误、完整显式 Session 和既有报告。
  - paths: apps/web/server/routers/continuity.ts, apps/web/src/features/governance/FeatureBoard.tsx, apps/web/src/features/governance/FeatureBoard.test.tsx, apps/web/src/routes/governance.tsx, apps/web/src/lib/i18n.tsx
  - depends-on: 1, 2
  - verify: npm --prefix apps/web test -- src/features/governance/FeatureBoard.test.tsx
  - evidence: 组件从缺模块 RED 到 11/11；用户裁决 A 后13/13，新增来源error/partial与首次失败的RED、撤修RED和恢复GREEN。两来源均ok才推进健康时间，聚焦切换保留健康时间并重置筛选。board query 禁用轮询、窗口聚焦和重连刷新。
- [x] Slice 4: 真实页面交互、界面审查和证据整理。
  - paths: apps/web/tests/e2e/feature-board.spec.ts
  - depends-on: 3
  - verify: 隔离临时仓库执行 `node .scratch/feature-delivery-board-2026-11-27/run-board-e2e.cjs decision-a-browser-verified`
  - evidence: 2026-11-28 A修订后五项真实 Chrome E2E 通过。包含只读文件树/SHA-256、请求仅GET、来源错误与partial保留健康时间、聚焦切换、传输失败、首次无健康历史及恢复、10秒timeout/retry、离线手动重试和320px键盘回归。该套件将临时fixture manifest规范化并在退出时恢复原字节。两轮测试断言失败记录保留。未将provider unknown升级为成功或验收。

## Resume Checkpoint

- Resume Point: 用户已选择时间语义A并完成实施。最终Web89文件836/836、typecheck/build/format通过，lint 0 error、33既有warning；真实Chrome5/5。根测试前轮4326项：4322通过、4跳过、0失败；其余四项根检查exit0，doctor有11项memory warning。本次仅5个既有前端文件变化，根运行时和服务端测试hash未变，未重复根全量。详见 `.scratch/feature-delivery-board-2026-11-27/final-verification.md`。
- Preview exception: 用户选择“使用聊天授权（推荐）”，明确豁免本次G5工具确认记录要求。实施A的授权有效；不改插件，不伪造confirm-round，不把两轮timeout改为通过。
- Review: 缺失Session目录、聚焦、排序与离线暂停问题已修复。原L6.3 undecidable为历史裁决；用户A已同步正式规范L5并补实现及回归。A修订后的全量Web绿后独立Standards、Spec均通过，L6.3 implemented、其余四项增量未退化，结果登记 `.scratch/feature-delivery-board-2026-11-27/stage7-review.md`。原生合规工作流不可用，采用等价隔离审查，不把静态阅读算运行测试。
- Blockers: L6.3时间歧义已由用户A解决。发布证据仍缺失。根完整测试在8个新文件临时intent-to-add条件下通过；标记已撤销。恢复为未跟踪后直接重跑仍会触发F063放置守卫，不能宣称当前索引状态无条件全绿。
- Next Action: A后的独立两轴与合规检查已收束，保留pending-publish并等待后续发布指令。四条exact允许规则已获用户授权并应用，default-deny保留，不需再次申请。不提交、不推送、不代为验收。
- Documentation checks: G2/G4、G6、G8、G10此前通过；最新收尾结果见 `.scratch/feature-delivery-board-2026-11-27/document-checks-final-20261128.json`。保留G5.stale_round、聊天授权例外与原超时历史，不补造工具确认。
- Recovery Instructions: 不重复已完成后端实施与历史评审；保留预览超时和回归 RED 证据。不再询问 A/B 或重开预览弹窗。不复制模拟原型，不提交推送，不自行接受 Feature 或 Session。

## Acceptance Criteria

`docs/specs/F092-feature-delivery-board.md` L6.1–L6.5 全部有证据。保持原五状态、显式关联、独立会话可见、错误与合法空区分、无查询写入及既有续接入口。设计审查和测试不等于人工验收。

## Verification

- 定向 query 和组件测试；行为回归须有 RED/GREEN 或撤销修复后 RED 的证据。
- Web typecheck、lint、build、全量 Vitest 和适用 Playwright。
- 根目录npm test、manifests、doctor、gen:agents:check及wiki均已执行通过。根测试完整日志整体读取，结果和临时索引条件另有记录；不重复根/Web并发。
- 独立 Standards、Spec、安全检查及 spec-to-code 对照。局部预审不冒充完整阶段 7。未执行或失败项原样记录。

## Evidence Schema

- Command: Web 定向组件测试、全量 Vitest、typecheck、定向 lint、build 和 FeatureBoard Playwright。
- Result: 2026-11-28后端10/10；A后组件13/13、Web89文件836/836、typecheck/build/format通过、lint 0 error与33 warnings、真实页面E2E 5/5。前轮根npm test exit0：4322通过、4跳过、0失败；其他四项根检查exit0。历史失败原样保留。
- Date: 2026-11-28。原始provider页面证据保留其2026-11-27时间和observed_state=unknown。
- Evidence: `.scratch/feature-delivery-board-2026-11-27/evidence/feature-board-final-20261128.json`及同名目录为最终五项E2E报告和附件；`.scratch/feature-delivery-board-2026-11-27/evidence/offline-query-red/`、`.scratch/feature-delivery-board-2026-11-27/evidence/offline-query-green-isolated.json`记录离线修复RED/GREEN；`.scratch/feature-delivery-board-2026-11-27/evidence/focus-inset-revert-red/`记录焦点内缩回归RED；`.scratch/feature-delivery-board-2026-11-27/evidence/product-a11y-calibrated.json`和`.scratch/feature-delivery-board-2026-11-27/evidence/product-audit.json`保留焦点、根字号、字体、正文对比及四档视口测量；`.scratch/feature-delivery-board-2026-11-27/evidence/web-final-20261128.log`记录此前一轮833/833全量Web套件、build、lint和格式检查；修复后的重跑结果见`.scratch/feature-delivery-board-2026-11-27/final-verification.md`。`.scratch/feature-delivery-board-2026-11-27/backend-root-verify.log`保留根测试策略拒绝。
- Limitations: 早期主E2E fixture有损坏Session manifest，历史正常截图带partial；A套件使用规范化的双来源健康临时fixture并恢复原字节。Session详情及既有Handoff连续性已实测。200%用根字号模拟，不等同浏览器缩放；状态×视口未穷举。壳层的小导航目标与provider unknown边界保留。
- Root evidence: `.scratch/feature-delivery-board-2026-11-27/root-tests-final-20261128.log`及同名JSON保存完整输出和575.598秒墙钟；`root-other-gates-authorized-20261128.json`保存三项新增根检查，wiki另在会话账本。`final-state-check.json`记录产品hash未变、策略与已授权候选语义一致、8个临时索引标记已撤销和暂存区为空。根最终完整日志直接捕获，未冒充新增账本成功记录。
- Current Web evidence: 同run目录 `decision-a/web-final-checks.json`与四个完整日志，`evidence/decision-a-browser-verified.json`与附件记录A后的最终结果；`decision-a/revert-proof.json`及RED/GREEN日志证明时间回归有效。历史`web-post-review.json`不再作为最新结果。
- Review evidence: 同run目录 `compliance/L6.1.json`至`L6.5.json`、`post-green-standards.md`、`post-green-spec.md`、`stage7-review.md`。这些报告留在未版本控制的.scratch，不保证随仓库迁移；本计划已记入关键裁决与限制。
- Pending: 发布证据及整体验收。Delivery维持pending-publish；不因本地审查通过关闭阶段7的交付出口。
- Notes: 用户授权采用 A、实施及本次完整界面检查；只豁免本次 G5 工具确认记录，不授权提交、推送、自动批准或最终验收。

## Log — 2026-11-28 A裁决后复核

用户明确选择A：两来源均ok才推进本页健康时间；error/partial/transport失败保留健康时间、标stale，首次失败无时间；恢复时更新。规范L5、实现和回归已同步。Web836/836、Chrome5/5、build含类型/format/lint exit0，lint保留33既有warning；最终字节撤修2失败/11通过，精确恢复后13/13。全量后独立Standards与Spec发现0，L6.3 implemented，另外四项未发现增量退化。本地审查已完成；未发布，阶段7交付出口未关闭，delivery=pending-publish。报告和原始证据位于未版本控制的`.scratch/feature-delivery-board-2026-11-27/decision-a/`，不保证随仓库迁移。G5仅保留聊天授权例外，不伪造工具确认。
