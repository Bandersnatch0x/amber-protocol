---
type: spec
title: Session 可观测性 与 OKF 知识层
description: Amber Protocol 下一步特性的 Spec + Plan：将 Claude Code 会话转录纳入治理证据，并把 wiki 对齐 Google Open Knowledge Format。
status: draft-v1
date: 2026-06-17
method: research → synthesis → 严格 review → 五角色圆桌辩论 → 修订
tags: [observability, governance, wiki, okf, session, evidence]
---

# Amber Protocol 下一步 Spec + Plan

> 会话可观测性（Session Lens）与 OKF 知识层（OKF Knowledge Bundle）

本文基于五条输入线索（项目进度审查、未实现盘点、claude-devtools、obelisk 交叉对比、Google OKF）综合而成，并已通过严格 review 与五角色圆桌辩论（见 §8）。设计的第一原则是 **不突破 Amber 既有产品边界**：只读、artifact-first、dry-run-by-default、不执行 live agent、不自动改写既有文档。

---

## 1. 现状审查（线索 #1）

| 层 | 状态 | 证据 |
| --- | --- | --- |
| V1–V5.5 命令面 | ✅ 已实现并测试 | `init/audit/wiki/doctor/handoff/plan/gate/review/accept/pack/profile/team/maintenance/adoption/security` |
| Phase B（routes / sessions / autonomous record / migration） | ✅ 已实现 | `route-commands.js`、`session-commands.js`、`src/migration/` |
| Phase C（Web Viewer） | ✅ 已实现 | `apps/web`（Vite+React+tRPC），unit + Playwright e2e 进 CI |
| Phase D（生产硬化） | 🟡 部分 | SSE auth helper + error logging 存在；**SSE 端点鉴权实为已接入**（见下方漂移） |
| Governance 面 | ✅ 已实现 | approvals / adoption gate / boundary 检查 |
| 近期工作 | — | agent skill 多平台分发（Claude/Gemini/Codex/Cursor）、service packages、web CI 跨平台硬化、SSE_AUTH_SECRET |

**架构定位（七控制层）**：`Governance`（最高）> `Verification`/`Observability`（高）> `Lifecycle`/`Context`/`Tooling`（中）> `Execution`（低）。本提案刻意只加重 **Observability** 与 **Verification/Context**，不碰 `Execution`。

### 1.1 关键发现：文档漂移（real，已核实）

`README.md:38` 与 `:255` 声称 *"SSE endpoint enforcement … not wired"*，但 `apps/web/server/routes/sse.ts:8-12` 已调用 `validateSSEAuthToken` 并在失败时返回 401，提交 `5833133` 即为此。**README 落后于代码**。

> 这是一条真实存在的 stale-doc，恰好证明本提案 Feature B（OKF + stale 检测）的价值，也说明 Amber 现在缺一个"代码↔文档漂移"的可观测来源。

---

## 2. 未实现盘点（线索 #2）

分三类，避免把"刻意非目标"误判为"缺口"：

**A. 路线图内的真实缺口（可推进）**
- Phase D 余量：external monitoring 接入、完整生产硬化。
- `failure-to-regression proposals`、`trace-derived task results`（V4 / V5.5）：**契约 schema 已在，但缺"trace 证据来源"**——目前没有任何东西把真实 agent 活动喂进来。
- 没有"会话转录摄取"能力：Web viewer 只读 `.amber/sessions/`（Amber 自管会话），看不到 Claude Code 真正干了什么。
- 没有任何知识格式 conformance（wiki 是裸 Markdown，无 frontmatter）。

**B. 刻意的产品边界（非缺口，勿做）**
- Live Loop Scheduling、live subagent dispatch、自动执行 target 命令、自动 PR、自动改写既有文档。`readyForLiveScheduling=false` 是 by-design。

**C. 自身未 harness（次要）**
- 本产品仓库根目录无 `feature_list.json` / `PROGRESS.md`（product-repo 模式，by design），但这意味着 Amber 自己没吃自己的狗粮去追踪进度。

> **核心结论**：最高价值的两个缺口是 (1) **缺一个把 agent 真实活动转化为治理证据的摄取源**，(2) **缺知识层的标准化**。它们恰好对应线索 #3/#4 与 #5。

