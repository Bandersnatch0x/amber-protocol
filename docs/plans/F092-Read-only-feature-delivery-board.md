# Plan: Read-only feature delivery board

Feature: F092
Status: accepted
User Confirmation: confirmed
Delivery: merged-to-default-branch (e215979d; PR #414)
Acceptance: accepted on 2026-11-28; automation evidence and user continuation authorization
Session: ffae7bbd-28bc-4bc9-905e-038ca9cdeacf

## Goal

按已确认的 F092 规范，在既有治理页增加只读交付列表和续接导航。

## High Level Design

- Context: `docs/specs/F092-feature-delivery-board.md` 为规范；沿用既有 web-adapter、continuity router、i18n 和治理页，不新建工作台。
- Proposed approach: 读取模块返回 `{ generatedAt, statuses, features: { state, items, errors }, sessions: { state, items, errors } }`。页面保留原五状态，用状态筛选与原生 details 展示完整记录。只按 manifest.feature 关联 Session，不提高原状态和 evidence 的可信度。
- Risks: 损坏来源被误报为空、符号链接越界、错绑 Session、刷新后显示失效快照。用独立来源状态、既有路径约束与校验、显式关联和失效提示处理。
- 本人实施同一条耦合链，避免共享工作区并发写入。独立评审只读执行。实施阶段的禁止发布约束已由用户后续“检查CI 通过后合入”授权解除；接受登记单独记录依据。

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

- Resume Point: F092 已通过 PR #414 squash 合入默认分支，提交 `e215979d7559f84c1ff08168e286562e35a48bab`。本地 master 已对齐该提交。合入后真实 Chrome 5/5，CI run `46138561851` 为 success（9项成功、2项标签发布任务按配置跳过）。当前仅登记状态与交接，不修改产品代码。
- Preview exception: 用户选择“使用聊天授权（推荐）”，明确豁免本次G5工具确认记录要求。实施A的授权有效；不改插件，不伪造confirm-round，不把两轮timeout改为通过。
- Review: 缺失Session目录、聚焦、排序与离线暂停问题已修复。原L6.3 undecidable为历史裁决；用户A已同步正式规范L5并补实现及回归。A修订后的全量Web绿后独立Standards、Spec均通过，L6.3 implemented、其余四项增量未退化，结果登记 `.scratch/feature-delivery-board-2026-11-27/stage7-review.md`。原生合规工作流不可用，采用等价隔离审查，不把静态阅读算运行测试。
- Blockers: 无产品交付阻塞。此前未跟踪文件触发F063守卫的条件已随提交合入消除；发布前完整根测试4322通过、4跳过，五项根门禁exit0。Session账本中两次npm test超时保留，不改写为成功；完整成功输出在本地交付报告，合入CI独立成功。
- Next Action: 功能闭环已完成：Feature与计划accepted，Session completed，strict complete-check通过。产品代码已在默认分支；本次状态与文档收尾另走文档PR，经检查后合入。不新增产品能力或执行npm发版。
- Documentation checks: G2/G4、G6、G8、G10此前通过；最新收尾结果见 `.scratch/feature-delivery-board-2026-11-27/document-checks-final-20261128.json`。保留G5.stale_round、聊天授权例外与原超时历史，不补造工具确认。
- Recovery Instructions: 不重复已完成实施和历史评审；保留预览超时和回归 RED 证据。原本地提交 `f5736c9e` 保存在 `archive/f092-before-master-sync-20261128`；同步前passing补丁保存在本地delivery目录。状态收尾仅通过治理CLI完成，不手改Session账本。

## Acceptance Criteria

`docs/specs/F092-feature-delivery-board.md` L6.1–L6.5 全部有证据。保持原五状态、显式关联、独立会话可见、错误与合法空区分、无查询写入及既有续接入口。设计审查和测试不等于人工验收。

Guardrails: 保持当前只读 phase boundary；看板不执行命令、不写仓库、不批准或验收、不派发Agent或调度任务，不增加拖拽状态变更或新的任务实体。

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
- Delivery evidence: PR #414 已合入master，`git merge-base --is-ancestor e215979d origin/master` exit0；源码树与被测提交相同。合入CI run `46138561851` success；浏览器原始报告 `.scratch/feature-delivery-board-2026-11-27/evidence/post-merge-acceptance-20261128.json` 记录5/5、0 skipped/unexpected/flaky，日志exit0。原始本地报告不保证随仓库迁移。
- Notes: 用户早期授权限于A及实施；后续明确要求CI通过后合入，并在状态收尾说明后要求“继续”。本次据此完成接受登记，不把自动化检查标为用户亲自执行的人工验收，不执行包发布。

## Log — 2026-11-28 A裁决后复核

用户明确选择A：两来源均ok才推进本页健康时间；error/partial/transport失败保留健康时间、标stale，首次失败无时间；恢复时更新。规范L5、实现和回归已同步。Web836/836、Chrome5/5、build含类型/format/lint exit0，lint保留33既有warning；最终字节撤修2失败/11通过，精确恢复后13/13。全量后独立Standards与Spec发现0，L6.3 implemented，另外四项未发现增量退化。本地审查已完成；未发布，阶段7交付出口未关闭，delivery=pending-publish。报告和原始证据位于未版本控制的`.scratch/feature-delivery-board-2026-11-27/decision-a/`，不保证随仓库迁移。G5仅保留聊天授权例外，不伪造工具确认。

## Log — 2026-11-28 合入后收尾

以上A裁决日志为合入前历史。后续PR #414已合入master（`e215979d`），完整根测试4322通过、4跳过，合入CI成功，浏览器复验5/5。此前独立Standards、Spec及L6.1–L6.5合规结论均已收束，本次只更新治理状态和交接。用户在明确列出接受、Session完成与交接步骤后要求“继续”，本次据此登记接受；未声称用户亲自操作页面。静态计划review发现验收段缺少显式只读边界，已补Guardrails，与既有规范L1/L4一致。

CLI收尾结果：两项Session门禁于本次登记；`session complete-check --strict` pass，`session complete`和`accept --session ... --strict`均exit0，Feature与计划accepted。Session账本10条校验完整，历史失败保留。manifests、doctor、gen:agents:check、wiki及修改文件格式检查均exit0；doctor保留11条既有Memory警告。本轮无产品代码变化，未重复全量根/Web测试，沿用源码未变与合入CI证据。learnings未命中强制写回；T1提名`trig-mx0fhysr-f14ca3`通过CLI明确skipped，本次没有新增持久知识，不改MEMORY.md。交接与原始收尾回执位于本地，不保证随仓库迁移。
