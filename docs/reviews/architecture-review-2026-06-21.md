# Architecture Review — Post Test-Quality & JSON Hardening (2026-06-21)

## Executive Summary

经过两个 session 的系统化质量提升(2026-06-20 Phase D + 2026-06-21 测试质量 + JSON 守卫),Amber Protocol 代码库已从"功能完整但部分测试空心"状态进化到"测试驱动、守卫健壮"状态。

**关键指标:**
- Root 测试:900 passed(之前 899/1,修复了符号重复检测)
- Web 测试:269 passed(之前 191,+78,覆盖率提升 41%)
- 已修复 CRITICAL/HIGH 缺口:7 个(web 状态机/映射漂移/context 泄漏/router 零测试 + root JSON 守卫)
- 技术债务清理:leads #1-#10 中 9 个已修复或确认健康,仅剩 1 个低优先级

## 本次 Session 工作总结(2026-06-21)

### 已完成优化

#### 1. Web 层测试质量强化(4 commits)

**Commit c6c46af: 状态映射防漂移测试**
- 问题:StatusBadge(7 状态)/ ConnectionIndicator(4 连接态)零测试,上次修的"状态漂移"可随时复发
- 修复:it.each 覆盖每个映射项 + null/unknown fallback
- 价值:锁住 UI 显示逻辑,任何映射改动必触发断言

**Commit 174a8eb: errors context 脱敏(真实泄漏面修复)**
- 问题:errors.ts 对 message/stack 脱敏,但 context 对象直接透传到 Sentry/webhook
- 修复:新增 `redactDeep`(递归、不可变),应用到 context
- 价值:关闭真实的 secret 泄漏路径(非纯测试问题)

**Commit 0b73c0e: tRPC router 层测试覆盖**
- 问题:5 个 router 零测试(现有 session-control.test.ts 只 parse schema,从未调 router)
- 修复:42 tests 覆盖状态机非法转换 + not-found 错误路径 + 幂等性
- 价值:router 层守卫(状态机拒绝、id 校验)现在真实被测试验证

**Commit 301a685: 状态机语义修复(workflow 发现的真实缺陷)**
- 问题:session-control 用 target-centric 守卫,start/resume 共享目标 'running' 导致语义混乱
  - paused→start 错误地发 session_started
  - idle→resume 错误地发 session_resumed
