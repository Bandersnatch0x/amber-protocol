# Feature Map

> 状态来源：`feature_list.json`（所有 F-number）。成熟度按 accepted/in_progress/not_started 标注。
> 最后更新：2026-09-02

---

## 能力域一览

| # | 能力域 | 一句话价值 | 典型命令 | 成熟度 |
|---|--------|-----------|---------|--------|
| 1 | 脚手架安装 | 把治理文件放进你的 repo，一步完成，幂等安全 | `amber init` | ✅ 稳定 |
| 2 | 健康检查 | 随时验证 Amber setup 是否一致可用 | `amber doctor` | ✅ 稳定 |
| 3 | 交接与延续 | 任何人或 agent 都能从文件读懂当前状态并继续 | `amber handoff bundle` | ✅ 稳定 |
| 4 | 计划与审批门控 | 让功能计划在实现前可见、可审、可追溯 | `amber plan` · `amber gate` | ✅ 稳定 |
| 5 | 会话与路由 | 给每段工作分配路线、追踪阶段、支持断点续跑 | `amber session start/status/continue` | ✅ 稳定 |
| 6 | 治理报告与审计 | 看清 AI coding 工作流的健康度与下一步安全动作 | `amber governance report` · `amber next` | ✅ 稳定 |
| 7 | 受治理执行 | 在四道门后运行一次性命令，留下可验证的账本 | `amber loop run --execute` | ✅ 稳定（人工触发） |
| 8 | 知识与上下文 | 把会话产出蒸馏为带溯源的知识页，供后续 agent 读取 | `amber context request` · `amber knowledge graph` | ✅ 稳定 |
| 9 | 团队与工作流包 | 跨 repo 分发路由、规则包、团队预设，版本可回滚 | `amber team install` · `amber pack inspect` | ✅ 稳定 |
| 10 | Web 可视化 | 浏览器里查看会话时间线、门控状态和知识图谱 | `cd apps/web && npm run dev` | ✅ 稳定 |
| 11 | 安全与隐私治理 | 依存扫描、密钥检测、权限审查，作为声明式工作流包 | `amber security audit` | ✅ 稳定 |
| 12 | 高级信任基础设施 | Principal、Decision、Evidence、Gate 的不可变账本 | （内部基础层，F049-F062） | ✅ 稳定（基础层） |

---

## 能力域详情

### 1. 脚手架安装

给目标 repo 安装 Amber starter 文件，已有文件跳过，重跑幂等。

| Feature | 标题 | 状态 |
|---------|------|------|
| F001 | Amber scaffold install (init) | accepted |

典型命令：`amber init --target path/to/repo`
产出：`AGENTS.md` · `CLAUDE.md` · `feature_list.json` · `docs/wiki/` 骨架

---

### 2. 健康检查

报告 Amber setup 是否完整、schema 是否有效、wiki 链接是否可达。

| Feature | 标题 | 状态 |
|---------|------|------|
| F002 | Doctor validation | accepted |
| F012 | Pre-push hook rejects pi-rewind refs | accepted |
| F031 | Keep skill frontmatter commands in lockstep | accepted |

典型命令：`amber doctor --target .`
产出：pass/fail 报告，含具体修复建议

---

### 3. 交接与延续

从当前 repo 状态生成可携带的交接包；验证是否可以安全移交。

| Feature | 标题 | 状态 |
|---------|------|------|
| F006 | Handoff reports | accepted |
| F026 | Finish-time dirty-path classification | accepted |
| F027 | Role-scoped context manifests in plans | accepted |
| F030 | Clarify learnings output | accepted |
| F032 | Keep approval gates distinct from session completion | accepted |

典型命令：`amber handoff bundle --target .`
产出：`session-handoff.md` 含 repo 状态、未提交变更分类、下一步动作

---

### 4. 计划与审批门控

生成功能计划、垂直切片、验证步骤；在用户确认前阻止实现态。

| Feature | 标题 | 状态 |
|---------|------|------|
| F005 | Governance report & approval gates | accepted |
| F016 | Review blocker remediation | accepted |
| F024 | Fix dogfood friction batch | accepted |
| F025 | Break-loop post-mortem scaffold | accepted |
| F028 | Durable owner routing for recurring friction | accepted |
| F049 | Canonical Planning Artifacts | accepted |

典型命令：`amber plan --feature F042` → `amber gate --feature F042` → `amber review` → `amber accept`
产出：`docs/plans/<date>-<slug>.md`，gates 通过前 implementation-ready 状态被阻断

---

### 5. 会话与路由

把目标（goal）和路由（route）绑在一起，以阶段为单位推进，支持断点续跑和多 session 并存。

| Feature | 标题 | 状态 |
|---------|------|------|
| F003 | Route engine | accepted |
| F004 | Session lifecycle | accepted |
| F032 | Keep approval gates distinct from session completion | accepted |
| F062 | Route Stage Verbs & Named Governed Commands | accepted |

