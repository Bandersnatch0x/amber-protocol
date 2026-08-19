# Amber Protocol 技术分享 · 演讲大纲

> 总时长约 45 分钟（正文 40 分钟 + Q&A 5–10 分钟），共 28 页。
> 配套详细文档：`docs/sharing/2026-08-amber-architecture-sharing.md`。
> 三个记忆点（全场反复呼应）：**① GLX 四道门　② 零 LLM 的契约蒸馏　③ 确定性路由（永不是 LLM 决策）**。

---

## 第一幕：问题（约 6 分钟）

### 第 1 页 · 封面：一句话开场（1 min）

- 标题：Amber Protocol——让 AI 辅助工程可审查、受门控、可交接
- 核心箴言："Execution is cheap. Trusted execution requires artifacts, gates, evidence, and handoff."
- 副题：仓库本地治理层（repository-local governance layer）

**讲稿提示**：不要寒暄，直接念这句箴言并停顿两秒。强调本场不讲"怎么让 agent 更快"，讲"怎么让执行变得可信"。

### 第 2 页 · AI 辅助工程的信任难题（2 min）

- 做了什么：改了哪些文件、依据什么决策？
- 是否安全可保留：通过了哪些检查，有没有绕过闸门？
- 如何交接：下一个 agent/人能否不靠聊天记录续作？
- 如何证明被审查过：审计时拿得出什么？
- 聊天转录回答不了这些问题：不在版本控制、不可校验、不可交接

**讲稿提示**：举一个真实感场景——"周五下午 agent 改了 30 个文件，周一接手的人只有一段聊天记录"。让听众代入自己团队的痛。

### 第 3 页 · 行业的反应与 Amber 的反问（2 min）

- 行业主流：更强的 agent 运行时（更大上下文、更聪明规划、更强执行）
- 反问：更强的执行能自动产生信任吗？
- Amber 的回答：把信任变成仓库内的显式工件
- 工件五件套：计划、闸门、账本、时间线、交接包

**讲稿提示**：这是全场立场页。用"执行越快，没留痕的风险越大"制造张力，引出"治理层"概念。

### 第 4 页 · 议程（1 min）

- Amber 是什么（定位与三层叙事）
- 架构与四道门
- 设计哲学与三个记忆点
- 适用场景与明确不做
- 竞品对比矩阵
- 实操 demo 路径
- 诚实边界 + Q&A

**讲稿提示**：快速过一遍即可，重点预告"四道门"和 demo 环节。

---

## 第二幕：Amber 是什么（约 5 分钟）

### 第 5 页 · 一句话定位与 Governance Console（2 min）

- 仓库本地治理层：不运行 agent、不执行项目命令
- 单一 CLI（`node scripts/amber.js`）生产、校验、审计、交接治理工件
- 目标仓库的可操作面叫 Governance Console（CLI + 工件输出，不是托管服务）
- 术语约定：叫 Amber Protocol，不叫 harness/framework/platform

**讲稿提示**：强调"它不是一个新运行时"。可以类比：agent 是施工队，Amber 是监理 + 档案管理。

### 第 6 页 · 治理层 vs 编排层 vs 执行层（3 min）

- 治理层（Amber）：回答"做了什么、是否可保留、如何交接、如何证明"
- 编排层：拆任务、派 subagent、组织并行（各类 harness 控制中心）
- 执行层：写代码、跑命令（Claude Code / Codex 运行时）
- Amber 刻意只占最上层：补充（complement）运行时，而非竞争
- 核心准则："Faster execution never beats clearer governance"

**讲稿提示**：画三层金字塔，把 Codex/Claude Code、Superpowers、Amber 分别钉在三层上。这张图后面竞品对比还会复用。

---

## 第三幕：架构（约 8 分钟）

### 第 7 页 · 七层控制模型（2 min）

- Governance（最高）→ Verification → Observability → Lifecycle → Context → Tooling → Execution（最低）
- 向安全加权：主线强化前三层
- Execution 刻意最小化，永不扩张成 agent 平台

**讲稿提示**：重点讲"Execution 优先级最低"这个反直觉设计——别人拼命加执行能力，Amber 刻意压住它。