---

## 3. 外部参照与交叉对比（线索 #3 #4 #5）

### 3.1 claude-devtools（线索 #3）
只读转录查看器，解析 `~/.claude/` 的 JSONL，渲染整段会话（tool call / thinking / token / subagent tree），跨会话搜索、实时 tail、导出 MD/JSON。跨平台。**定位：全局、人看、只读、独立 app。**

### 3.2 obelisk（线索 #4，`github.com/tommy0103/obelisk`）
把所有历史会话索引进 `~/.claude/obelisk.sqlite`（FTS5）。两面：
- **Skill 面**（agent 可查）：`search()/context()/sql()` + `sessions/memories/summaries/workflows/failures/fileHistory`，零依赖（node:sqlite）。
- **App 面**（人看）：Electron（仅 macOS），session 浏览、diff、heatmap、token 图、recap card。
- **Memory 层**：把会话中产生的"持久结论"提议为 markdown memory，人批准后未来召回（"synthesis cache, not a replacement for raw evidence"）。AGPL-3.0。

**交叉对比矩阵：**

| 维度 | claude-devtools | obelisk | **Amber（现状）** | **Amber（本提案后）** |
| --- | --- | --- | --- | --- |
| 范围 | 全局所有项目 | 全局所有项目 | repo-local | **repo-local（差异化）** |
| 数据源 | ~/.claude JSONL | ~/.claude JSONL→SQLite | 仅 .amber/sessions | **~/.claude JSONL（本仓范围）+ .amber 关联** |
| 主用途 | 人看转录 | 人看 + agent 查 | 治理生命周期 | **把转录变成治理证据** |
| 与 feature/plan/gate 关联 | ❌ | ❌ | ✅（但无原始活动） | ✅✅（原始活动 ↔ 生命周期） |
| 平台 | 跨平台 | macOS-only app | 跨平台 CLI+Web | 跨平台 |
| License | — | AGPL-3.0 | 自有 | 自有 |
| 失败/回归联动 | 看得到 failures | failures 层 | 有 regression 契约无源 | **failures→regression 证据闭环** |

### 3.3 提出的改进点（对 obelisk 的差异化，line #4 核心交付）
1. **不做通用历史浏览器**（那是 obelisk/claude-devtools 的地盘，且越界全局）。Amber 应做 obelisk **不做** 的事：把原始 agent 活动**关联到 feature/plan/gate/review/handoff 生命周期**，作为**可审计证据**。
2. **复用 obelisk 验证过的概念，重铸为治理 artifact**：
   - `failures` 层 → 喂 Amber 既有 `failure-to-regression proposals`（V5.5），补上长期缺失的 trace 证据源。
   - `fileHistory` → 喂 `audit` / handoff（"本次会话改了哪些文件"）。
   - `recap card` → 重铸为 Amber `handoff` 的 session digest。
   - Memory 层（结论→markdown） → 重铸为 Amber 既有"reviewable-diff → wiki/standards 更新"（V5.5），并落到 OKF 页面（Feature B）。
3. **零运行时依赖**：直接解析 JSONL，不引 SQLite/Electron；不强制 macOS。
4. **可选 interop 而非重建**：若检测到 `~/.claude/obelisk.sqlite`，可只读消费其索引（增强，非依赖）。

### 3.4 Google OKF（线索 #5，发布于 2026-06-16，仅一天）
**Open Knowledge Format**：vendor-neutral 的"给 agent 用的知识"规范。本质 = 一个 Markdown 文件目录 + YAML frontmatter。
- 必填字段仅 `type`；可选 `title/description/resource/tags/timestamps`；正文随意。
- 概念间用标准 Markdown link 互连 → knowledge graph。
- `<major>.<minor>` 版本（当前 v0.1，minor 向后兼容）。
- 哲学："format, not platform"，人/agent 皆可读、git 可 diff、无 SDK 锁定。
- 与 RAG 区别：存"已策展、交叉链接的概念"，而非查询时重新切块。
- 参考实现：BigQuery→OKF enrichment agent；单文件静态 HTML graph visualizer。
- 谱系：Karpathy "LLM Wiki"、`AGENTS.md`/`CLAUDE.md`、Obsidian、Metadata-as-Code。