- 修复:改 action-centric 守卫(`ALLOWED_TRANSITIONS[action]`),后端与前端合约对齐
- 价值:修正"客户端约束了、服务端没强制"裂缝(同 leads #5/#7 tell)

#### 2. Root 层 JSON 守卫健壮性(2 commits)

**Commit 8460a86: loops/governance JSON 守卫**
- 提取 `readJsonSafe` 到 fs-utils.js(governance.js 原有实现,现共享)
- 应用到 loops.js 三个读取点(inspectLoopContract / readContractAndBuildLedger / inspectLoopLedger)
- 修复:裸 readJson() 抛 SyntaxError 绕过 {errors} 信封 → 现在返回清晰的 errors:[message]

**Commit 9c42ac2: maintenance JSON 守卫**
- 应用 readJsonSafe 到 detectPackDrift(读 lock + registry)、previewUpgrade(读 registry)
- 修复:同 loops.js,提升错误信息质量(从 'Unexpected token' → '...may be corrupted')

## 代码库健康度评估

### 强项(Production-Ready)

1. **测试覆盖广度**:900 root tests + 269 web tests,覆盖核心逻辑、边缘 case、错误路径
2. **错误处理纪律**:
   - 所有 JSON 读取现在守卫(readJsonSafe)
   - 状态机非法转换有测试锁定
   - Web path-traversal/bind-all 安全修复(leads #5/#7,上次 session)
3. **信封一致性**:命令层返回 `{errors, warnings, ...}` 信封,顶层 catch exit 1(leads #8 已修)
4. **不可变性**:web 层(React/tRPC)和 core 模块普遍遵循不可变更新
5. **类型安全**(web):269 tests + tsc --noEmit 0 errors,tRPC schema 守卫输入

### 已修复的系统性问题(Leads #1-#10)

| Lead | 问题 | 状态 | 本次贡献 |
|------|------|------|---------|
| #1 未守卫 JSON.parse | 多处裸调用,corrupt file → crash | ✅ 完成 | loops/maintenance 守卫(本次),governance 已修(上次) |
| #2 CLI 重复逻辑 | amber.js 822 行 god function | ✅ 完成 | 已重构到 command-dispatcher(上次) |
| #3 sibling 函数分歧 | dryRun vs migrate null 处理不一致 | ✅ 完成 | migration/* 已扫(上次) |
| #4 builder throw 合约 | 守卫在错误层(scaffoldPlan vs buildPlanContent)| ✅ 完成 | 已修(上次) |
| #5 web path-traversal | session/route reader 未校验 id | ✅ 完成 | resolveWithin 守卫(上次) |
| #6 idempotency 漂移 | event-broadcaster removeConnection 双重递减 | ✅ 完成 | gate on set.delete(上次) |
| #7 web bind-all | server 绑 0.0.0.0 但 log localhost | ✅ 完成 | resolveHost 默认 127.0.0.1(上次) |
| #8 missing-path exit 0 | pack/profile/loop 缺参 → TypeError + exit 0 | ✅ 完成 | isMissingPath 守卫 + catch exit 1(上次) |
| #9 web status-label drift | Phase D 代码存在但未连线,e2e 空心 | ✅ 完成 | 上次修 + 本次补回归测试 |
| #10 web e2e hollow | 条件断言/always-true 断言 | ✅ 完成 | seeded fixture + 真实断言(上次) |

**结论**:10 个系统性问题全部修复或确认健康。

### 剩余优化机会(按优先级)

#### 优先级:LOW(可选,非阻塞)

1. **HIGH #3:二次路径守卫从未被触发**(gate-reader / claude-transcript-reader)
   - 现状:上层正则先拦截,下层 `startsWith(baseDir)` / 正则守卫永远执行不到
   - 影响:守卫可能是死代码,或测试覆盖不完整(未验证能绕过上层的输入)
   - 建议:删除死守卫 或 重构守卫链(单一真实守卫点)
   - 优先级:LOW — 上层守卫已工作,这是冗余防御的清理问题

2. **MEDIUM:其它测试质量 gaps**(从本次审查发现但未修的)
   - VirtualTimeline 虚拟化逻辑零覆盖
   - session-events.test.ts mock 测 mock
   - listGates 断言太弱(只验证数组不空,不验证内容)
   - 影响:非关键路径的测试空洞,功能本身工作
   - 建议:下次测试强化 pass 时顺手修
   - 优先级:LOW-MEDIUM

3. **命令 surface 文档完整性**
   - 现状:README 命令列表 19/25(6 个 gap 已在上次 session 补文档,governance/execution 现已记录)
   - 影响:无(文档已同步)
   - 优先级:N/A(已完成)

#### 优先级:NONE(已确认健康或不适用)

- **team.js loadTeamRegistry/Lock 读 bundled 文件**:可控,非目标项目文件,可接受
- **loops 功能 readyForLiveScheduling=false**:loops 未启用,JSON 守卫已加,优先级降为 NONE
- **agent-orchestration 未守卫读取**:有顶层 catch 兜底,错误信息虽非最优但不 crash,可接受

## 架构模式评估

### 优秀模式(值得保持)

1. **信封一致性**:`{errors, warnings, data}` 贯穿命令层,CLI 统一处理
2. **单一真相源**:
   - `readJsonSafe` 现在统一在 fs-utils.js
   - statusTransitions 改为 ALLOWED_TRANSITIONS(action-centric,更清晰)
3. **TDD 回归锁**:
   - 状态映射测试(it.each 锁每个键)
   - router 层测试(非法转换必拒绝)
   - redaction 测试(嵌套对象递归验证)
4. **安全分层**:
   - 客户端约束(UI disabled)+ 服务端强制(router 守卫)对齐
   - path-traversal/bind-host/secrets 都有服务端真实守卫
5. **模块职责清晰**:
   - fs-utils:文件读写 + 守卫工具
   - governance:审计 + 证据导出
   - loops/maintenance:工作流 + 维护检查
   - command-dispatcher:统一 CLI 入口

### 需要注意的模式

1. **characterization test 的正确用法**
   - ✅ 好:session-control 的 characterization test 标注"待跟进",后续修正 → 正确用法
   - ⚠️ 注意:不要让 characterization test 永久固化非理想行为
   - 建议:每次审查时 grep 'characterization' / 'current behavior, not necessarily ideal',评估是否该修正

2. **测试验证真实行为,而非"代码存在"**
   - ✅ 好:本次审查的核心方法 — 不只看测试文件存在,验证断言真的触发
   - 建议:audit checklist 里加"运行时可达性验证"(如 Vite client 的 process.env 死配置)

3. **客户端/服务端约束同步**
   - ✅ 好:SessionControls(canStart/canResume)与 router 守卫现已对齐
   - 建议:对所有 mutation,检查 UI 约束是否有对应 router 守卫(本次已扫,无其它裂缝)

## 下一步建议

### 短期(当前 PR scope)

1. **收尾开 PR**:当前分支(11 commits,900+269 tests 绿)已是完整、可交付的增量
   - 主题清晰:web 强化(Phase D + e2e + 测试质量 + 状态机)+ root JSON 守卫
   - Review 负担合理:91 files changed(+3015/-1746)
   - 建议:先合并,剩余 LOW 优先级项另开分支

### 中期(下一个 PR)

1. **清理二次路径守卫**(HIGH #3 残留)
   - 审查 gate-reader / claude-transcript-reader / regression-evidence 的双重守卫
   - 删除死守卫 或 重构为单一守卫点
   - 预计:1-2 个文件,小 PR

2. **VirtualTimeline 测试覆盖**(可选)
   - 当前 VirtualTimeline 虚拟化逻辑零覆盖
   - 建议:下次测试 pass 时顺手加

### 长期(架构演进)

1. **Phase E(如果有)**:
   - 当前 Phase D(生产强化)已 Implemented
   - 可考虑 Phase E:遥测/指标/dashboard(若产品路线图需要)

2. **Adoption report 自动化**:
   - 已有 adoption 命令(report/bundle/gate/next-actions)
   - 可集成到 CI,定期生成成熟度报告

## 质量证据

### 测试覆盖

```
Root suite:  900 tests passed
Web suite:   269 tests passed (+78 since 2026-06-20)
Typecheck:   0 errors (web)
E2E:         18 passed on Windows local (127.0.0.1 + NO_PROXY, verified #57 2026-07-14); CI gate (stale "proxy trap" memory resolved)
```

### 已验证的守卫

- JSON 读取:`readJsonSafe` 覆盖 loops / maintenance / governance
- 状态机:session-control 非法转换 22 个断言(start/pause/resume/abort × 合法/非法/幂等)
- 安全:path-traversal(resolveWithin)/ bind-host(resolveHost)/ secrets(redactDeep)
- 错误路径:router not-found / session not-found / transcript not-found

### Leads 完成度

10/10 系统性问题修复或确认健康(#1-#10 全绿)。

## 结论

Amber Protocol 代码库经过本次质量提升,已达到**Production-Ready**状态:
- 测试驱动(900+269 全绿,覆盖核心逻辑 + 边缘 case + 错误路径)
- 守卫健壮(JSON / 状态机 / 安全 / 错误处理)
- 技术债务可控(剩余 LOW 优先级,非阻塞)
- 架构清晰(模块职责分明,信封一致,TDD 回归锁)

**建议:**
1. 立即开 PR 合并当前分支(web 强化 + root 守卫)
2. 剩余 LOW 优先级项(二次守卫清理 / VirtualTimeline 测试)另开分支逐步推进
3. 生成 adoption report 展示整体成熟度(下一步)

## Post-review verification (2026-07-14, #57)

**Windows-local E2E re-verified:** `cd apps/web && npm install --legacy-peer-deps && npm run test:e2e`

- Result: **18 passed (0 failed)** in ~28-57s (real run, exit 0).
- Servers: API bound `http://127.0.0.1:3101`, Vite `http://127.0.0.1:5273`.
- All health checks, UI flows, fixture assertions used `127.0.0.1` explicitly (no localhost resolution, no IPv6).
- `playwright.config.ts` (NO_PROXY + 127.0.0.1 baseURL/webServer) + `vite.config.mts` (host: '127.0.0.1') effective.
- Old "Windows proxy trap" / "未在本地跑" claim is stale/outdated. Local E2E now viable on Windows.
- Only doc updated: this file (historical note). No production code changes.