### 第 8 页 · 代码组织：薄壳 CLI 与确定性核心（2 min）

- `scripts/amber.js` 仅 138 行薄壳，只做路由与输出
- command-registry + dispatcher：启动即校验命令与 handler 一一对应，缺失/孤儿即拒绝
- `scripts/lib/core/` 约 79 个核心模块（governed-runner、loop-policy、error-catalog…）
- schemas/ 13 个 JSON Schema（ajv 校验），action-types/ 8 个白名单

**讲稿提示**：强调"启动即校验、坏即拒绝"——治理工具自己先被治理。可快速展示 `amber --all` 区分核心命令与废弃命令。

### 第 9 页 · 声明式工件全家福（2 min）

- routes/ 3 个交付路由模板（feature-standard / bugfix-quick / refactor-safe）：描述结构、不执行内容
- workflow-packs/ 4 个、rule-packs/、templates/（init 的安全默认件）、profiles/
- skills/ 5 个 SKILL.md 唯一事实源，`gen:agents` 生成多平台产物
- `.amber/` 状态目录：sessions/governance/loops/context/worktrees

**讲稿提示**：用一句"全部是版本控制的文件"收束。举 `refactor-safe` 的"无绿色特征网不重构"为例说明 Route 是约束而非脚本。

### 第 10 页 · MCP：operational-ontology 的动词接口（2 min）

- P1 stdio MCP server：tools/list + tools/call，白名单坏一条整体拒绝启动
- P2 OAG 查询层：`amber.object.query` 分发到只读命令，闭环 query → decide → act → verify → learn
- F018 治理接缝六不变量：白名单制、只读免审批、变更必 approvalRequired、fail-closed、realpath 精确匹配、外部不得绕过

**讲稿提示**：六条不变量不必逐条念，抓两条讲透：只读才可免审批；变更类永远返回"需审批"且适配器绝不代跑。

### 第 11 页 · 记忆点①：GLX 四道门（2 min）

- Policy gate：rules.json deny-wins、`defaultAction: deny`，内置破坏性命令 deny 不可移除
- Approval gate：一次审批只授权一次运行（approvalKey 防重放）
- Isolation gate：独立 git worktree，主检出永不是 cwd
- Evidence gate：SHA-256 哈希链账本，`verify-ledger` 检测篡改

**讲稿提示**：全场第一个高潮。用一句话钉住："执行权没有被取消，但被收拢进唯一通道，每道门都有技术强制力，不是口头约定。"

---

## 第四幕：设计哲学（约 7 分钟）

### 第 12 页 · operational-ontology：名词 + 门 + 动词（1.5 min）

- 名词（Object）：session / route / wiki / evidence
- 门（Gate）：approval / verify / ledger
- 动词（Action Type）：类型化受治理事务，agent 通过治理面行动而非绕过它
- Evidence Recorder = timeline + ledger；Language = schemas

**讲稿提示**：用"本体论"串起前面的架构页——Amber 给 agent 世界定义了完整的名词、动词与门禁。

### 第 13 页 · 安全边界：写进产品，不是 TODO（2 min）

- read-only-first / dry-run 优先；init、wiki 幂等且永不覆盖已有文件
- `executesAnything: false` 强制携带；不带 `--execute` 就是 dry-run
- fail-closed 显式化（ADR-0011）："a check that cannot run = a failed check"
- 不变量：**不确定性只能向下流动，永不向上**（高置信受治理执行 → 中置信仅 dry-run → 低置信转人工）
- autonomous 模式被硬删：`session start --mode autonomous` 直接 exit 1

**讲稿提示**："不确定性只能向下流动"值得单独重复一遍。举 autonomous 模式被删除而非归档的例子，说明克制是产品决策。

### 第 14 页 · 记忆点③：确定性路由（1.5 min）

- `amber next --objective`：只读路由顾问，永不执行
- 对 route manifest 元数据做确定性关键词打分
- **永不使用语义检索 / embedding / LLM**（ADR-0014）
- 无匹配时建议走 plan gate，而不是猜执行路径
- journey-router 确定性给出 journeyId："不要发明第五条 journey"

**讲稿提示**：与 Superpowers 的"skills 自动触发（模型自主决策）"对比。反问："路由决策本身为什么可以交给概率系统？"