> **Amber 的 wiki 几乎已经是 OKF bundle，只差 frontmatter 与一个 validator。** Amber 的 DNA 就是"schema 驱动的 verification"——OKF conformance 天然落在 Verification 层。

---

## 4. 核心洞察：三条线索收敛为两个特性 + 一个闭环

- 线索 #3 + #4 → **Feature A：Session Lens**（repo-local 会话可观测性，治理证据导向）。
- 线索 #5 → **Feature B：OKF Knowledge Bundle**（wiki 对齐 OKF）。
- 二者通过 Amber **既有的** "reviewable-diff 维护回路" 合成一个闭环：

```
观察(A: 读会话转录) → 提炼(已有 maintenance/continuous-improvement)
   → 提议 OKF wiki 更新(B, reviewable diff) → 人审 → 知识保鲜
        ↑___________ 全程只读 / 提议制 / 不自动改写 ___________↓
```

这条闭环 100% 落在 `Observability + Verification + Context` 三层，不触碰 `Execution`。

---

## 5. SPEC

### Feature A — Session Lens（repo-local 会话可观测性）

**目标**：让 Amber 能只读地看到"本仓库内 Claude Code 会话真正做了什么"，并把它**关联到** Amber 的 session/feature/plan/gate，作为可审计证据；为长期缺失的 trace 证据源补位。

**数据源与定位**：读取 `~/.claude/projects/<encoded-repo-path>/*.jsonl`。路径编码规则 = 把绝对路径里每个非字母数字字符替换为 `-`（如 `D:\code_space\my-repo` → `D--code-space-my-repo`），已对本仓实际目录核实并落入 reader 单测。**仅当前仓**，不全局浏览。

**A0 安全前置（hard constraints，源自圆桌辩论 §8）**：
- 转录含**敏感数据**（密钥、token、文件内容、env）。默认**绝不**把原始转录写入任何会被提交的 artifact。
- 默认渲染**仅在本地 Web viewer（localhost）即时呈现**，或写入 `.amber/lens/`（init 时自动加入 `.gitignore`）。
- 任何持久化 digest **默认过 redaction**（密钥/token 模式打码）。
- **opt-in**：需显式 `--lens` / `AMBER_LENS=1`，且 repo-scoped、零网络。

**子能力（按价值排序）：**
- **A1 转录 reader + `session digest` CLI**（MVP）：解析 JSONL → 结构化（turns / tool calls / files touched / commands / failures / TODO）→ 输出**已脱敏**的 handoff-ready 摘要，注入既有 `handoff`。
- **A2 Web viewer 集成**：新增只读路由 `/transcripts`（复用既有 `VirtualTimeline`/`TimelineEvent`），与 `.amber/sessions/` 关联视图；FTS（repo-scoped）。
- **A3 失败证据 → 回归提议**：从 failed tool call 抽 trace，喂既有 `failure-to-regression proposals`（reviewable，不改测试）。
- **A4（可选）obelisk interop**：若存在 `obelisk.sqlite` 则只读消费，否则裸 JSONL。

**边界对齐**：纯只读 observability；不执行、不外呼、不改 target。✅

### Feature B — OKF Knowledge Bundle（wiki 对齐 OKF v0.1）

**目标**：把 Amber wiki 升级为 OKF v0.1 conformant bundle，使 Context 层可互操作、可校验、可导出可视化。

**子能力：**
- **B1 frontmatter 注入**：给 `templates/docs/wiki/**` 每页加 OKF frontmatter（`type` 必填 + `title/description/tags/updated/resource`）。对既有 target 仓**只 dry-run 提议 patch，不自动改写**（守 non-goal）。
- **B2 OKF validator**：扩展 `validateWiki()`（`scripts/lib/core/validators.js:228`）增加 conformance 检查（`type` 缺失、frontmatter 格式、知识图谱孤儿/断链），接入 `doctor` 与 `wiki --okf`。落 Verification 层。
- **B3 `wiki export --okf`**：产出 OKF bundle（含 `okf` 元信息 + 现有交叉链接即 graph）。reversible：去掉 frontmatter 仍是合法 Markdown。
- **B4（可选）graph visualizer**：把 OKF 单文件 HTML visualizer 思路并入 Web viewer 的知识图谱视图。