典型命令：`amber session start --goal "..."` · `amber session status` · `amber next`
产出：`.amber/sessions/<id>/` 下 manifest + timeline + checkpoint

---

### 6. 治理报告与审计

评分工作流健康度，给出结构化下一步；legacy .harness 状态透明可读。

| Feature | 标题 | 状态 |
|---------|------|------|
| F005 | Governance report & approval gates | accepted |
| F009 | Governance evidence reads resolve state dir | accepted |
| F015 | Loop no-progress reporting | accepted |
| F016 | Review blocker remediation | accepted |

典型命令：`amber governance report --target .` · `amber adoption report --target .`
产出：结构化 JSON/markdown 报告，含 readiness score 和行动清单

---

### 7. 受治理执行

在 policy + 单次 approval + git worktree 隔离 + 防篡改账本四道门后运行声明式命令。

| Feature | 标题 | 状态 |
|---------|------|------|
| F007 | Governed loop execution (ADR-0003) | accepted |
| F052 | Controlled Runner & Environment Boundaries | accepted |
| F056 | Registered External Side Effects | accepted |
| F057 | Break-glass Authorization | accepted |
| F061 | Ledger Family Factory & Decision Primitives | accepted |
| F062 | Route Stage Verbs & Named Governed Commands | accepted |

典型命令：`amber loop approve --contract daily-amber-triage` → `amber loop run --execute`
产出：执行账本条目 + 证据包，readyForLiveScheduling=false（需显式人工触发）

---

### 8. 知识与上下文

把会话证据蒸馏为带溯源的 Context Page；知识图谱映射 feature → code → ADR → wiki。

| Feature | 标题 | 状态 |
|---------|------|------|
| F017 | Governed Context knowledge lifecycle | accepted |
| F022 | Memory write-back pipeline | accepted |
| F023 | Learning write-back triggers | accepted |
| F028 | Durable owner routing for recurring friction | accepted |
| F059 | Knowledge & Decision Map | accepted |
| F060 | Knowledge Map v2 — code graph & interaction | accepted |

典型命令：`amber context request --page <id>` · `amber knowledge graph --json`
产出：`.amber/context/pages/` 下带块级溯源的 JSON 知识页；512 节点 / 1491 边知识图谱

---

### 9. 团队与工作流包

本地注册表管理工作流包、规则包、团队预设；版本可预览、可回滚。

| Feature | 标题 | 状态 |
|---------|------|------|
| F018～F021 | Workflow assessment, profiles, standards, packs | accepted |
| F033～F040 | Team distribution (V5): install/pin/update/rollback | accepted |

典型命令：`amber team install --preset typescript` · `amber pack inspect feature-standard`
产出：本地注册表元数据 + 兼容矩阵 + 差异预览（不自动覆盖用户定制）

---

### 10. Web 可视化

React + tRPC 查看器：实时会话时间线、路由定义、门控状态、知识图谱交互。

| Feature | 标题 | 状态 |
|---------|------|------|
| F008 | Web viewer (Phase C) | accepted |
| F041～F048 | Web toolchain upgrades (React 19, tRPC 11, Vite 8…) | accepted |
| F059/F060 | Knowledge Map web surface | accepted |
| F064 | Improvement Suggestions (web, multi-host) | in_progress |

典型命令：`cd apps/web && npm run dev`（localhost:5173 + localhost:3001）
产出：可视化 Session 生命周期 + 知识图谱交互界面

---

### 11. 安全与隐私治理

依存扫描、密钥检测、权限审查、数据保留——以声明式工作流包和 evidence receipts 呈现。

| Feature | 标题 | 状态 |
|---------|------|------|
| F055 | Retention, Coordinated Deletion & Proof | accepted |
| F057 | Break-glass Authorization | accepted |
| F058 | Instruction-Surface Adversarial Evals | accepted |

典型命令：`amber security audit --target .` · `amber eval run --suite instruction-surface`
产出：可审计安全报告 + eval 结果（assurance: replayable）

---

### 12. 高级信任基础设施

不可变账本、Principal Registry、Evidence Assurance、Gate/Policy 评估——所有上层能力的信任根。

| Feature | 标题 | 状态 |
|---------|------|------|
| F049 | Canonical Planning Artifacts | accepted |
| F050 | Decisions, Gates & Evidence Assurance | accepted |
| F051 | Read-only Adapters & Explicit Cutover | accepted |
| F052 | Controlled Runner & Environment Boundaries | accepted |
| F053 | Release Prepare, Deploy & Rollback | accepted |
| F054 | Deterministic Maintain & Intent Re-entry | accepted |
| F061 | Ledger Family Factory & Decision Primitives | accepted |

> **说明：** 这个能力域是基础层，普通用户通常通过上层命令间接感知，不需要直接调用。