### 第 15 页 · Gates-Evidence：没有证据就只是声明（2 min）

- 闸门三类：Route Gate / Plan Gate / Adoption Gate；默认 advisory，可选 hooks 机械强制
- 阻断错误带稳定错误码（`AMBER_E_FEATURE_NO_EVIDENCE`），`amber explain` 解释
- `feature_list.json` 不变量：至多一个 in_progress，passing 必须有非空 evidence
- `session verify` 不带 `--execute` 只记 claim；`complete-check --strict` 要求已执行证据

**讲稿提示**：现场可念一段"完成声明"四要素（命令、结果/退出码、工件路径、剩余风险），强调证据分级是写进校验器的。

---

## 第五幕：场景与竞品（约 8 分钟）

### 第 16 页 · 适用场景与适合谁（2 min）

- 解决：reviewable by default、dry-run first、人工闸门显式化、上下文随代码库走
- 适合：用编码 agent 的个人、AI 重工作流小团队、需 onboarding/交接/审计的工程团队
- 典型场景：多 agent 协作治理、长周期交接、治理审计合规、上下文蒸馏、安全治理

**讲稿提示**：诚实定位——它不是给"随手用一下 agent"的人准备的，是给"把 agent 纳入工程流程"的团队准备的。

### 第 17 页 · 明确不做（边界即产品）（1 min）

- 不做动态工作流执行、不做 live 子 agent 派发
- 不做自动/无人值守（唯一例外：ADR-0003 四门门控执行）
- 不做调度/cron、不做外部写入（PR/通知）、不拦截工具调用
- 不是 agent 操作系统、不是 CI 替代品、不是项目管理 SaaS

**讲稿提示**：快速过，但强调"边界写进产品说明"本身就是信任材料。为下一页 ADR-0003 精确表述埋伏笔。

### 第 18 页 · 深度竞品：Superpowers（1.5 min）

- 定位：coding agent 的完整开发方法论（skills 库），生态最大、14+ 平台（star 数待确认）
- 机制：skills 自动触发、7 步工作流、强制 TDD、两阶段审查、subagent 并行
- 优势：开箱即用、方法论成熟、支持长时间无人值守
- 劣势：过程方法论而非治理层——无账本、无防篡改证据链、无 fail-closed、状态活在会话里、无 handoff bundle

**讲稿提示**：先充分肯定 Superpowers 的工程价值，再落到"它回答'怎么干好'，不回答'怎么证明'"。来源：github.com/obra/superpowers。

### 第 19 页 · 深度竞品：Trellis（mindfold）（1.5 min）

- 定位：开箱即用编码框架，specs/tasks/memory 持久化进仓库（约 4.4k stars 快照，待确认；AGPL-3.0）
- 机制：4 阶段自动循环 Plan→Implement→Verify→Finish，spec 自动注入，知识回写
- 与 Amber 共鸣：也是"文件即状态"
- 差距：无审计账本/防篡改证据、无 fail-closed 门控、无 handoff bundle（journal 只是弱近似）

**讲稿提示**：指出同名项目消歧（roots/trellis、微软 TRELLIS 均无关），体现调研严谨。Trellis 是最接近的共鸣者，但缺治理内核。

### 第 20 页 · 参照系：Spec Kit / Kiro / BMAD / 原生能力（1 min）

- Spec Kit：spec 驱动工具包，constitution ≈ governance rules，但不做审计/门控/交接
- Kiro：AWS 闭源 spec-driven IDE，状态绑定 IDE 与云服务（反面参照）
- BMAD：敏捷方法论 + 角色编排，决策显式但无强制门控
- CC/Codex 原生：Amber 依附的底座，提供执行不提供治理制品

**讲稿提示**：一页快闪，每个只讲一句差异。把 Spec Kit 标为"推荐直接对照"，听众最容易类比到它。

### 第 21 页 · 对比维度矩阵（证据页）（1.5 min）

- 七方 × 七维：定位层级 / 状态管理 / 安全闸门 / 交接连续性 / 平台支持 / 是否执行 / 学习成本
- 关键行：只有 Amber 是"否（执行）+ 四重门控 + handoff bundle"
- 关键行：学习成本 Amber 最高——如实承认