**OKF 成熟度风险对冲（源自辩论 §8）**：显式 pin `okfVersion: "0.1"`；frontmatter 纯增量、可逆；OKF 即便夭折，wiki 仍是合法 Markdown。低风险、first-mover。

**边界对齐**：纯增量 scaffold + 校验；dry-run；不自动改写既有文档。✅

---

## 6. 产品边界对齐核对（against README / SPEC Non-Goals）

| Non-Goal | 本提案是否触碰 | 说明 |
| --- | --- | --- |
| Dynamic Workflow 执行 | ❌ 不触碰 | 全程只读/提议 |
| Live subagent dispatch | ❌ | 无 |
| 自动执行 target 命令 | ❌ | 只解析 JSONL / 写本地 artifact |
| 外部 marketplace 发布 | ❌ | 无 |
| **自动改写既有 target 文档** | ❌ | B1 对既有文件仅 dry-run patch 提议 |
| Scheduled loop 执行 | ❌ | 无调度 |
| （新增风险）读 ~/.claude 越出 repo | ⚠️ 已约束 | opt-in + repo-scoped + 零网络 + 脱敏；语义同 `audit` 读 target |
| （新增风险）转录含密钥 | ⚠️ 已约束 | A0：脱敏 + gitignore + 默认 ephemeral |

---

## 7. PLAN（vertical slices，每片可独立交付并验证）

> 遵循 Amber 既有节奏：schema → validator → CLI artifact → web → 测试。TDD（red-green-refactor），每片 ≤ 数百行，独立 PR。

**Slice 0 — Spec 固化与边界签署**（本文 + §9 决策）
- 产出本 spec；通过 §9 决策；写一条 ADR（`templates/docs/wiki/architecture/decisions/`）。
- 验证：boundary 核对表（§6）全部 ❌/⚠️-已约束。

**Slice A1 — 转录 reader + `session digest`（MVP，最高 ROI）**
- `scripts/lib/core/transcript-reader.js`：定位 encoded path、流式解析 JSONL、抽 turns/tools/files/commands/failures。零依赖。
- `transcript.schema.json` + validator（schema 驱动）。
- redaction util（密钥/token 正则脱敏）+ 单测覆盖泄漏用例。
- `amber session digest [--lens]` → 脱敏摘要，注入 `handoff`。
- `.amber/lens/` 自动 gitignore。
- 测试：fixture JSONL（含假密钥）→ 断言脱敏、断言 Windows 路径编码正确。

**Slice B1+B2 — OKF frontmatter + validator（与 A1 并行，独立）**
- 给 `templates/docs/wiki/**` 加 OKF frontmatter。
- 轻量 frontmatter parser（零依赖，不引 gray-matter）+ 扩展 `validateWiki()` + `doctor` 接入 + `wiki --okf`。
- 对既有文件 dry-run patch 提议。
- 测试：conformance pass/fail、孤儿/断链、dry-run 不写盘。

**Slice A2 — Web viewer transcript 视图（依赖 A1）**
- tRPC `transcript` router + `transcript-reader.ts`（复用 server 既有 reader 模式）。
- 路由 `/transcripts`，复用 `VirtualTimeline`；与 `.amber/sessions/` 关联。
- 仅 localhost；沿用 SSE auth 模式。
- 测试：Vitest unit + Playwright e2e。

**Slice B3 — `wiki export --okf` bundle（依赖 B1/B2）**
- 导出 OKF bundle + `okf` 元信息；graph 链接校验。
- 测试：bundle 结构、可逆性。

**Slice A3 — 失败证据 → 回归提议（依赖 A1）**
- failed tool call → trace → 接 `failure-to-regression proposals`（reviewable diff，不改测试）。
- 测试：失败 fixture → 提议 artifact，断言不修改测试套件。

**Slice 末 — 文档与自 harness**
- 更新 README/ROADMAP（**顺手修 §1.1 stale-doc**）；新增 ROADMAP 一行"Session Lens / OKF（Observability+Context 增量，非 Execution）"。
- 可选：让本仓 `init` 自己，吃狗粮。

**可选 A4 / B4**：obelisk interop、graph visualizer —— 视前几片反馈再定。

