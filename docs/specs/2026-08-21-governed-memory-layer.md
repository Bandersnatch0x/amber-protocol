---
type: spec
title: Governed Memory Layer（受治理记忆层）实现 Spec
description: 把 Amber 分散的记忆原语收敛为显式受治理记忆层：四层模型、条目 registry、写回闸门、晋升规则、dreaming 维护 loop 与动词表面的完整机械定义。
status: draft-v1
date: 2026-08-21
method: 六轮圆桌终审裁决（#171/#170/#172/#173/#174/#175，均 decision-complete）→ 忠实综合 + 裁决留白的最简机械落地
tags: [memory, governance, promotion, dreaming, registry, mcp]
---

# Governed Memory Layer 实现 Spec

> 本 spec 将 wayfinder map #169 六轮终审裁决固化为实现级机械定义：四层记忆模型（L1–L4）、条目对象与 entry registry、写回闸门（T1/T2 双触发 + ingest→approve→book 晋升序列）、α/β/γ 预算闸门、dreaming 维护 loop 契约、五动词表面与 MCP 恰 3 工具、memory-* 事件账本、schema 与错误码族、单一实施批次（批次 A）与验收标准。撰写纪律：只综合不决策——一切治理取舍以裁决书为准；裁决留白的落地项由本 spec 给出最简可执行定义并标注 **Spec-defined（裁决留白落地）**；本 spec 与裁决冲突时以裁决为准并记入偏差表（#174-M13；当前偏差表为空）。

**Date:** 2026-08-21 ｜ **Status:** draft-v1（待评审）｜ **ADR:** [ADR-0018 Governed Memory Layer](../adr/0018-governed-memory-layer.md)

