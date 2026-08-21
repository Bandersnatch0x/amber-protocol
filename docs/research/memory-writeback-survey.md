# 业界 agent memory 写回与维护机制调研

> Wayfinder map: Governed Memory Layer (#169) / research ticket: #171（Bandersnatch0x/amber-protocol）
> 调研日期：2026-08-21。方法：官方文档与论文为一手来源，vendor 博客与社区报告为辅助来源；逐条注明 URL 与可信度。

## 1. 调研问题

1. 写回触发时机与自动化程度：谁决定记忆何时落盘——确定性管道、定时任务，还是 agent 临场判断？
2. 后台维护机制：去重、陈旧淘汰、合并/dreaming 式整备的具体做法。
3. 失效模式：依赖 agent 自觉保存导致跨会话记忆丢失的真实案例与对策。

## 2. Mem0：turn 级自动提取管道

**写回触发与自动化**：Mem0 位于应用与模型之间，应用在有用交互后调用 `add(messages)` 触发提取管道：(1) context lookup（取相关既有记忆与运行摘要）；(2) LLM 事实提取（偏好/决定/计划）；(3) 去重与 embedding；(4) 实体提取。官方文档明确"响应生成后存新记忆、下一次模型调用前 search"，不占主对话路径；Hermes/OpenClaw 集成中以背景线程在每 turn 后自动投递，连续 5 次失败熔断 2 分钟。自动化程度：全自动管道，不依赖 agent 判断。

**维护机制**：论文（arXiv 2504.19413）的 update phase：每条候选事实与既有相似记忆（实验设置 10 条）比对，由 LLM 经 tool call 决定 ADD/UPDATE/DELETE/NOOP。注意口径差异：现行官方文档称自动提取为 additive only（新事实不静默改写旧事实），修正/删除须显式 update/delete；OSS 版提供 SQLite 编辑历史。即维护策略趋向"追加 + 显式修正"，避免自动改写破坏历史事实。

**失效对策**：turn 级捕获使"无需依赖 compaction 事件或 agent 自觉即可存活"；`customInstructions` 收窄提取范围以降噪声（官方称该字段对记忆质量影响最大）。

**来源**：官方文档 https://docs.mem0.ai/core-concepts/how-it-works（高）；论文 https://arxiv.org/abs/2504.19413（高）；集成细节来自 Mem0 vendor 博客（中）。

## 3. OpenClaw：文件式记忆 + memory flush + dreaming

**写回触发与自动化**：文件式记忆（MEMORY.md 长期层 + memory/YYYY-MM-DD.md 日记层 + 可选 USER.md/DREAMS.md），"模型只记得写进磁盘的内容，没有隐藏状态"。两条写回路径：(a) agent 主动写入——LLM 工作中自行决定落盘，用户也可直接说 remember X；(b) automatic memory flush——compaction 摘要对话前，系统插入一个静默 turn 提醒 agent 把重要上下文写入记忆文件，默认开启、可关闭，可为该 turn 单独指定模型（不继承会话 fallback 链）。自动化程度：半自动——触发点确定，写入内容由 agent 判断。今日与昨日的日记文件在 /new 或 /reset 时自动加载，更早的仅可检索。

**维护机制（dreaming）**：默认开启的后台整备，memory-core 自动管理一个 cron（默认每天 03:00）。三相位：Light（分拣/暂存短期信号、去重，不写 MEMORY.md）→ REM（主题与反思，不写）→ Deep（评分并晋升）。晋升须同时通过三个确定性闸门：minScore、minRecallCount、minUniqueQueries；评分为六信号加权（relevance 0.30 / frequency 0.24 / query diversity 0.15 / recency 0.15 / consolidation 0.10 / conceptual richness 0.06）加 Light/REM 相位加成。过闸候选交给 consolidation 子代理重写 MEMORY.md（合并重复、替换陈旧）；被接受的重写必须满足校验：既有条目丢失比例不超过 maxPriorEntryLossFraction（默认 0.25）、保留每条晋升候选的 Source: path#Lx-Ly 溯源、不超 bootstrap 预算、可解析为期望结构；旧 MEMORY.md 先存入 SQLite 作为 rewrite preimage；校验失败或模型不可用时降级为 append-only。provenance 为 untrusted/system 的候选被结构性 taint gate 排除（不是扣分，是直接不得进入 consolidation prompt）。DREAMS.md 是人类审查面（日记本身不得作为晋升来源）。另有 grounded backfill 可回放历史日记（可 rollback），transcript 摄入前做脱敏并剔除 recalled 片段防止回环学习。

**失效对策**：pre-compaction flush 是防丢失的核心，但其效果取决于静默 turn 中模型的判断（见第 7 节）；MEMORY.md 超预算时截断注入而不删文件；重写 preimage + append-only 降级保证 never-overwrite；`openclaw memory promote`（预览/apply）与 promote-explain 提供晋升的人工预览与可解释性。

**来源**：官方文档 https://docs.openclaw.ai/concepts/memory 与 https://docs.openclaw.ai/concepts/dreaming（高）；Mem0 对比博客（vendor，中）；flush 失效社区报告（低-中，见第 7 节）。

## 4. Claude Code / Anthropic：auto memory 与 Dreams

**写回触发与自动化**：Claude Code 双层记忆：CLAUDE.md（人写的持久指令）+ auto memory（Claude 自己写的笔记，默认开启）。Claude 在会话中自行决定记什么（构建命令、调试洞见、偏好），官方明言"不是每个会话都保存；由模型判断该信息对未来会话是否有用"——写回时机是模型判断；用户说 remember X 会立即保存。存储为 ~/.claude/projects/<project>/memory/（MEMORY.md 索引 + 主题文件），索引前 200 行/25KB 载入每个会话；harness 在写入后测量索引，接近限额时提醒 Claude 精简（一条一行、细节移到主题文件、合并或丢弃陈旧条目），超限则返回错误要求重写索引——这是 harness 层的确定性预算闸门。写带 frontmatter 的记忆文件时自动记录 modified ISO 时间戳。自动化程度：半自动（预算闸门确定，内容判断在模型）。

**维护机制**：Claude Code 本身没有官方后台整备（无 dreaming）；维护靠 Claude 会中重写索引与人工 /memory 编辑。Anthropic 平台侧（managed agents，research preview，beta header dreaming-2026-04-21）提供 Dreams：异步 dream 任务 = 既有 memory store + 1-100 个会话 transcript，产出"新的、重排过的 memory store"：重复合并、陈旧或被矛盾条目替换为最新值、新洞见浮现；可用 instructions 引导整备方向（合成导向，非逐行编辑）。关键治理属性：输入 store 从不被修改；输出是独立 store，由人 review 后决定 attach 到后续会话或丢弃；dream 运行本身是一个可流式观察的 session，失败/取消时输出保留部分内容供检查。

**失效对策**：记忆文件是纯 markdown，随时可人工审计/编辑/删除；需要硬约束时用 hooks 而非记忆（CLAUDE.md 是上下文不是强制配置）；文档显式列出 /compact 后指令丢失的场景与对策（项目根 CLAUDE.md 会重注入，嵌套规则按需重载）；会话 transcript 按 cleanupPeriodDays 清理但 memory 目录豁免。

**来源**：Claude Code 官方文档 https://code.claude.com/docs/en/memory（高）；Anthropic Dreams 官方文档 https://platform.claude.com/docs/en/managed-agents/dreams（高，research preview）。

## 5. Letta（MemGPT）：sleep-time compute

**写回触发与自动化**：MemGPT 式 agent 在对话中经 memory 工具自主编辑自身记忆（增量、会中触发）；Letta 0.7+ 引入 sleep-time agents：独立的后台 agent 在与用户无交互的空闲期异步重写/整备主 agent 的记忆，频率可配置，主 agent 以 anytime 方式随时读取而不必等待整备完成。自动化程度：自动（后台 agent），但重写内容由模型驱动，无确定性量化闸门。

**维护机制**：官方博客直指原 MemGPT 设计的两个问题——记忆管理与对话混在同一个 agent（更慢且更不可靠），以及增量式记忆形成"随时间变得杂乱无章"。sleep-time agent 把 raw context 持续整备为 learned context（干净、简洁、详细），可为其配置更强、不受延迟约束的模型；也可用于后台解析上传的文档并改写主 agent 记忆。论文 arXiv 2504.13171 报告 sleep-time compute 在 Stateful GSM-Symbolic 上以约 5 倍减少达到同等准确率所需的 test-time compute。

**失效对策**：把记忆维护从对话 agent 中解耦，规避"指望忙碌中的对话 agent 自觉整备"的失效模式；但写入仍依赖 agent 工具调用，公开资料未见人工审批闸门。

**来源**：Letta 官方博客 https://www.letta.com/blog/sleep-time-compute/（中-高，vendor）；论文 https://arxiv.org/abs/2504.13171（高）。

## 6. Zep / Graphiti：时序知识图谱 + 边失效

**写回触发与自动化**：ingestion 驱动的全自动管道。消息 episode 入图：实体抽取（当前消息 + 最近 4 条消息作上下文，并用 reflexion 式反思降低幻觉、提高覆盖）→ 实体消解（embedding 余弦 + 全文检索出候选，LLM 判重，重复合并并更新名称/摘要）→ 事实（边）抽取 → 时间抽取。图写操作使用预定义 Cypher 查询而非 LLM 生成查询，以保证 schema 一致、减少幻觉。自动化程度：全自动。

**维护机制**：核心是 bi-temporal 模型与 edge invalidation。每条事实边带四个时间戳：事务线 T-prime 上的 created/expired，有效期线 T 上的 valid/invalid。新边与语义相关的既有边由 LLM 判定为时间上重叠的矛盾时，旧边 t_invalid 置为新边的 t_valid——旧事实不删除，仅标记失效，历史完整保留；episode 层本身 non-lossy，语义产物可双向回溯到来源。矛盾裁决规则确定：按事务时间线优先新信息。社区层用 label propagation 增量更新，推迟全量重算。检索侧把失效区间一并返回（FACT + Date range），让模型感知事实的时效。

**失效对策**：以 supersession（取代）而非 deletion 做陈旧淘汰，从数据模型上消除破坏性维护错误；保留审计所需的双时间线。

**来源**：论文 https://arxiv.org/abs/2501.13956（高，vendor 作者）；开源 https://github.com/getzep/graphiti（高）。

## 7. 失效模式：依赖 agent 自觉保存导致记忆丢失

**案例 A（架构级，证据充分）**：OpenClaw 默认文件式记忆"模型只记得写进磁盘的内容"，新会话开始时若此前没有落盘，偏好、项目上下文、两天前的决定全部丢失。Mem0 博客进一步指出其 pre-compaction flush 的写回内容"完全取决于模型在那个静默 turn 里决定写什么"，而模型是在 compaction 截止压力下做判断，结果是"选择性、不一致的长期记忆……用户无法审计什么东西漏掉了"——这是"依赖 agent 自觉判断保存"的结构性失效：不是配置问题，而是架构问题。对策是 turn 级自动提取管道（Mem0 插件）："每个 turn 都在提取层被捕获——没有任何东西需要依赖 compaction 事件才能存活"，且事实变化时更新既有记忆而非两条并存。注意：该对比为 vendor 内容（Mem0 在推销自家插件），但其机制描述与 OpenClaw 官方文档一致，可信度中。

**案例 B（真实回归，社区报告）**：OpenClaw 社区（Discord，经 Answer Overflow 存档）报告某版本（Apr 6）之后 memory flush 停止工作——不再发生任何会产出 YYYY-MM-DD.md 的 pre-compaction flush。这说明"确定性触发 + 模型判断"的半自动管道自身也会静默失效，需要运行监测与可验证性。可信度：低-中（未验证具体版本与修复）。

**案例 C（对照基准）**：Mem0 论文（LOCOMO 基准）显示自动提取 + 结构化记忆在多会话记忆问答上显著优于 RAG 基线（Mem0 overall J 66.9% vs 最佳 RAG 60.6%），支持"管道化写回 + 检索优于依赖上下文重放"的方向；但该基准衡量的是检索质量而非写回可靠性，作为间接证据。

**对策共性（业界观察）**：
1. 触发点从"agent 判断"移向确定性生命周期事件（turn 后、compaction 前、session 结束、cron）。
2. 晋升/整备前设置确定性量化闸门（分数/召回次数/查询多样性）与结构性来源闸门，而非 LLM 自评。
3. supersession 取代 deletion + 溯源保留 + 重写 preimage，使任何维护可回滚、可审计。
4. 人类审查面（DREAMS.md、output memory store），晋升产物经批准/采纳才生效。
5. fail-safe 降级路径：校验失败 append-only、提取服务失败熔断暂停、dream 失败保留输入。

## 8. 横向对比

| 方案 | 写回触发 | 自动化程度 | 维护机制 | 破坏性删除 | 人工审批/审查面 |
| --- | --- | --- | --- | --- | --- |
| Mem0 | turn 后 add（应用层自动） | 全自动管道 | 去重 + tool-call 更新（默认 additive） | 否（须显式 delete） | 编辑历史/控制台 |
| OpenClaw | agent 主动写 + compaction 前 flush | 半自动 | dreaming 三相位 + 三闸门晋升 + consolidation 子代理 | 否（supersede + preimage + append 降级） | DREAMS.md + promote 预览 |
| Claude Code auto memory | 模型会中判断 | 半自动 | 索引预算闸门 + 会中重写 | 是（Claude 可删文件） | /memory 人工编辑 |
| Anthropic Dreams | API 触发（异步） | 自动管道 | 去重/陈旧替换/整备 → 新 store | 否（输入不可变） | 输出 store 人工 review 后采纳/丢弃 |
| Letta sleep-time | 后台 agent（频率可配） | 自动（模型驱动） | 后台 agent 重写 learned context | 视 agent 行为 | 未见 |
| Zep/Graphiti | ingestion 驱动 | 全自动管道 | bi-temporal 边失效 + 实体消解 | 否（标记失效） | 未见（平台审计） |

## 9. 对 Amber Memory Layer 的启示

Amber 治理红线：契约+闸门由 Amber、生成由 agent、审批落盘；read-only-first、never-overwrite-user-files、Amber 从不自己写知识文档。对照业界方案：

1. **写回触发必须确定性，不能依赖 agent 自觉**。业界共识是把触发绑到生命周期事件（turn 后 / compaction 前 / session 结束 / cron）；案例 A/B 证明"agent 判断"和"半自动管道静默失效"都会丢记忆。Amber 已有 session complete（completion-check 闸门）、handoff、learnings 检查点等确定性触发点，应在其上定义写回闸门：触发时 Amber 写 distillation 契约 → agent 生成草稿 → 人审批落盘。这正是 map #169 要求的"自动触发写回闸门"。
2. **两层记忆 + 带闸门的晋升是成熟模式**。OpenClaw 日记层→dreaming 晋升→MEMORY.md 与 Anthropic Dreams 的输入/输出分离同构，均匹配 Amber 的"自动生成草稿 + 审批后落盘"。建议：session 级记忆（transcript/handoff/context）为 append-only 工作层；晋升到长期层（MEMORY.md/wiki/learnings）必须过闸门，长期层只接受 gated 深写入。
3. **确定性闸门先于 LLM 整备**。OpenClaw 的经验是：LLM consolidation 只在量化闸门（分数/召回次数/查询多样性）与结构性 taint 闸门（untrusted provenance 不得进 consolidation prompt）之后运行。Amber 应把晋升标准做成契约的一部分（schema 可校验），agent 生成与人工审批在其后。

4. **溯源与 supersession 是维护的核心元数据**。Zep 双时间线边失效、OpenClaw 的 Source: path#Lx-Ly + supersession key、Claude Code 的 modified 时间戳、USER.md 的 active/superseded 标记，共同指向：记忆条目应带来源、观察时间、取代关系；淘汰优先"标记失效/归档"而非物理删除——与 Amber 的证据/溯源契约（ADR-0009 传统）一致。
5. **维护 loop = 受治理的 loop 契约**。dreaming 式后台整备应挂载为 workflow-packs loop 契约（execution.executesAnything: false、dry-run-first、recommend → 批准 → run），产出是提案而非直接写入——这是 map #169 "dreaming 式后台维护挂载为受治理 loop 契约"的落地形态。
6. **fail-safe 降级必备**。OpenClaw 的 append-only fallback、Mem0 熔断、Anthropic Dreams 输入不可变，都表明维护机制在失败时 fail-closed、绝不破坏既有记忆。Amber 应规定维护契约校验失败时不晋升、只出报告。
7. **可审计性是闸门证据**。每次晋升/重写留下审查表面（等价 DREAMS.md / governance report），与 Amber 的 handoff bundle、governance report 机制天然对应。

**自动化程度与治理可控性谱系**：自动化从低到高大致为 Claude Code auto memory（模型判断）< OpenClaw flush + dreaming（确定性触发 + 闸门晋升，落盘免审批）≈ Letta sleep-time（后台 agent 直接改写）< Mem0 / Zep（全自动管道，无人工闸门）。Amber 的定位应在 OpenClaw–Anthropic Dreams 区间且审批更强：草稿自动化、闸门确定性、落盘需审批。业界提供的是"生成半段"，Amber 补的是"治理半段"。

## 10. 未找到可靠来源 / 待验证

- Claude Code CLI 自身的 "dreaming"：未找到一手文档；Dreams 仅存在于 managed agents 平台 API。第三方"Claude dreaming"文章多为转述/再创作，可信度低-中。
- OpenClaw memory flush 失效的社区报告来自 Answer Overflow（Discord 存档），具体受影响版本、根因与修复过程未经验证。
- 独立的（非 vendor）第三方对照实验——"默认记忆的 agent 完全忘记上一会话项目上下文，而自动提取管道无缝续接"——未找到一手来源；第 7 节案例 A/B 是最接近的可得证据，且 A 带 vendor 利益。
- Hermes Agent 的记忆细节（2200/1375 字符上限、frozen system prompt）仅来自 Mem0 vendor 博客，未对照 Hermes 官方文档验证。

## 来源清单

1. Mem0 官方文档 How Mem0 Works — https://docs.mem0.ai/core-concepts/how-it-works（一手，高）
2. Mem0 论文（提取/更新双阶段、LOCOMO 评测）— https://arxiv.org/abs/2504.19413（一手，高）
3. OpenClaw 官方文档 Memory — https://docs.openclaw.ai/concepts/memory（一手，高）
4. OpenClaw 官方文档 Dreaming — https://docs.openclaw.ai/concepts/dreaming（一手，高）
5. Claude Code 官方文档 Memory — https://code.claude.com/docs/en/memory（一手，高）
6. Anthropic Dreams 官方文档 — https://platform.claude.com/docs/en/managed-agents/dreams（一手，高；research preview）
7. Letta Sleep-time Compute 博客 — https://www.letta.com/blog/sleep-time-compute/（vendor，中-高）
8. Sleep-time Compute 论文 — https://arxiv.org/abs/2504.13171（一手，高）
9. Zep 论文（时序知识图谱、边失效）— https://arxiv.org/abs/2501.13956（一手，vendor 作者）
10. Graphiti 开源仓库 — https://github.com/getzep/graphiti（一手，高）
11. Mem0 博客：OpenClaw Memory System 解析 — https://mem0.ai/blog/openclaw-memory-system-how-it-works-and-how-to-set-it-up（vendor，中）
12. Mem0 博客：OpenClaw vs Hermes 对比 — https://mem0.ai/blog/openclaw-vs-hermes-agent-memory-comparison（vendor，中）
13. OpenClaw 社区 memory flush 失效报告 — https://www.answeroverflow.com/m/1492398164399882260（社区存档，低-中）