**依赖图**：`Slice0 → {A1 ∥ B1B2}`；`A1 → {A2, A3}`；`B1B2 → B3`。A 线与 B 线全程可并行。

---

## 8. 圆桌辩论记录（严格 review，五角色 · 对抗式）

> 方法承袭本项目 SPEC.md 的立项法（"Roundtable review using product-boundary grilling and technical review"）。以下为真实分歧与修订，非橡皮图章。

**角色**：①产品边界守护者 ②技术架构师 ③安全审查者 ④怀疑论者/冗余检查 ⑤用户价值倡导者。

### R1 — 产品边界守护者 🛡️
- **质疑**："repo-local" 是 Amber 立身之本，读 `~/.claude`（仓外）是否越界？
- **裁决（修订）**：可接受，**但必须** opt-in + repo-scoped + 零网络 + 只写本地 artifact——语义等同 `audit` 只读 target。→ 已写入 **A0**、§6。
- **再质疑**：B1 给既有 target 文档加 frontmatter = 改写既有文档（撞 non-goal）。
- **裁决（修订）**：对**既有**文件**只 dry-run 提议 patch**；自动注入仅限 Amber 自己生成的模板页。→ 已写入 **B1**。

### R2 — 安全审查者 🔒（最强反对，导致设计改动）
- **质疑**：Claude Code 转录里**什么都有**——密钥、token、文件内容、env。若 digest 落进会被 commit 的 artifact，等于把密钥写进仓库，**直接违背 Amber "no hardcoded secrets" 的 DNA**。这是 CRITICAL。
- **裁决（设计改动）**：(a) 默认**绝不**持久化原始转录；(b) 默认 **ephemeral / localhost-only** 渲染；(c) 任何持久 digest 默认**过 redaction**；(d) `.amber/lens/` 默认 **gitignore**；(e) 脱敏需**专门单测**覆盖泄漏。→ 升级为 **A0 hard constraints**，并加入 Slice A1 验收。
- **附加**：Web viewer 暴露转录须沿用既有 SSE auth，杜绝未授权读取。→ A2 已写。

### R3 — 怀疑论者/冗余检查 🤔
- **质疑甲**：obelisk 已经做得更好、还有精致 app，Amber 重造轮子图啥？
- **裁决**：**不重造**。Amber 不做通用浏览器，只做 obelisk **不做**的治理关联（活动↔feature/plan/gate↔审计证据），并可 **interop 消费** obelisk 索引（A4）。差异化成立。→ §3.3、§5。
- **质疑乙**：OKF 发布**仅 1 天**（2026-06-16），v0.1，押注一个未成熟标准风险大。
- **裁决**：OKF 极简（必填仅 `type`）、minor 向后兼容、本质即 Markdown+frontmatter，**采纳是增量且可逆**——夭折了 wiki 仍合法。pin `0.1`，低风险 first-mover。→ §5 风险对冲。
- **质疑丙**：Feature A 是否其实是 obelisk Memory 层换皮？
- **裁决**：不是。Amber 复用**已有** reviewable-diff 维护回路（V5.5），落点是 OKF 页面 + 治理证据，而非新建 memory 子系统。→ §4 闭环。

### R4 — 技术架构师 🏗️
- **质疑甲**：`~/.claude/projects/<encoded-path>` 的**路径编码跨平台**易错（Windows 盘符→`D--…`）。
- **裁决**：编码映射做成**纯函数 + 专门单测**（含 Windows）；Amber 已有 Windows 测试基建。→ A1 验收。
- **质疑乙**：要不要引 SQLite/gray-matter？
- **裁决**：**不引**。JSONL 直接流式解析、frontmatter 自写轻量 parser，守住"零/极少依赖"（当前仅 ajv/nodemailer）。→ Plan 明确。
- **质疑丙**：大转录文件性能？
- **裁决**：流式逐行 + `--limit`/分页（server reader 已有先例）。

### R5 — 用户价值倡导者 💡
- **质疑**：四个子能力一起上太重，最快价值是什么？
- **裁决（排序修订）**：最快价值 = **A1 `session digest` 喂 handoff**——handoff 已是核心命令，digest 立刻让"换 session 不丢上下文"。故 **A1 = MVP**，A2/A3 其后，B 线并行。→ §7 Slice 顺序。
- **追加**：§1.1 的 stale-doc 顺手修，作为 Feature B 的活体 demo。→ Slice 末。