**Tracker:** map [#169](https://github.com/Bandersnatch0x/amber-protocol/issues/169) · #171 业界调研 · [#170](https://github.com/Bandersnatch0x/amber-protocol/issues/170) 对象模型 · [#172](https://github.com/Bandersnatch0x/amber-protocol/issues/172) 写回闸门 · [#173](https://github.com/Bandersnatch0x/amber-protocol/issues/173) 晋升规则 · [#174](https://github.com/Bandersnatch0x/amber-protocol/issues/174) dreaming loop · [#175](https://github.com/Bandersnatch0x/amber-protocol/issues/175) 动词表面

---

## 1. 范围与目标

把 Amber 分散的记忆原语（session transcript/ledger、handoff bundle、context Loadout、docs/wiki、MEMORY.md、notes.md、learnings）收敛为一个显式的、受治理的记忆层，补齐三类动词生命周期：

1. **自动触发的写回闸门**（auto-triggered write-back gate）——Amber 检测 + 闸门、agent 生成、人审批；
2. **dreaming 式后台维护**——去重、陈旧检测、蒸馏提案，挂载为受治理 loop 契约；
3. **分层晋升规则**——session 级记忆 → 长期记忆的晋升标准与闸门。

交付形态：[ADR-0018](../adr/0018-governed-memory-layer.md) + 本 spec。治理红线全程不破：read-only-first、never-overwrite-user-files、`executesAnything: false`、Amber 零 LLM、Amber 永不自己写知识文档。

**Out of scope**（继承 map #169）：跨仓库/跨团队共享记忆层（repository-local 边界外）；embedding/向量库语义检索（本轮保持文件基、确定性）；多 agent swarm learning / agent 间记忆同步（依赖同步运行时，属 #141 域）。

## 2. 条款引用约定与闭集总表

### 2.1 条款引用格式

裁决条款一律限定引用 `#NNN-Mn` / `#NNN-Qn` / `#NNN-Xn`（M 编号在 #172/#174/#175 三份裁决中重复使用，语义不同——如 #174-M7 是 γ 168h 滚动窗口，#175-M7 是 status 三段投影——无限定即歧义）。#172 另用 A1–A4（审批）/B1–B3（复用边界）/C1–C5（载荷）/F1–F4（失败回退）前缀；#173 无 M 编号，按 Q1–Q6 引用；"系统性一/二/三…"指各裁决书的系统性裁决小节。

### 2.2 五个闭集总表

| 闭集 | 合法值 | 出处与扩列规则 |
| --- | --- | --- |
| 事件 kind（5 值） | `memory-request-created` / `memory-ingest` / `memory-approval` / `memory-book` / `memory-abandon` | #172-系统性一钉死；#175-系统性四重申不扩不增 |
| provenance.channel（8 值） | `dreaming-maintenance` / `t1-writeback` / `t2-writeback` / `distill-conversion` / `maintenance-conversion` / `evolution-conversion` / `regression-conversion` / `human-escape-hatch` | #174-M11；用于归因统计，不作配额分区 |
| 资格信号（6 项，版本化） | 见 §6.1（含 Spec-defined 的信号 id 映射） | #173-Q1；增删须与 #173 同级裁决，spec/实现方不得扩列 |
| targetSurface（4 值） | `MEMORY.md` / `docs/wiki` / `docs/adr` / `docs/specs` | #173-Q4；扩列须裁决程序 |
| knowledgeKind（7 枚举） | `invariant` / `decision` / `pattern` / `failure` / `rejected-approach` / `external-constraint` / `unspecified` | 复用 `schemas/context-request.schema.json` 既有枚举（#172-C1） |

## 3. 四层记忆模型（L1–L4）

### 3.1 层定义（#170-Q1，decision-complete）

层 schema = 三元组 **writer stance（谁写、走什么管道）× volatility class（易失性）× mutation policy（变更策略）**。

| 层 | 载体 | writer stance | volatility | mutation policy |
| --- | --- | --- | --- | --- |
| L1 会话层 | ledger/transcript/notes.md/session plan | Amber/agent 自由写入 | clean-scoped | ledger append-only；notes 自由编辑 |
| L2 可携层 | handoff bundle / session-handoff.md | Amber 按需重建 | 可覆盖 | overwrite-rebuild |
| L3 人治层 | docs/wiki/、MEMORY.md | 仅人手可写，Amber 只读 + 登记 | durable（git 承载） | human-curated |
| L4 蒸馏层 | `.amber/context/pages/` + memory entry registry | 契约管道（agent 生成、Amber 验收） | 可重建（§3.5） | supersession-only |

### 3.2 12 格矩阵（#170 强制条款：逐格填满，任何留空即 spec 不完整）

| 层 | create | invalidate | retire |
| --- | --- | --- | --- |
| L1 | CLI 确定性写入（session 命令族；ledger 追加；notes/plan 由 Amber/agent 自由写） | `amber clean` 整层清除（L1/L2 invalidate 语义唯一载体） | 不适用——整层清除即退役，无条目级 retire |
| L2 | handoff bundle 生成（Amber 按需重建） | 重新 bundle 即失效旧版（overwrite-rebuild 的独立失效语义） | 不适用——旧版被覆盖重建替代，无独立 retire 动词 |
| L3 | 仅人手写入（Amber 只读；`book` 的 surface 哈希登记是登记非写入） | 不适用（durable，git 承载，无 clean 语义） | 人批准 supersession 后由**人手**移除 MEMORY.md 文本，Amber 仅在 registry 记账 |
| L4 | `ingest` 验收准入（条目成为 proposal）；registry 依 §3.5 契约重建 | 漂移检出即失效/复审：源漂移（`AMBER_E_MEMORY_SOURCE_STALE`）或 surface 漂移 → `needs-re-review` | supersession 唯一（active→superseded，β 指针驱动）；abandoned 为账本终态标记（§5.6） |

### 3.3 权威序（两权威表述，勿简化为单一权威）

registry 是**条目状态与 provenance 的权威**；MEMORY.md 是**人类阅读面与其内容文本的权威**；两者不一致时条目进入 `needs-re-review` 复审态，任何一方不得静默胜出（#170-Q2）。管辖维度切分（#173-Q2 优先级宣告）：L3 层定义管辖"能力"——人永远有权直接写 MEMORY.md，不可剥夺；晋升动作序列管辖"受治理管道"——唯一产生 registry 身份、审计事件、血统链与权威转移效力的路径。人直编是合法 L3 mutation 但不是晋升动作，产生"带外人治修订"（out-of-band amendment），须经 `book` 追认方可并入治理账本（§5.5）。

### 3.4 L2 条件降级条款

若 spec 阶段证明 L2 与 L1 全部属性格重合，允许降级为 L1 的 projection 标记（#170 条件条款）。本 spec 判定**不触发**：L2 的 mutation policy（overwrite-rebuild）与 invalidate 语义（重新 bundle 即失效旧版）两格独立于 L1，属性格不完全重合。

### 3.5 registry 易失性与 re-admission 契约（#170 残余风险条款）

registry 归类为**可重建目录**（CONTEXT.md："Its catalogs and indexes are rebuildable"）：条目内容自足（provenance 内嵌 excerpt + 哈希），supersession 链由条目内指针承载。`clean` 后活跃条目经 re-admission 从 L3 幸存 surface + git 历史重建，损失上限 = 退役历史（superseded/abandoned 不要求重建，#172-F3）。

**re-admission 验收条件**（#170 要求 spec 提供重建契约的验收条件）：

1. `clean` 后 `amber memory status` 显示零条目；
2. 按 §10.3 条目分隔结构确定性解析 MEMORY.md，得 N 个现存条目；
3. 逐条经逃生舱 `amber memory request`（channel=`human-escape-hatch`，provenance 指向 surface 编辑事实：surface 路径 + 时间 + normHash）→ ingest → approve → book；
4. 终态 `status.entries.active == N`，doctor 账本-registry 一致性零 error（重建走完整管道，新账本自然一致）；
5. 退役历史不重建，`status.entries.abandoned`/`superseded` 计数允许归零（审计轨迹已随旧账本消亡，损失上限条款）。

## 4. 条目对象模型

### 4.1 条目状态机（5+1 态，#170-Q2 decision-complete）

```
draft ──ingest 准入──▶ proposal ──approve──▶[人写入 MEMORY.md]──book 登记──▶ active ──supersession（β pair）──▶ superseded
  ▲                      │ │                                        │                          │
  └──approve reject──────┘ │└─人显式 abandon / 血统链 ingest 拒绝累计 3 次──▶ abandoned（账本终态标记；active/needs-re-review 同路可达）◀┘
active ──surface/源漂移检出──▶ needs-re-review ──重新 book 登记当前哈希（复位）──▶ active
needs-re-review ──β 指针 supersede / 人显式 abandon──▶ superseded / abandoned
```

| 迁移 | 触发 | 记账 |
| --- | --- | --- |
| draft→proposal | ingest 验收准入 | `memory-ingest` |
| proposal→active | approve 之后人写入 MEMORY.md，`book` 登记 surface 哈希 | `memory-approval` + `memory-book` |
| proposal→draft | `approve --decision reject`（reason 强制非空） | `memory-approval`（reject）+ 条目 `lastRejection` |
| active→superseded | β pair：approve 批准带 supersedeTarget 指针的条目，同调用原子完成 | 同调用两条 `memory-approval` 事件 |
| active→needs-re-review | surface normHash 漂移 / 源漂移检出（doctor） | 状态字段迁移 + doctor 发现 |
| needs-re-review→active | 重新 `book` 登记当前 surface 哈希（**Spec-defined 复位通道**：五动词闭集下唯一在系统内的复位路径，复用 book "登记 surface 与哈希"的已裁语义） | `memory-book` |
| needs-re-review→superseded / abandoned | β 指针 / 人显式 abandon | 同上对应事件 |
| 任意态→abandoned | F1(i) 自动（血统链 ingest 拒绝累计 3 次，不经动词表面）/ F1(ii) 人显式 | `memory-abandon` |

**红线**：任何状态迁移均不产生物理删除（#170）。abandoned 是账本终态标记而非晋升态，不加入晋升路径（#172-F1）。

**Spec-defined 澄清（源漂移复位语义）**：源漂移（`AMBER_E_MEMORY_SOURCE_STALE`）条目经"重新 book 登记当前 surface 哈希"复位，只复位 surface 哈希登记，不重绑 provenance 源哈希；若源持续漂移，doctor 规则 2（§11）复查将再次标记 needs-re-review——此为预期行为而非振荡缺陷。持久解为 supersede（新条目替代旧条目）或 abandon（终态），二者均为状态机已裁迁移（#170），不引入新路径。

### 4.2 entryId 与 entry registry

- `entryId` = 内容哈希身份（sha256；规范化定义见 §10.2）——修订内容即新 entryId（#172-F2 血统语义的基础）。
- entry registry 落盘 `.amber/memory/registry/`（JSON/JSONL，可重建目录），新增独立写入函数 `writeEntry`（#172-B2 命名建议）；registry 中**永远只存在单个条目对象**，数组只存在于 request 载荷与 ingest 入口（#172-C1）。
- registry 对 L3 文本只建立**文件级 surface 绑定 + book 时哈希快照**（F023 learningWriteBack 现役形态），从不解析条目行、从不写人治文件。

### 4.3 与 context page 管道的复用边界（#172-B1/B2/B3）

- **部件强制复用**：`context-hash`（rawHash/normHash/sha256）、`context-store.appendEvent`、ajv 验收模式、`acceptance {check, code}`、`checkRequestBinding` 逐源哈希防伪、no-change rebase 语义、`resolvePathWithin` 路径安全、error-catalog 分层与 verify/doctor 汇总（D8 判例）。
- **拓扑强制同构**：`request（契约）→ 宿主 agent 按契约生成 → ingest 机械验收 →（新增）人工批准 → book`，与 ADR-0009 的 `request → 生成 → ingest → write` 逐段对应，唯一插入点是人工批准。
- **不走 writePage**：`writePage` 与 `docs/wiki/context-index.md` 重建不在复用范围；拓扑复用不蕴含末端写入函数复用；条目不是页，context-index 不被记忆操作重建。
- **schema 同族**（B3 概要，字段落地见 §10）：新增两 schema 与 context-request/context-page 同族；删去 maxWords/requireCitationPerClaim 页级约束，保留 forbidNewFacts；provenance 由内嵌 excerpt + 哈希 + 反向指针强制承载；禁止平行验证**机制**（平行 schema 文件不构成平行体系）。

## 5. 写回闸门（write-back gate）

### 5.1 双触发点 T1/T2（#172-Q1 采纳 (c)，附 M1–M3）

| 触发点 | 挂载点 | 机械条件 | 归因 channel |
| --- | --- | --- | --- |
| T1 session 侧 | `completeSession`（`scripts/lib/session-commands.js`）状态迁移成功**之后**（#172-M1；complete-check 保持零副作用纯只读） | complete-check strict 通过 ∧ `hasHandoffEvidence` 为真（#172-M2；不引入路径分类、不触碰 F028/TRIGGER_CATEGORIES 冻结面） | `t1-writeback` |
| T2 feature 侧 | feature accept 流程中写回类别命中处（复用 `detectWriteBackTriggers` 判据与 F023 owner 路由；**Spec-defined 定位**：与 F023 learningWriteBack 同一触发位点） | feature accept ∧ 路径类别命中（确定性判据，零语义判定） | `t2-writeback` |

- **M3（噪声不耗预算）**：触发产物仅为 request（契约文件 + 事件记账）；宿主 agent 可用 ADR-0009 既有 `outcome:"no-change"` 合法空结果应答；γ 只计"获准入 registry 的 proposal 数"，不计触发数与 request 数。
- **排他规则**：同一触发事件恰一个 open memory request；一份 request 载多条目（#172-Q2 处置）。
- **人工逃生舱**：`amber memory request` 为补充入口（#172-Q1(d)），不免除 T1/T2 自动义务；不受信号地板约束（#173-Q1.2 人治主权通道）。一个 session 同时改 schema 又踩流程坑 → 两侧各自触发、各产各的 request（两个独立事实，非分配歧义；重复知识由内容哈希去重下游消解）。

### 5.2 request 载荷与生命周期（#172-C1/C5）

载荷为 `entries[]` 数组（每元素结构见 §10.1/§10.2），"数组→N 条目"是 **ingest 准入的内部行为而非状态机迁移**（#172-C2：状态机保持 5+1 态作用于单条目，数组从不落盘为对象）。**C5 请求生命周期**：request 在其原始获准 entryId 全部到达终态处置（active / rejected-draft / abandoned）时记为 resolved；条目被拒后的修订内容（新 entryId）经**新 request** 提交，`derivedFrom: <requestId>` 维系血统并**继承父 request 拒绝计数**。

### 5.3 ingest（机械验收，全有或全无）

五段验收逐元素执行：ajv → `checkRequestBinding` 逐源哈希比对 → provenance 哈希校验 → α 预算（§6.3）→ γ 限速（§6.5）；通过后逐条目写入 registry，各自独立成为 proposal。

- **C4（γ 接口）**：单次提交全有或全无——`entries[]` 超当期剩余 γ 配额即整体拒绝（`AMBER_E_MEMORY_RATE_LIMITED`），request 保留，缩减后重交；无"部分入账部分挂起"半状态。
- **signal 校验落点**（#174-M13）：request 的 `provenance.signal` 取值 = §6.1 闭集信号 id 之一；转换类与 dreaming 通道缺失或不属闭集即 ingest 拒绝（`AMBER_E_MEMORY_SIGNAL_INVALID`）；T1/T2 与逃生舱通道按吸收规则/豁免条款免于强制（§6.2；**Spec-defined 通道清单**）。
- **排序留痕**：准入时点按 K1/K2/K3 对混合池排序，结果随 `memory-ingest` 事件载荷留痕（§6.5、§9）。
- `outcome:"no-change"` 合法（M3）；ingest 拒绝 = 不入 registry、事件记账（`outcome:"rejected", code`）、request 保留重交（逐字沿用 `context-ingest.js` 判例，#172-F1）。

### 5.4 approve（唯一人工闸门，条目级）

- **A1 粒度**：每次调用处理**恰好一个 entryId**（复用 `validateBookingOwner` "强制恰好一个"范式）；批量提案以脚本化循环逐条审批表达，人的审查粒度永不从"条目"退化到"批"。
- **A2 留痕**：审批记录只写两处——(i) `events.jsonl` 的 `memory-approval` 事件 `{entryId, requestId, decision, reason?, decidedBy:"human", at}`；(ii) registry 条目状态字段。不产生 `decision.json`、不写 loop ledger、不动 session timeline（18 种事件深锁）。
- **A4 拒绝驱动迁移**：`--decision reject` 时 `--reason` 强制非空（handler 校验），proposal→draft，拒绝理由记录于事件与条目 `lastRejection`。
- **C3 β pair 原子性**：批准带 `supersedeTarget` 指针的条目时，同一调用原子完成 pair——新条目获准 + 被指条目 active→superseded，两条事件同调用写入；部分批准天然成立（未决条目停留 proposal 直至终态处置）。
- **A3 身份门**：非 TTY 无 `--yes` 即拒绝；templates 指示 agent 永不传 `--yes`；`COMMAND_CAPABILITIES` 注册 `approver:"human"`；MCP F018 下 mutating Action approval-required。
- **spec 约束**（#173-Q1）：approve 命令输出须展示 creed（`templates/MEMORY.md` 准入/排除全文）提示，使语义标准在决策点机械在场；机械信号不是 creed 的语义代理，前瞻语义判断的法定执行点是 approve 时的人。

### 5.5 book（surface 登记 + 双轨追认）

- **主轨（governed-promotion）**：approve 之后，人（或人明确指令下的宿主 agent）将条目文本写入 MEMORY.md，`book` 只读登记 MEMORY.md 当前 normHash 入 registry（不写文件、不解析条目行）、条目 proposal→active；后续哈希漂移使条目进入 needs-re-review（#170 surface 哈希登记条款）。
- **批量**：book 可批量登记同一 MEMORY.md 哈希下的多条目 → active（#172-系统性二）。
- **origin 双值**（#173 追认强化 1）：book 必须记录来源类别 `origin ∈ {governed-promotion, human-direct-ratification}`。
- **追认轨（human-direct-ratification）**：人直编 MEMORY.md 后经 book 追认并入治理账本。**Spec-defined 机械形态**：追认 book 直接在 registry 创建 active 条目（无前置 request/ingest/approve），provenance 指向编辑事实本身（surface 路径 + 时间 + normHash），knowledgeKind 由人选择（7 枚举含 `unspecified`），targetSurface=MEMORY.md；追认非 ingest 准入，故不耗 γ；α 经 MEMORY.md 物理计数天然覆盖（内容已在文件中）。
- **无前置 approve 事件的 book 触发 doctor 告警**（ratification-class 提示，#173 追认强化 2，见 §11）。
- **β 前提**（#173 追认强化 4）：supersedeTarget 只能指向 registry 内条目——直编内容欲被 supersede，先 book 追认。
- **book 时 git 检测**（#173-Q6）：登记时检测目标 surface 不在 git 追踪范围 → 输出非阻塞 warning。
- **needs-re-review 复位**：对 needs-re-review 条目重新 book 登记当前 surface 哈希 → active（§4.1）。
- **权威转移条款**（#170-Q3）：晋升批准即权威转移至 consumer-owned 条目，源 notes 片段降为历史残留；反向指针是 best-effort provenance metadata 非承重结构，目标消失不得使条目失效（对照 `AMBER_E_CONTEXT_SOURCE_MISSING` 对 immutable source 仅 informational 的判例）。

### 5.6 abandon 与失败回退（#172-F1–F4）

- **F1 双入口**：(i) 同一 request（含 derivedFrom 血统链）ingest 拒绝**累计 3 次** → request 与名下条目全部转 abandoned（系统内部状态迁移，**不经任何动词表面调用**，仅以 `memory-abandon` 事件记账，#175-M2）；(ii) 人显式 `amber memory abandon --request/--entry`（两语义后果由参数选择表达；归因区分由事件载荷 `triggerSource` 承载，**Spec-defined 字段**见 §9）。
- **F2 计数与重置**：拒绝计数按血统链累计，唯一重置方式 = 新的自动触发产生新 requestId；人工 derivedFrom 重开不重置；审批拒绝不计重试次数（修订即新条目，受 γ 天然限速）。
- **F3 与可重建目录和解**：abandoned 永不物理删除，但 registry 重建时**不必重建** abandoned 条目（审计轨迹已永存 events.jsonl）。
- **F4 消费面过滤**：loadout/governance/web 读取一律过滤 abandoned；doctor 只报统计 warning。
- **ceremony 上限**（#172-系统性二）：一次触发 → 1 request（1..N 条目）→ 1 ingest（全有或全无）→ N 次条目级 approve → 1 book；稳态人工 ceremony 上限 = γ = 5 审批 + 1 book / 周期，机器 ceremony O(1)/触发。

## 6. 晋升资格与预算（α/β/γ）

### 6.1 信号闭集（机械地板 + 人治天花板，#173-Q1）

机械信号是**自动提名通道的必要非充分资格条件**（地板）；creed 语义判断的法定执行点是 approve 时的人（天花板）。信号不是 creed 的语义代理，只回答"该候选是否有资格被看见"。闭集 6 项（版本化；增删须与 #173 同级裁决，spec/实现方不得扩列）：

| # | 语义（裁决原文） | signal id（Spec-defined，供 provenance.signal 引用） |
| --- | --- | --- |
| 1 | break-loop recurrence ≥ 2 | `break-loop-recurrence` |
| 2 | distill count ≥ 2 | `distill-count` |
| 3 | executed evidence | `executed-evidence` |
| 4 | F023 类别命中 | `f023-category-hit` |
| 5 | evolution finding 复发 ≥ 2 | `evolution-recurrence` |
| 6 | T1/T2 触发条件本身 | `t1t2-trigger` |

spec 约束：dreaming proposal 必须引用闭集信号之一，**禁止单次顿悟检测器**；governance report 须展示"人工提名 vs 自动提名比例"（通道占比经 provenance.channel 归因），使地板偏置可观测。

### 6.2 T1/T2 吸收与三流转换（#173-Q1.3 / Q3）

- **吸收规则（非叠加）**：T1/T2 触发即视为满足资格地板，资格闸不得叠加于其上再增条件；信号地板仅对**无既有触发器的通道**（三流转换、未来 dreaming proposal）生效。
- **三流转换**：distill candidates、maintenance proposal（含 Evolution Rollup 与 regression proposals）经 `amber memory request` 人工转换为记忆提名；转换须过信号地板（三流候选天然携带 recurrence/count 信号）并走完整 ingest→approve 管道。逃生舱 request 本身不耗 γ，转换产物经 ingest 准入时计入 γ（#172-M3 口径）。
- **合法对象约束**：转换仅限候选中的**决策知识成分**（"为何/应当如何决策"）；行为性修正（regression test、standard diff）留在原管道落行为面；approve 时审批人以 creed 排除项第 4 条（仓库已自记的机械事实）为拒绝依据，A4 reason 留痕。
- **双权威规则**：同一候选同时走行为面晋升与记忆转换时，目标物不同不构成权威重复；若记忆条目与已落面 standard 表述同一事实，适用 β supersede 逻辑（提名人声明 supersedeTarget 或 approve 时说明分工）；转换 request 的 provenance 反向指针使两条管道关联可被 doctor 审计。

### 6.3 α 预算闸门（#173-Q5 钉死）

- **计数对象**：MEMORY.md 的 **surface 物理量**（不计 registry 条目数）——条目数 = MEMORY.md 中条目分隔结构（§10.3）的确定性解析计数；字节数 = 文件归一化后字节数。两者零语义判断、可机械扫描。
- **初始值**：**条目数 ≤ 50 ∧ 字节数 ≤ 8 KB**（明文标注：先验值，非实证值）。
- **闸门语义**：预算耗尽时晋升准入被机械拒绝（新 proposal 排队而非旧条目被删），fail-closed 零删除；α 拒绝输出必须携带 remedy 指引（拆分为多条、或经 β 指认 supersedeTarget 腾出预算），**禁止裸拒绝**。
- **准入算术（Spec-defined）**：预算耗尽状态 = 当前条目数 ≥ 50 或当前字节数 ≥ 8192；该状态下 ingest 拒绝 targetSurface=MEMORY.md 的新准入（`AMBER_E_MEMORY_BUDGET_EXCEEDED` + remedy）；未耗尽时准入检查 = 当前条目数 + 本批拟准入 MEMORY.md 条目数（β pair 被指条目计入腾出）≤ 50 **且** 当前字节数 + Σ 该批 bookText（§10.3）字节数 ≤ 8192。
- **50% 强制复审**：任一维度首次达到 50% 利用率（25 条或 4 KB）时 doctor 输出强制复审提示（§11）。
- **调整程序**：调整须走与 #173 同级裁决议题；批准调整时若存量超限，迁移计划随裁决一并钉死，禁止"先调数后处置"。

### 6.4 β one-in-one-out（#170 条款 β + #172-C3）

预算耗尽状态下，提案获准的**必要条件**是提名人指明被 supersede 的既有条目（`supersedeTarget` 一对一指针）且该 supersession 同批获人批准——"进一条必须出一条"，膨胀数学上封顶为预算值。指针只能指向 registry 内条目（直编内容先 book 追认）；approve 批准带指针条目时同调用原子完成 pair（§5.4）。

### 6.5 γ 提案限速与 K1/K2/K3 排序（#174-M7/M14/M16）

- **分母 = 168h 滚动窗口**（#174-M7）：γ 的"周期"不是 cadence 声明、不是自然周、不是 lastRunAt 间隔——任一准入时刻 T，γ 消耗 = `events.jsonl` 中 `[T−168h, T]` 窗口内 `memory-ingest` 准入事件条目数；≥5 即 `AMBER_E_MEMORY_RATE_LIMITED` 全有或全无拒绝（#172-C4 口径不变）。零状态文件，兼容任何触发形态；cadence 数值仅表达维护意图频率，不承载机械语义。
- **计数域 = 排序域 = 全准入混合池**（#174-系统性三/M16）：dreaming + 三流转换 + T1/T2 写回的全部 ingest 准入；dreaming 无专属配额，通道差异只经 channel 归因统计，不作配额分区。
- **K1（staleness，降序）**：候选针对既有条目 → 该条目最近一次 memory-* 事件距准入时刻天数；新增候选 → provenance 引用的闭集信号产物/触发工件（distill 提案文件、maintenance 提案、evolution finding、session/feature 触发工件）的最新落盘时间距今天数（**Spec-defined 补全**：T1/T2 通道候选取触发工件时间戳）。
- **K2（β 压力，降序）**：候选条目被其他条目 `supersedeTarget` 指向的计数；零指向即 0，自然退化。
- **K3（tiebreak，升序）**：entryId 内容哈希字节字典序——拒绝 FIFO（到达顺序是外部状态，跨批次/重建后不可复现；确定性优先于先到先得）。排序结果随当次 `memory-ingest` 事件载荷留痕（候选序列 + 各键值），使截断可审计。
- **C4 × M14 合成语义（Spec-defined）**：准入时将当次提交候选 + 排队中未准入候选（保留待重交 request 的条目）合并排序、截断至窗口剩余配额；**当次提交的全部候选均落入获准集 → 整体准入，否则整体拒绝**（RATE_LIMITED + ranking 留痕）——既保 #172-C4 全有或全无原子性，又使 #174-M14 混合池截断在跨请求竞争时点生效。

## 7. dreaming 维护 loop（#174）

### 7.1 契约骨架（#174 附录 decision-complete，逐字）

```json
// workflow-packs/memory-maintenance.pack.json
{
  "id": "memory-maintenance",
  "title": "Memory Maintenance (Dreaming)",
  "version": "0.1.0",
  "description": "Governance pack for the dreaming memory-maintenance loop. Forward-looking: the memory pipeline it feeds (amber memory command family, registry, events) is delivered by the Governed Memory Layer spec; mechanical fields below reference only presently verifiable artifacts.",
  "connectorContracts": [ { "id": "local-docs", "type": "filesystem", "mode": "read-only", "credentials": "none", "redaction": "not-required", "externalWrites": false } ],
  "approvalPolicy": { "readOnlyInspection": "allowed", "reportGeneration": "allowed", "fileMutation": "requires-human-approval", "commandExecution": "requires-human-approval", "externalNotification": "requires-human-approval", "issueCreation": "requires-human-approval", "selfApprovalAllowed": false },
  "loopLedger": { "required": true, "pathTemplate": ".amber/loops/{contractId}/ledger.json", "chatHistoryRequired": false, "recordsInputSnapshot": true, "recordsToolSummary": true, "recordsBudgetUsage": true, "recordsStopReason": true, "recordsApprovalState": true, "recordsReviewerOutcome": true },
  "workspaceIsolation": { "mutatingLoopsUseWorktree": true, "mainCheckoutMutation": false },
  "loopContracts": [ {
    "id": "memory-maintenance-dreaming",
    "title": "Memory Maintenance Dreaming",
    "trigger": { "type": "scheduled", "cadence": "weekly", "enabled": false },
    "goal": "Collect memory maintenance signals (wiki drift, stale candidates, distill and evolution recurrence) and produce reviewable memory proposals for human admission; never mutate surfaces.",
    "stateSpine": ".amber/loops/memory-maintenance-dreaming/state.json",
    "inputs": ["amber drift / amber status (wiki drift)", "amber maintenance inspect", "amber maintenance distill output", "evolution findings recurrence", "break-loop post-mortems"],
    "skills": ["amber-continuous-improvement"],
    "connectors": ["local-docs"],
    "triageOutputs": ["candidate-task", "needs-human"],
    "hardStops": { "maxIterations": 3, "timeoutMinutes": 30, "noProgressDetection": true },
    "budget": { "maxMinutes": 30 },
    "reviewGates": ["human-approval", "reviewer-evidence"],
    "execution": { "executesAnything": false, "schedulesJobs": false, "dispatchesAgents": false, "writesExternalSystems": false }
  } ]
}
```

（无 `governed` 字段 = M6 的纯 L1 形态；stateSpine 声明但按 M15 禁写；三件套与 safe-amber-bootstrap 逐字相同 = M2。goal 命中 maintenance 桶 ≥3 词（实测 6 词）= M3。）

### 7.2 关键条款（M1–M16）

| 条款 | 钉死内容 |
| --- | --- |
| M1 | 文件 `workflow-packs/memory-maintenance.pack.json`；id `memory-maintenance`；loopContracts 恰一个，契约 id `memory-maintenance-dreaming`；recommend 只扫 `workflow-packs/*.pack.json`，新增文件即接入零机制改动 |
| M2 | approvalPolicy/loopLedger/workspaceIsolation 与 safe-amber-bootstrap.pack.json 第 19–42 行**逐字相同**；任一处修订必须同 PR 联动另一处；一致性 doctor 检查见 §11 |
| M4 | inputs 且仅声明五项现存信号源（见骨架）；MEMORY.md 陈旧/重复类信号零存在**不得**入 inputs——契约对输入源不说谎 |
| M5 | 溯源三段：(i) 每轮以 `loop run --dry-run` 起始并以 `loop record` 落盘 history 记录；(ii) `inputSnapshot.sources` 快照 M4 清单；(iii) `actionSummary` 携带实测信号计数声明或显式 `"no-signal"`；proposal 转换时 request provenance 反向引用该轮 loop record 时间戳（`provenance.loopRecord`） |
| M6 | `governed` 升级路径只存在于契约文本前瞻注释位（指向 `node scripts/amber.js memory maintenance --collect`，须命中 rules.json allow 前缀）；升级是契约变更须走同级裁决；当下零 governed 声明 |
| M8 | 无信号轮次不落 record；连续两次 dry-run 均无信号允许记录但 actionSummary 须显式 `"no-signal"`；此后 stalled 是**预期行为**，remedy 即暂停记录 |
| M9 | hardStops/budget/reviewGates 全部复制 daily-amber-triage 报告型参数（骨架值），无新数值立法 |
| M10 | 分流键唯一且机械 = **是否进入 memory request 管道**：`needs-human` = 语义记忆提案（经 `amber memory request` 转换、走 ingest→approve→book 的一切产物）；`candidate-task` = 确定性 surface 修复候选（留行为面既有管道，不入记忆管道）；blocked/archive/regression-test-proposal 不声明 |
| M11 | channel 闭集 8 值（§2.2）；dreaming request 另须携带 `provenance.batchId` 与 `provenance.loopRecord` |
| M12 | 一轮 dreaming 全部 request 共享同一 batchId（格式 **Spec-defined**：取该轮 loop record 的 recordedAt，RFC3339 UTC 时间戳）；批次审计经 events.jsonl 按 batchId 过滤重建；批次整体否决不设批次级动词（逐条 reject，每条 reason 强制非空） |
| M13 | 契约机械字段零引用未来管道（无 governed.command、无 schema 字段名、无 `.amber/memory/` 路径）；管道名仅出现于 goal/inputs 文本前瞻层；闭集信号引用校验落点 = request 的 `provenance.signal`（§5.3）；spec 与本裁决冲突以裁决为准并记偏差表 |
| M15 | 本契约下任何主体（含宿主 agent）**不得创建或写入** stateSpine 路径文件；历史维度由 loop record history 承载；未来真实写入须新起同级裁决，权威序预设为 events.jsonl + registry 权威、state.json 至多为投影 |
| 权威序（系统性二） | `events.jsonl`（审计轨迹）+ entry registry（状态权威）为唯一权威序；loop history/ledger 仅属执行域账本；不引入任何第三状态文件 |
| 幻影立法二分（系统性一） | 文本前瞻层（goal/inputs/title/reviewGates 自由字符串）允许引用未来工件；机械校验层（governed.command、triageOutputs enum、schema required 字段语义）禁止引用当下不可执行工件 |

**maintenance 动词面边界声明**（#175-M13）：maintenance 动词面（collect/inspect 等）与产物持久化路径属**未来同级裁决**专属范围；#175 不是也不声称是 #174-M6 所指的同级裁决；升级必答项预登记——collect 产物持久化路径（预设：产物经命令自身写入 `.amber/` 治理域并随事件登记，stdout 截尾不得作为唯一快照载体）、inspect 数据基底、governed.command 命中 rules.json allow 前缀。命名漂移锁（#175-M14）：未来 spec 若改名 collect，升级裁决与改名同批处理。

## 8. 动词表面与治理接缝（#175）

### 8.1 五动词与 MCP 表面

**表面分配原则**（#175-Q2）：动词进入 MCP 表面当且仅当其合法调用不依赖本地管道在场或本地仪式（即人判定动词与只读投影动词）。

| 动词 | CLI | MCP | 形态 |
| --- | --- | --- | --- |
| `amber memory request` | ✓ | ✗（白名单） | 产 request（触发/转换/逃生舱/追认前提名） |
| `amber memory ingest` | ✓ | ✗（白名单） | 机械验收准入（γ/α/排序在此生效） |
| `amber memory approve` | ✓ | ✓ `amber.memory.approve`（mutating，approval-required） | 条目级人工审批（A1/A3/A4） |
| `amber memory book` | ✓ | ✗（白名单） | surface 登记 + 双轨 origin（§5.5） |
| `amber memory abandon` | ✓ | ✓ `amber.memory.abandon`（mutating，approval-required） | F1(ii) 人显式入口（F1(i) 自动路径不经 MCP，#175-M2/M4） |
| `amber memory status [--json]` | ✓ | ✓ `amber.memory.status`（directReadOnlyExec 免审批） | 三段只读投影（§8.2） |

M1：CLI 子命令面与 MCP 工具名 `amber.memory.<同名动词>` 一一对应，零映射表、零聚合层；M6：本轮 MCP 表面增量 = 2 mutating + 1 只读，未来 memory 域任何新增 MCP 工具须经同级裁决；M5：排除集 {request, ingest, book} 升格唯一合法路径 = 未来同级裁决证明该动词出现非本地合法调用方。

### 8.2 amber.memory.status 三段投影（M7 语义 + Spec-defined 字段名）

输出单一 JSON 对象、固定三段、无过滤参数；MCP inputSchema 零参数（仅保留 `_target`）：

```json
{
  "entries": { "draft": 0, "proposal": 0, "active": 0, "superseded": 0,
               "needsReReview": 0, "abandoned": 0, "pendingRequests": 0 },
  "gamma": { "windowAdmitted": 0, "quotaRemaining": 5,
             "windowStart": "<T-168h>", "windowEnd": "<T>" },
  "alpha": { "entries": 0, "maxEntries": 50, "bytes": 0, "maxBytes": 8192,
             "utilizationPct": 0.0 }
}
```

M8 权威归属：α 50% 强制复审**告警**职责唯一归 doctor；γ 超限**拒绝**职责唯一归 ingest；status 只投影数值不做判定——doctor 是判定权威、status 是观测投影，二者读取同一数据源（registry + events.jsonl），无第二权威。M9 同批次纪律：status 的机械注册项（schema enum、capability、action-type JSON、四表）必须与 handler 实现及数据基底（registry 读取器 + events.jsonl 聚合器）在同一实施批次（同一 PR）落地，批次测试必须含 `memory status --json` CLI 实调断言与 MCP tools/call 断言——测试是"注册了且实现了"的机械证明，填补 validateWhitelist 不校验 handler 的已知空洞。

### 8.3 注册轨道：单轨 + 白名单分流（系统性一"第四出路"）

- `memory` 加入 `TYPED_COMMAND_NAMES`（M10）；族内 capability 恰 3 条（parity 为族级校验，族内有 capability 即满足；request/ingest/book 无 capability 不触发 throw）：

| capability | effect | approver | evidence | directReadOnlyExec | edits | sideEffects |
| --- | --- | --- | --- | --- | --- | --- |
| `memory/approve` | write | human | `approval-record` | false | `[".amber/memory/registry/", ".amber/context/events.jsonl"]` | `["ledger-append"]` |
| `memory/abandon` | write | human | `ingest-record` | false | `[".amber/memory/registry/", ".amber/memory/requests/", ".amber/context/events.jsonl"]` | `["ledger-append"]` |
| `memory/status` | read | system | null | true | `[]` | `[]` |

- **M11 白名单收录策略**：memory 命令族每个子命令必须且只能二选一——获 capability 条目（须有 action-type JSON）或列入 `KNOWN_UNTYPED_SUBCOMMANDS`，不存在第三状态；本轮 `memory/request`、`memory/ingest`、`memory/book` 入白名单（26→29），与四表注册同批次（M18：禁止四表先行、白名单后补——间隙内 CLI 调用 `memory request` 会 exit 1）。
- **action-types/ 新增恰 3 个 JSON**（与 capability 全等）：`memory-approve.json`（parameters：entryId required 恰好一个、decision enum ["approve","reject"] required、reason optional reject 时 handler 强制非空；args 绑定 `--entry-id`/`--decision`/`--reason`）；`memory-abandon.json`（request/entry 均 optional 互斥在 handler 校验；args 绑定 `--request`/`--entry`）；`memory-status.json`（mode dry-run、parameters 空对象、args 绑定字面量 `--json`）。
- 拒绝的三条出路：Q2 让步全表面（3 个幻影工具 + book 入 MCP 抵触 never-overwrite）；Q4 让步双轨（context/load 悬空注册的结构性再生产）；泛化合成分支（触发条件：出现第三个需要"capability 无 JSON"形态的命令族时开裁决评估，拒绝现在泛化）。零新机制是第四出路的决定性优点。

### 8.4 身份门、证据种类与 skills 传导

- **M12 CLI 侧身份门义务**：request/ingest/book 不入 capability 故不受 cli-typed-seam 审批闸约束；作为对价三者 handler 必须**内联实现** #172-A3 身份门（非 TTY 无 `--yes` 即拒绝，`AMBER_E_MEMORY_APPROVAL_REQUIRED`；templates 指示 agent 永不传 `--yes`）——此为 spec 强制义务，写入实施清单。
- **证据种类（系统性四）**：approve → `approval-record`（复用 session/approve 先例；memory-approval 事件即审批留痕）；request/ingest/book/abandon → `ingest-record`（复用 context/ingest 先例）。语义扩注钉死：ingest-record 在 memory 域 = "记忆管道治理记录写入事件账本"，覆盖提名创建/准入/账面登记/放弃四类生命周期处置；**拒绝新造** book-record/abandon-record/request-record（零消费者、稀释词表、违背 B3 最小增量）；ontology 文档须记载该语义扩注。
- **sideEffects**：五个 write 动词统一 `["ledger-append"]`（释义 = `context-store.appendEvent` 对 events.jsonl 的追加；拒绝 enum 扩列）。
- **M3 边界表面化义务**：book 与 approve 的仪式边界由已裁字段解决（origin 双值 + 无前置 approve 的 book 触发 doctor 告警）；两个 action 文档（JSON goal 字段与 ontology 表注记）必须显式声明该边界规则。
- **M17 skills 传导义务**：动词名（request/ingest/approve/book/abandon/status）进入 `skills/` 相关 SKILL.md 文本后执行 `npm run gen:agents` 再生成多平台产物；CI `gen:agents:check` 漂移守卫通过为验收条件；动词名未进 skills 文本前不得声称裁决落地完成。

## 9. 事件账本（memory-* 闭集）

唯一账本 `.amber/context/events.jsonl`，经既有 `context-store.appendEvent` 写入；**任何触发源不得拥有私有事件文件，新增触发源必须复用 appendEvent**；不写 session timeline（18 种事件深锁）、不写 loop ledger、不写 feature_list.json、不建 decision.json（#172-系统性一）。账本 = 审计轨迹；entry registry = 状态权威；二者一致性由 doctor 校验（§11）。kind 闭集 5 值（不扩不增）。**各事件载荷字段（Spec-defined——裁决留白落地，含 batchId/channel/signal/排序留痕/abandon 触发源标记/decision/reason/decidedBy/entryId/requestId 全部裁决点名项）**：

| kind | 载荷字段（除 appendEvent 公共时间戳外） |
| --- | --- |
| `memory-request-created` | `requestId`, `channel`, `signal?`, `triggerRef.ref`, `entryIds[]`, `batchId?`, `derivedFrom?` |
| `memory-ingest` | `requestId`, `channel`, `outcome`(admitted/rejected/no-change), `entryIds[]`, `ranking?`(`[{entryId, k1, k2}]` 按名次排序，K3=entryId 本身隐含), `code?`, `batchId?` |
| `memory-approval` | `entryId`, `requestId`, `decision`(approve/reject), `reason?`, `decidedBy:"human"`, 另含 β pair 第二事件时 `supersededEntryId` |
| `memory-book` | `entryIds[]`, `origin`(governed-promotion/human-direct-ratification), `surfacePath`, `normHash`; 追认轨无 `requestId` |
| `memory-abandon` | `scope`(request/entry), `targetId`, `triggerSource`(auto-threshold/explicit), `requestId?`, `entryId?` |

载荷字段变动时 status 输出契约同步修订属 spec 义务，不需重开裁决（#175-系统性四第 3 项：投影语义锚定"计数/窗口/利用率"层面，不锚定字段名——与 #174-M14"键定义锚事件语义不锚字段名"同范式）。

## 10. schema 落地（Spec-defined——裁决留白，本节给出最简可执行定义）

### 10.1 `schemas/memory-request.schema.json`

与 context-request 同族（draft-07）；**禁携页级字段** pageId/scope/supersedes/target（#172-B3）；排他规则"同一触发事件一个 open memory request"由写入端保证，非 schema 表达。

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `schemaVersion` | string | ✓ | enum `["1.0.0"]`（独立枚举，B3） |
| `requestId` | string | ✓ | `^[a-z0-9-]+$` |
| `createdAt` | string | ✓ | date-time |
| `triggerRef` | object | ✓ | `{ ref: string, minLength 1 }`——触发工件引用（session id / feature id / loop record 时间戳 / 候选文件路径 / `"manual"`） |
| `provenance.channel` | string | ✓ | 8 值闭集（§2.2） |
| `provenance.signal` | string | 条件 | 6 闭集 id（§6.1）；**必填 iff** channel ∈ {dreaming-maintenance, distill-conversion, maintenance-conversion, evolution-conversion, regression-conversion}（#173-Q1.3 吸收 + #174-M13 校验的合成） |
| `provenance.batchId` | string | 条件 | RFC3339 时间戳 = 该轮 loop record recordedAt；dreaming 通道必填（#174-M11/M12） |
| `provenance.loopRecord` | string | 条件 | 该轮 loop history 记录时间戳；dreaming 通道必填（#174-M5/M11） |
| `provenance.derivedFrom` | string | ✗ | 父 requestId；血统链继承拒绝计数（C5/F2） |
| `entries[]` | array | ✓ | minItems 1；元素 = §10.2 核心字段（不含 registry 扩展字段） |
| `contract` | object | ✓ | `{ instructions, constraints: { forbidNewFacts: boolean } }`——删 maxWords/requireCitationPerClaim，保留 forbidNewFacts（B3） |
| `acceptance[]` | array | ✓ | `{check, code}`，code 匹配 `^AMBER_E_MEMORY_[A-Z_]+$`（B1 部件复用） |

### 10.2 `schemas/memory-entry.schema.json`

核心字段（request `entries[]` 元素与 registry 条目对象共用）：

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `schemaVersion` | string | ✓ | enum `["1.0.0"]` |
| `entryId` | string | ✓ | `^sha256:[0-9a-f]{64}$`；**定义** = 规范化 JSON（键字典序、无填充空白、UTF-8）of `{claim, knowledgeKind, targetSurface, sources, supersedeTarget?}` 的 sha256——修订内容即新 entryId |
| `claim` | string | ✓ | minLength 1（不设 maxLength——体量由 α 字节预算治理，最小增量） |
| `knowledgeKind` | string | ✓ | 7 枚举（§2.2） |
| `targetSurface` | string | ✓ | 4 值闭集（#173-Q4；枚举扩列须裁决程序） |
| `provenance.sources[]` | array | ✓ | minItems 1；元素同 context-request source descriptor（kind/ref/rawHash/mutable/normHash 或 excerpt+excerptHash）+ `backref?`（反向指针，best-effort 非承重，#170-Q3） |
| `supersedeTarget` | string | ✗ | 一对一 entryId 指针（#172-C3）；预算耗尽时为获准必要条件（β） |
| `related[]` | array | ✗ | `[entryId]`；best-effort 提示非结构，断链仅 doctor warning（#172-Q4 处置） |

registry 扩展字段（仅 registry 对象携带）：`status`（6 值枚举：draft/proposal/active/superseded/needs-re-review/abandoned）、`origin?`（2 值）、`approvedAt?`、`lastRejection?{reason, at}`、`rejectionCount?`（血统链累计）、`bookedSurface?{path, normHash, bookedAt}`、`createdAt`、`updatedAt`。条目 schema 不设超过状态机所需的元数据字段（#170 攻击 3 约束）。

### 10.3 MEMORY.md 条目分隔结构与 α 计数（α 计数的机械前提）

现状缺口：`templates/MEMORY.md` 仅 21 行 creed，未定义条目格式——#173-Q5 的 α 计数依赖本节定义（**Spec-defined**）：

- **条目区**：二级标题 `## Entries`（既有 creed 小节保留不动）。
- **条目分隔**：条目区内每个 `^### `（三级标题行）起始一个条目，至下一个 `^### ` 行或文件末尾。
- **条目计数**（α 条目维度）= 条目区内 `^### ` 行数（确定性正则可解析，零语义判断）。
- **字节数**（α 字节维度）= 归一化后 UTF-8 字节数；归一化 = CRLF→LF、去 BOM、去行尾空白。
- **bookText**（α 准入预估与 book 登记锚，Spec-defined 最简形态）：条目渲染 = `### <claim 首行>` 一行 + 溯源行 `> provenance: <surface 路径>@<normHash 前 12 位>`；人写入 MEMORY.md 时以此为准（不禁止人类增补叙述，α 字节以落盘后实测为准）。
- **模板修订建议**（供实施批次采纳，本 spec 不改模板）：`templates/MEMORY.md` 增加 `## Entries` 区与一条示例条目；增加追认义务提示行（"直接编辑后请运行 `amber memory book` 追认"，#173-Q2）；init scaffold 的 `.gitignore` 模板增加 `!/MEMORY.md` re-include **建议**（advisory 带注释，复制 `!/feature_list.json` 惯例；注明 "governed shared memory — tracked by git by default"，从 "Local working files" 并列语义中显式区隔，#173-Q6）。

### 10.4 其余机械定义（Spec-defined）

- **request 存储**：`.amber/memory/requests/<requestId>.json`（与 context requests/ 对称；requests are never deleted）；文件 = request 工件全量 + bookkeeping `{status: open|resolved, resolvedAt?, rejectionCount}`。
- **pack `steps` 字段**：不声明——readiness 校验只查契约 id/goal/stateSpine，最小声明范式与 M6 零幻影一致。
- **身份门实现细节**（M12 义务）：request/ingest/book handler 入口处 `process.stdout.isTTY` 判定；非 TTY 且无 `--yes` → 拒绝并输出 `AMBER_E_MEMORY_APPROVAL_REQUIRED`；`--yes` 仅接受显式人工传入。

## 11. doctor 校验规则（#172-系统性三 5 条 + #173/#174 增项）

| # | 规则 | 级别 |
| --- | --- | --- |
| 1 | 账本-registry 一致性：每个 proposal/active/superseded 条目必须在 events.jsonl 有对应 `memory-ingest`（active 还须 `memory-approval` + `memory-book`）；无账本轨迹的条目 = error，fail-closed | error |
| 2 | 源健康：provenance 源可解析且哈希相符；源失效/哈希漂移 → 条目机械进入 needs-re-review（`AMBER_E_MEMORY_SOURCE_STALE`，复用 D4/D5 mutable-source refresh 机制） | error→状态迁移 |
| 3 | 反向指针与 related 指针：best-effort，目标消失只报 warning，**永不使条目失效** | warning |
| 4 | surface 漂移：MEMORY.md 登记 normHash 漂移 → 关联条目 active→needs-re-review；漂移检出且**无关联 registry 条目**时必须给出二选一 remedy 文案（book 一条 human-direct-ratification 条目，provenance 指 surface 路径+时间+normHash；或人工回退），**禁止只报"哈希变了"**（#173 追认强化 3） | 状态迁移 + remedy |
| 5 | 预算与限速合规：重算当期 γ 消耗与 α 水位，账本-registry 计数不符即 error | error |
| 6 | α 50% 强制复审：任一维度首次达到 25 条或 4 KB → 强制复审提示（#173-Q5） | 提示 |
| 7 | ratification-class 告警：无前置 approve 事件的 book（#173 追认强化 2），与 needs-re-review 并列 | warning |
| 8 | acknowledged divergence：目标仓库 .gitignore 忽略 MEMORY.md = 知情分歧类别而非缺陷——报一次、附 remedy 文案（re-include 或接受 L2 降级），不作持续告警（#173-Q6） | 一次性告知 |
| 9 | pack 三件套一致性（Spec-defined，#174 开放点）：memory-maintenance 与 safe-amber-bootstrap 的 approvalPolicy/loopLedger/workspaceIsolation 三块声明逐字一致（normHash 比对），不一致 = error，remedy = 同 PR 联动修订 | error |
| 10 | book 时 git 检测：目标 surface 不在 git 追踪范围 → 非阻塞 warning（#173-Q6，风险在 book 时刻显性化） | warning |
| 11 | abandoned 统计：只报累计计数 warning（F4；消费面一律过滤） | warning |

## 12. AMBER_E_MEMORY_* 错误码族（扩展而非重建，#170：复用 error-catalog 分层与 verify/doctor 汇总）

已裁两条 + Spec-defined 补充（五字段结构 `{title, cause, remedy, layer, related}`；layer 全族取 `Context`，与 AMBER_E_CONTEXT_* 族继承一致）：

| code | title / cause / remedy 概要 | 依据 |
| --- | --- | --- |
| `AMBER_E_MEMORY_RATE_LIMITED` | 168h 窗口内 memory-ingest 准入已达 5 条上限，提交整体拒绝 / entries[] 超剩余配额 / 缩减后重交，或待窗口滚动 | #172-C4、#174-M7（裁定） |
| `AMBER_E_MEMORY_SOURCE_STALE` | 条目 provenance 源 normHash 漂移或源失效 / 源被修改或清除 / 复审条目：修正后重验或 supersede | #172-系统性三-2（裁定） |
| `AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID` | 载荷未过 memory-request schema / 字段缺失或类型错误 / 修正后重交（request 保留） | Spec-defined |
| `AMBER_E_MEMORY_ENTRY_SCHEMA_INVALID` | 条目未过 memory-entry schema（含 signal 闭集/枚举违例在 `AMBER_E_MEMORY_SIGNAL_INVALID` 单列） / 同上 | Spec-defined |
| `AMBER_E_MEMORY_BINDING_MISMATCH` | checkRequestBinding 逐源哈希比对失败 / 源文件与 request 登记哈希不符 / 重新生成 request | Spec-defined |
| `AMBER_E_MEMORY_BUDGET_EXCEEDED` | α 预算耗尽状态拒绝新准入 / MEMORY.md 物理条目数或字节数达上限 / remedy 指引：拆分为多条、或经 β 指认 supersedeTarget 腾出预算（禁止裸拒绝） | #170-α、#173-Q5 |
| `AMBER_E_MEMORY_SIGNAL_INVALID` | provenance.signal 缺失或不属 6 闭集（转换/dreaming 通道） / 引用 #173 闭集信号 id 之一 | #174-M13 |
| `AMBER_E_MEMORY_APPROVAL_REQUIRED` | 非 TTY 调用人判定动词且无 `--yes` / 非交互环境 / 由人在 TTY 执行或显式 `--yes`（agent 永不传） | #172-A3、#175-M12 |
| `AMBER_E_MEMORY_ENTRY_NOT_FOUND` | entryId 不在 registry / 指针指向不存在条目 / 核对 `amber memory status` 与 entryId | Spec-defined |
| `AMBER_E_MEMORY_REQUEST_NOT_FOUND` | requestId 无对应 request 文件 / 同上 | Spec-defined |
| `AMBER_E_MEMORY_STATE_INVALID` | 状态机非法迁移（如 approve 非 proposal 条目、参数互斥违例） / 对照 §4.1 迁移表 | Spec-defined |
| `AMBER_E_MEMORY_SURFACE_DRIFT` | 登记 surface normHash 漂移 / 关联条目进入 needs-re-review / 按 §11-4 二选一 remedy 处置 | Spec-defined |

## 13. 实施清单（批次 A，#175-系统性三 decision-complete 12 步逐字固化）

**批次纪律**：批次 A = 单一 PR，不可拆分（M15：一切机械层注册项标注所属实现批次，注册与实现原子落地，禁止"注册先行、实现跟进"；M18：白名单扩列与四表注册同批）。步骤 12 随批次 A 或紧随 PR。

1. **schema enum 扩列**：`schemas/action.type.schema.json` 的 `execution.command` enum 两处（顶层与 variants 内嵌）扩入 `"memory"`（M16：实施事项不另行裁决；遗漏即 MCP 启动 exit 2）。
2. **四表注册**：`scripts/lib/command-registry.js` 的 COMMANDS（37→38）、COMMAND_HELP、COMMAND_OUTPUT、TIER_BY_COMMAND 加 `memory`（缺一即模块加载 throw）；tier 钉死 `core`；`TYPED_COMMAND_NAMES` 加 `"memory"`（M10）。
3. **COMMAND_CAPABILITIES 新增恰 3 条**（字段见 §8.3 表；validateWhitelist 逐项对等）。
4. **action-types/ 新增恰 3 个 JSON**（memory-approve/memory-abandon/memory-status，参数见 §8.3）。
5. **KNOWN_UNTYPED_SUBCOMMANDS 扩列**：加 `memory/request`、`memory/ingest`、`memory/book`（M11/M18）。
6. **command-dispatcher.js**：COMMAND_HANDLERS 加 memory handler（五动词业务逻辑 + status 投影；request/ingest/book 内联 A3 身份门，M12）。
7. **数据基底（与注册同批，M9）**：`.amber/memory/registry/`（writeEntry，#172-B2）、request 存储（`.amber/memory/requests/`，结构见 §10.4）、appendEvent 的 memory-* kind 5 值写入、`AMBER_E_MEMORY_*` 错误码入 error-catalog（§12 全表）。
8. **B3 两 schema**：`schemas/memory-request.schema.json`、`schemas/memory-entry.schema.json`（§10.1/§10.2）。
9. **测试面（同批）**：`tests/unit/mcp-action-contracts.test.js`（3 capability 对等断言）；`tests/integration/amber-mcp.test.js`（tools/list 枚举断言新增恰 3 工具；approve/abandon 经 tools/call 返回 approvalRequired:true 且 executed:false；status 返回 executed:true、approvalRequired:false；含 `memory status --json` CLI 实调断言）；`tests/integration/action-type-schema.test.js`（3 JSON 合法性）；CLI seam 测试（request/ingest/book 白名单放行、approve/abandon write 无 `--yes` 时 approvalRequired exit 1）。
10. **文档面**：`docs/wiki/amber-ontology-mcp.md` 行 119–128 映射表新增 3 行（approve/human/approval-record、abandon/human/ingest-record、status/system/只读），objectType 表不动；M3 的 book/approve 边界注记；ingest-record 语义扩注记载（§8.4）。
11. **CLI_REFERENCE.md 与 help 文本同步**（四表 COMMAND_HELP 已含；AGENTS.md/README 命令清单为清单外同步点）。
12. **skills/gen:agents 传导（M17）**：动词名进入 `skills/` 相关 SKILL.md 后执行 `npm run gen:agents` 再生成 `.claude/commands/`、`.agents/skills/`、`.gemini/commands/`；`gen:agents:check` 通过为验收。

**批次 A 附属裁决义务**（#173/#170 spec 约束，随批次落地）：approve 输出展示 creed 全文提示（§5.4）；governance report 展示通道占比与"人工提名 vs 自动提名比例"（§6.1）；`templates/MEMORY.md` 修订（条目区 + 示例 + 追认提示）与 scaffold `.gitignore` re-include 建议（§10.3）；`workflow-packs/memory-maintenance.pack.json` 按 §7.1 骨架落盘；doctor 新增 §11 规则 6–11。

## 14. 验收标准（Spec-defined——map Not-yet-specified 要求 spec 自带可核验判据）

1. **矩阵完整**：§3.2 的 12 格矩阵无空格（#170 强制条款）。
2. **闭集逐字一致**：§2.2 五个闭集与五份裁决逐字一致；实现中任一闭集扩列均构成偏差。
3. **批次 A 单 PR**：§13 步骤 1–11 同一 PR；步骤 9 全部测试断言绿（含 tools/list 恰 3 新工具、approve/abandon approvalRequired:true 且 executed:false、status executed:true、CLI 实调、seam 白名单放行与无 `--yes` exit 1）。
4. **gen:agents:check 通过**（动词名进 skills 文本后）。
5. **dogfood 冒烟可重放**：测试环境重放一次 T1 触发 → request（channel=t1-writeback）→ ingest（proposal）→ approve → book（active, origin=governed-promotion）→ status（entries/gamma/alpha 三段数值断言）全链，断言各事件 kind、状态迁移与 §9 载荷字段在场（本仓 `.amber/context/` 现为空态，冒烟在测试 fixture 环境执行，不依赖真实数据管道）。
6. **状态机覆盖**：§4.1 全部迁移边有测试（含 needs-re-review 复位、β pair 原子性、F1(i) 血统 3 次自动 abandoned、F3 重建排除 abandoned）。
7. **doctor 覆盖**：§11 规则 1–11 各有正/反测试（一致性 fail-closed、二选一 remedy 文案在场）。
8. **偏差表为空**：实现与本 spec 及五份裁决零冲突；任何偏离先记偏差表并回到裁决程序。

## 15. 开放点

### 15.1 留给未来裁决（#175 尾表 5 项，逐字）

| 开放点 | 触发条件 |
| --- | --- |
| request/ingest/book 升入 MCP 表面 | 出现非本地合法调用方（#175-M5 升格路径），须同级裁决 |
| maintenance 动词面（collect/inspect 等）与产物持久化路径 | #174-M6 升级裁决（M13/M14 已预登记必答项） |
| cli-typed-seam 合成分支泛化为通用机制 | 出现第三个需要"capability 无 JSON"形态的命令族时评估；明确拒绝现在泛化 |
| context/load 悬空注册清理 | 建议独立小任务（删 COMMAND_CAPABILITIES 条目或补 JSON），不阻塞实施；其 sideEffects "loadout-written" 游离 schema 闭集问题随清理一并处置 |
| sideEffects enum / execution.command enum 任何进一步扩列 | 同级裁决 |

（#174 另有两项留给后续同级裁决：governed collect 命令及产物持久化路径；loop stateSpine 真实写入与 state.json 投影机制——已并入上表第 2 行与 §7.2-M15。）

### 15.2 Spec-defined 落地项汇总（评审聚焦清单）

§4.1 needs-re-review 复位通道（重新 book）｜§5.1 T2 挂载点定位｜§5.3 signal 强制通道清单｜§5.5 追认 book 机械形态（直接创建 active、不耗 γ）｜§6.1 信号 id 映射｜§6.3 α 准入算术（耗尽判定 + bookText 预估）｜§6.5 K1 的 T1/T2 工件锚定、C4×M14 合成语义｜§7.2-M12 batchId 格式、pack steps 不声明｜§8.2 status 字段名｜§9 事件载荷字段｜§10.1–§10.4 两 schema 字段/schemaVersion "1.0.0"/MEMORY.md 分隔结构/bookText/request 存储/entryId 规范化/身份门细节｜§11 规则 9 pack 三件套检查｜§12 十条新增错误码｜§14 验收标准。

### 15.3 待裁决问题

**无**。撰写中未发现裁决未覆盖且属实质方案取舍的问题；五份裁决留白项均按"最简机械定义"处置并逐项标注 Spec-defined（汇总见 §15.2）。其中最接近实质取舍、建议评审重点确认的两处：§6.5 C4×M14 合成语义与 §4.1 needs-re-review 复位通道——两者均为已裁条款在闭集约束下的唯一机械闭合，若评审不认可则需开圆桌。