**讲稿提示**：这页信息密度大，只引导看两行：安全/闸门模型、交接/上下文连续性。详细矩阵见分享文档第六章。

### 第 22 页 · 差异化结论：卖点与短板都如实说（2 min）

- 七大卖点：治理面（F018）、确定性路由、fail-closed、handoff bundle、契约蒸馏、哈希链账本、极简依赖跨平台
- 五条短板如实说：生态规模差距、上手门槛高、价值依赖宿主配合、竞品在逼近部分特性、无机构背书
- 一句话收束：Amber 与竞品不在同一层竞争——过程层 / 制品层 / 治理层

**讲稿提示**：主动讲短板是本场的信任策略。强调"不比规模，比不可替代性"。

---

## 第六幕：实操与收尾（约 6 分钟）

### 第 23 页 · 核心命令生命周期（1.5 min）

- 主线：audit → init → governance report → next → plan → gate → verify → approve → handoff bundle → handoff validate
- 会话状态机：created → routed → executing ⇄ paused → completed/failed/aborted
- `created → executing` 非法：必须先 routed

**讲稿提示**：把生命周期图横着画成一条流水线，每一站标注产出的工件。强调每个箭头两端都有文件落地。

### 第 24 页 · 四条 journey（1.5 min）

- amber（路由器）：`next --objective` 确定性路由，路由选择绝不授权变更
- amber-delivery：计划→gate→会话→证据→审批→交接→验收的完整交付
- amber-diagnosis-adoption：诊断与修复治理，绝不静默改动用户文件
- amber-context-continuity：记忆点②的载体——契约→生成→审阅→ingest→Loadout
- amber-continuous-improvement：日常 triage 的受治理形态

**讲稿提示**：把四条 journey 比作"四个受治理的剧本"。提一句"不要发明第五条 journey"。

### 第 25 页 · 记忆点②：零 LLM 的契约蒸馏（2 min）

- 分工："Amber 拥有契约与闸门，宿主 agent 拥有生成"
- `context request` 写契约：带哈希的源引用、目标 schema、硬约束、机器可检验收错误码
- 宿主 agent 生成；`ingest` 校验入库：块级引用出处，`unknown` 是一等 block 类型
- Amber 永不调用 LLM：零 LLM、仅 ajv 依赖、离线可用、确定性
- Loadout：任务级上下文组装，词数预算约 4000，缺失必备工件 fail closed

**讲稿提示**：全场第二个高潮。对比 Trellis 的"全量注入 spec"——Amber 是"按需蒸馏 + 可验证"。强调这个子系统本身不花一分 token。

### 第 26 页 · 从零落地：12 步 demo 清单（2 min）

- 安装 → audit（只读体检）→ init → wiki → doctor → governance report
- → next（确定性引导）→ plan + gate → session 四连（start/verify/complete-check/approve）
- → context 闭环（request → ingest --confirm → verify）→ handoff bundle + validate → （可选）web viewer
- **demo 前务必先在临时仓库完整演练一遍**

**讲稿提示**：若现场做 live demo，选 2、6、7、8、11 五步最有冲击力；其余用截图。提醒先演练，因为调研未实跑验证。

### 第 27 页 · 诚实边界与注意事项（1.5 min）

- ADR-0003 精确表述："人工触发、四门门控、单次授权、哈希链留痕"——"Amber 不再执行"已不严格成立
- 不引用 legacy 目录与未落地能力（事件重放、SQLite 持久化仍是"可吸收点"）
- 竞品 star 数是快照数据；Amber 社区规模无公开数据，回避量化对比
- 边界说清楚，反而建立信任

**讲稿提示**：这页展示项目的工程诚实。可直接引用"我们不再执行这句话已不严格成立"这种自我纠偏表述。

### 第 28 页 · 收尾：回到那句箴言（1 min）

- 重申："Execution is cheap. Trusted execution requires artifacts, gates, evidence, and handoff."
- 三个记忆点回顾：GLX 四道门 / 零 LLM 契约蒸馏 / 确定性路由
- 一句话总结：Amber 不让你跑得更快，让你的每一步可以被审计、被交接、被信任
- 进入 Q&A