### 终审纪要
- **CRITICAL 1 项**（R2 密钥泄漏）→ 已升级为 A0 hard constraints + 验收单测，**解除阻断**。
- **HIGH 2 项**（R1 越界 / 改写既有文档）→ opt-in+repo-scoped / dry-run-only，**已化解**。
- **MEDIUM**（R3 冗余、R4 跨平台、R5 排序）→ 差异化定位 / 纯函数+测试 / MVP=A1，**已吸收**。
- **结论**：通过。范围收敛为"治理证据导向的只读可观测 + OKF 增量"，全程不触 `Execution`，与七层架构 through-line 一致。

### 8.1 后续辩论：A-digest-cli 是否实现（2026-06-17）

**议题**：A 线主体已交付（reader/web/save/evidence 全绿）。剩 `amber session digest` CLI。难点：reader 是 web-first 的 **TS**（决策 #2），amber CLI 是 **core-JS**，无法 `require`。三选项：(1) 暂不做；(2) 先抽 TS/JS 共享包再做 CLI；(3) 现在硬做（JS 复刻脱敏）。

**① 产品边界守护者 🛡️**
- 三个选项都不破边界（仍只读/提议）。但选项 3 在 JS 侧**复刻脱敏正则**，等于把 R2 的安全契约劈成两份——边界没破，**安全不变量被稀释**。
- 选项 2 的"抽共享包"要动既有 web 引用路径，属于**为尚未被请求的能力做架构改动**，踩 YAGNI。
- 裁决：反对 3；对 2 持保留（须有真实 CLI 需求才值得）。

**② 技术架构师 🏗️**
- 选项 2 最干净（脱敏永远一份），但 reader 现依赖 `apps/web` 的 TS 工具链；要么把它降级为零依赖 JS 移到 `scripts/lib/core/`，要么引入 TS 构建到核心 CLI —— **后者给一个一直刻意零构建的 CLI 引入编译步骤，是架构倒退**。
- 选项 3 的复刻是"小代码、长尾债"：两份正则随密钥格式演进必然漂移。
- 裁决：若做，只接受"reader 下沉为 core-JS 单一实现"形态；否则选 1。

**③ 安全审查者 🔒**
- 直接重复 §8/R2 的 CRITICAL：脱敏是**唯一**挡在密钥与磁盘之间的东西。**两份实现 = 两处漏点**，且二者测试会各自演化。
- 选项 3 即便我同步两份测试，也无法防止未来某次只改一边。**明确反对 3**。
- 选项 1 维持单一防线，安全面最优。选项 2 只要终态是"单一实现"亦可接受。

**④ 怀疑论者/冗余检查 🤔**
- 真实问题：CLI 到底解决了 web 没解决的什么？答案是"结束会话时纯终端 handoff，不开浏览器"。这是**便利**，非缺口。
- `handoff` 当前不读 digest 也能工作；digest 是增强。**无人提出过此需求**——典型 YAGNI 触发器。
- 裁决：选 1，除非用户明确说"我要终端里跑"。

**⑤ 用户价值倡导者 💡**
- 站在"结束会话顺手 handoff"场景，CLI 确实比开 web 顺。但当前会话用户尚未表达该工作流偏好。
- 折中建议：**选 1 但留低成本扩展点**——digest 的 markdown 生成逻辑（`lens-store.ts` 的 `digestMarkdown`）已与 IO 解耦，未来抽包成本可控。
- 裁决：选 1，记录"若出现终端 handoff 需求 → 走选项 2 的单一实现路径"。

**终审纪要（8.1）**
- **反对选项 3（一致）**：安全审查者 + 架构师 + 边界守护者均判定"复刻脱敏"稀释 R2 安全不变量，违反 DRY/no-secrets。否决。
- **选项 2 有条件可行**：仅当出现真实 CLI 需求，且终态为"reader 下沉为 core-JS 单一实现"（而非给 CLI 引 TS 构建）。
- **默认选 1（多数）**：web 已覆盖主用例，CLI 为边际便利，无人请求 → YAGNI。保留 `digestMarkdown` 的 IO 解耦作为未来扩展点。
- **结论**：采纳**选项 1（暂不实现 CLI）**，把选项 2 的前置条件写成触发器存档。A 线在此收口。