**讲稿提示**：收尾不超过一分钟，把三个记忆点各用一句话砸一遍，然后干脆进入 Q&A。

---

## Q&A 预备问题

### Q1：Amber 和 Superpowers 是什么关系？能一起用吗？

**答**：不在同一层。Superpowers 是过程方法论（编排/执行层，教 agent 怎么干活），Amber 是治理层（证明干的事可审查、可交接）。两者可以叠加：Superpowers 驱动工作流，Amber 提供账本、闸门与交接包。区别在决策机制——Superpowers 靠 skills 自动触发（模型自主），Amber 靠确定性路由（永不 LLM）。

### Q2：为什么不直接做成 agent 运行时？

**答**：这是刻意的产品决策（七层模型中 Execution 优先级最低）。运行时赛道已有 Claude Code / Codex 等强底座，且"更强的执行"不解决信任问题。Amber 的价值恰恰在于平台无关：通过 skills 适配 5+ 平台 + MCP，治理状态随仓库走，不绑定任何运行时。ADR-0003 明确定位是 supplement 而非 compete。

### Q3：学习成本高怎么办？（35+ 命令、gates/evidence/loadout 概念体系）

**答**：如实承认这是短板。缓解路径：① `amber next` 是确定性引导，新用户跟着它走即可，不需要记全命令表；② 四条 journey skill 把常用流程编排成剧本；③ `governance report` 输出的下一步自带精确命令；④ 建议渐进采纳——先只用 audit → init → doctor → handoff 最小子集。

### Q4：如果宿主 agent 无视治理工件，Amber 是不是形同虚设？

**答**：这是已知短板（依赖宿主配合）。但 Amber 的强制力来自三个不依赖 agent 自觉的机制：① MCP governance seam——变异操作必须 approvalRequired，适配器不代跑；② `hooks install` 后 pre-commit 机械强制，绕过 agent 直接拦 commit；③ fail-closed——治理状态损坏/检查无法运行一律失败。agent 可以不读工件，但过不了门。

### Q5：Amber 自己会调用 LLM 吗？

**答**：不会，且是明确决策（ADR-0009 拒绝引入 LLM 依赖）。运行时依赖仅 ajv + ajv-formats，离线可用、完全确定性。上下文蒸馏的分工是"Amber 拥有契约与闸门，宿主 agent 拥有生成"——LLM 算力由宿主提供，Amber 只负责校验出处、哈希与验收条件。

### Q6：企业采用有什么信任材料？（相对 AWS/GitHub 背书）

**答**：如实说没有机构背书是短板。替代信任材料：MIT 许可、16 个 ADR 完整决策记录、c8 覆盖率门槛（lines 84/functions 90）、CI 四件套必过、防篡改哈希链账本本身、以及 fail-closed/单次授权等可验证的安全语义。企业评估建议先在隔离仓库试点。

### Q7：`amber loop run --execute` 存在，那"Amber 不执行"还算数吗？

**答**：精确表述是"人工触发、四门门控、单次授权、哈希链留痕"（ADR-0003 Consequences 的自我要求）。执行权存在但被收拢进唯一通道：rules.json deny-wins、一次审批只授权一次运行、独立 worktree 隔离、哈希链账本可检测篡改。这不是文字游戏，四道门各有独立的技术强制点。

---

## 附：时长分配汇总

| 幕 | 页 | 时长 |
|---|---|---|
| 问题 | 1–4 | 约 6 min |
| Amber 是什么 | 5–6 | 约 5 min |
| 架构 | 7–11 | 约 8 min |
| 设计哲学 | 12–15 | 约 7 min |
| 场景与竞品 | 16–22 | 约 10 min（时长吃紧时压缩第 20、21 页为快闪） |
| 实操与收尾 | 23–28 | 约 6 min |
| Q&A | — | 5–10 min |

正文合计约 42 分钟，加 Q&A 控制在 45–50 分钟；若必须压到 45 分钟以内，优先砍第 4 页（议程）、第 9 页（工件全家桶）与第 20 页（参照系）。

*大纲完。所有事实性内容以详细分享文档为准；待确认数据（竞品 star 数等）已按调研标注处理。*