---

## 9. 待用户决策项（仅保留真正影响走向的分叉）

1. **范围与节奏**：先做 MVP（仅 Slice A1 `session digest`）验证手感，还是 A1 + B1/B2 双线并行一把起？
2. **Session Lens 落点**：先 CLI（digest→handoff），还是直接进 Web viewer？（建议默认：先 CLI）
3. **持久化策略**：digest 默认 **ephemeral（不落盘）** 还是 **落 `.amber/lens/`（gitignore + 脱敏）**？（建议默认：ephemeral，按需 `--save`）
4. **OKF 投入度**：仅 frontmatter+validator（轻），还是含 export+visualizer（重）？（建议默认：先轻）

### 9.1 决策已锁定（2026-06-17，用户确认）

| # | 决策 | 选择 | 对 Plan 的影响 |
| --- | --- | --- | --- |
| 1 | 节奏 | **双线齐发** | A 线与 B 线并行推进，非 MVP-only |
| 2 | A 落点 | **直接进 web** | A 的用户面落在 Web viewer；reader 仍是共享底座，但优先服务 web 消费者（tRPC + 路由 + 组件），CLI `digest` 降为派生 |
| 3 | 持久化 | **按需** | 默认 ephemeral 不落盘；`--save` / `?save` 时才写 `.amber/lens/`（gitignore + 脱敏） |
| 4 | OKF 投入 | **含 export+visualizer** | B 线含 B3（`wiki export --okf`）与 B4（graph visualizer 并入 Web viewer），范围加重 |

**据此重排执行顺序：**

- **A 线（web-first）**：`A-data`（claude-transcript-reader + redaction + path-encoding，TS in `apps/web/server/lib`，TDD）→ `A-api`（tRPC `transcript` router）→ `A-ui`（`/transcripts` 路由，复用 `VirtualTimeline`，与 `.amber/sessions` 关联）→ `A-evidence`（failures→regression 提议）→ 派生 `A-cli`（`session digest`）。
- **B 线（并行）**：`B-frontmatter`（模板页注入 OKF frontmatter）→ `B-validator`（frontmatter parser + 扩展 `validateWiki` + doctor + `wiki --okf`）→ `B-export`（`wiki export --okf` bundle）→ `B-visualizer`（OKF graph 视图并入 Web viewer，与 B-export 对接）。
- 两线唯一交汇点：B-visualizer 与 A-ui 同处 Web viewer，复用主题/布局；其余完全独立。

**首个增量（进行中）**：`A-data` —— 安全攸关（R2 CRITICAL）、纯函数、web 与 cli 共享底座，先 TDD 打底。

### 9.2 交付进度（2026-06-17，本会话）

全程 TDD（红→绿），root 575/575、web 77/77 全绿。

| 切片 | 状态 | 产出 |
| --- | --- | --- |
| A-data | ✅ | `redaction.ts`、`claude-transcript-reader.ts`（路径编码/JSONL/脱敏/穿越防护），19 测试 |
| A-api | ✅ | `transcript-service.ts`（边界强制脱敏）+ tRPC `transcript` router（list/read/save） |
| A-ui | ✅ | `/transcripts` 列表 + `/transcripts/$id` 详情（渲染脱敏 turns），导航项 |
| A-save | ✅ | `lens-store.ts`：按需 `save` → `.amber/lens/`（自带 `.gitignore` + 脱敏），含泄漏断言；详情页 "Save digest" 按钮 |
| B-validator | ✅ | `okf-frontmatter.js`（零依赖 parser + conformance），8 测试 |
| B-rollout | ✅ | 21 个 wiki 模板注入 OKF frontmatter；`validateWiki(_,{okf})`；`wiki --okf` CLI |
| B-export | ✅ | `okf-export.js`：`buildOkfGraph` + `exportOkfBundle`（okf.json + 拷贝页 + 自包含 `graph.html` visualizer）；`wiki export --okf` CLI |
| B-doctor | ✅ | `doctor(_,{okf})` + `doctor --okf` CLI |
| A-evidence | ✅ | `extractFailures`（tool_use↔tool_result is_error 链接）+ `regression-evidence.ts`：失败→`.amber/executions/<id>/evidence.json`（既有契约形状）；tRPC `proposeRegressions` + 详情页按钮；**端到端验证 `maintenance inspect` 能消费**，不改测试 |
| A-digest-cli | ⚖️ 暂缓（设计取舍） | reader 是 web-first TS（决策 #2），core-JS CLI 无法 `require`；硬做会**重复脱敏逻辑**（违反 DRY，且 R2 安全面双份）。web 路径已覆盖主用例。待决：(a) 暂不做；(b) 抽 reader 为跨 TS/JS 共享包再做 CLI |

**复用发现（待单列修复）**：root/web 的 `tsc --noEmit` 用 `files:[]+references` 但无 `-b`，类型门实为空操作；server 13 + client 37 个既有 strict 报错长期潜伏（非本次引入）。本次所有新文件均 strict 类型干净。

---

## 10. 战略自审：产品边界是否过度保守（2026-06-17，grill-me 自评）

**触发**：用户问"对比 GitHub 上相关 harness，Amber 的边界与围栏是否过于保守，是否要继续保持"。用 `grill-me` 方法（顺决策树逐支自审，能查代码就查）压测此前一个倾向性判断（"唯一值得松的是只读 loop"）。

### 10.1 自审推翻的两个我方早期错误

1. **品类错配**：把 Amber 对标 OpenHands/Cline/Aider/Goose（执行器）是错的。Amber 的真实同类是 **Spec Kit（constitution + 每阶段人工批准）/ BMAD（human-in-the-loop）/ Kiro / OpenSpec**。在治理/spec 品类里，"停在人工批准、不自动执行"是**行业常态**，Spec Kit 明确把"preventing runaway automation"写成卖点。→ Amber 的治理围栏**不保守，是品类标配**。
2. **"护城河"框架站不住**：早期判断默认 Amber 在市场竞争。但 Spec Kit 是 GitHub 白送、BMAD 46k★ 免费，"比免费现任更克制"不构成护城河。且 `package.json` 为 `private + UNLICENSED`。定位澄清后（**个人/团队 + 开源**），"护城河/竞品"多为伪命题；尺子应是"围栏有没有实际挡路"。

### 10.2 关键代码证据

- `workflow-packs.js:365` `readyForLiveScheduling: false` 是**硬编码字面量**，且 `:350` 无条件 push blocker。但同函数已提供 `readyForDryRun`、`readyForRecordOnly`、`allowedNow: ["describe","validate","dry-run","record"]`。
- 即：**"描述/校验/记录"全通，只"自动定时执行"不通**。闭环已闭合，缺的只是"Amber 自己定时触发"——而开源用户本就有 cron/GitHub Actions/hooks，用自有调度器触发 + `loop record` 记回即可。

### 10.3 裁决（用户确认 = (a)）

**no-execute 边界没有真实成本，不松，继续保持。** 理由按定位：
- **开源**：调度交给用户已有可信基础设施（其 CI/cron）比 Amber 自带调度器更安全、爆炸半径更小，且符合 Spec Kit/BMAD 同类惯例（均不自带调度）。
- **个人/团队**：要的是"loop 跑完把证据记进治理层"，`loop record` 已能做；自动触发是边际便利，YAGNI。
- **2026 行业教训反证**：执行器阵营撞墙于"loop 过 CI 却语义破坏"，修复是"架构边界强制人工 review + 可观测 + 硬失败门"——恰是 Amber `Governance+Verification+Observability` 三层。行业用一年重新发现了 Amber 的设计前提；此时反向松绑是踩坑。

**保留的扩展点（非现在做）**：若未来出现"团队要无人值守夜间文档保鲜、且不愿碰自有 CI"的**真实**需求，松的也不是内置调度器，而是**提供 GitHub Actions 模板**（record-only recipe）贴进用户自己的 CI——调度器仍在 Amber 之外，一寸不破边界。

**结论**：边界合理，继续保持。本次自审**不产出任何 loop 增量代码**（YAGNI）。
