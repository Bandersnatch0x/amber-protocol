# Team Replication Layer Charter

> 关联决策：amber-scope-decision（2026-09-09）  
> 语言：中文正文；专有名词可保留英文。

---

## 1. 目的

把 Amber Protocol 冻结为仓库本地的 **team replication layer（团队复制层）**：

- 团队如何安全地用 AI 改 **这个** 仓库，以可检视文件的形式复制进仓库本身；
- 让会话 **可审查、有闸门、可交接**；证据在文件里，不在聊天记录里。

本 charter 约束范围与变更方式；不授权扩成 org-scale 平台或第二套 agent 运行时。唯一运行时例外是 ADR-0103/F079 的 **bounded maintenance runtime**：它只定时运行 Amber 内部闭注册表的确定性维护提案任务，不执行目标项目命令、不调度 agent、不运行 dynamic workflow、不写外部系统。

---

## 2. 签名结果（Signature outcome）

**后任工程师或后任 agent，只凭仓库内的计划 / 闸门 / 审批记录与 handoff 包，即可继续工作，而无需翻宿主聊天记录。**

最小证明：在样例仓走通「只读审计 → 初始化 → 自检 →（可选计划/闸门）→ handoff 打包与校验」，审阅者能复述「做了什么、谁批的、证据在哪」。

未达到该结果前，不提升平台级承诺。

---

## 3. Own（本层拥有）

| 能力 | 保证 | 拒绝 |
| --- | --- | --- |
| 仓内治理与证据协议 | plan / gate / approval / doctor / audit / handoff 以文件落盘 | 把聊天 transcript 当作唯一真相 |
| 默认只读 / dry-run | 变更可审计、人闸门显式 | 静默自动批准、隐藏执行 |
| 治理态与契约 | .amber/、rules、ledger、session 治理记录 | 宿主或外壳直接改写契约旁路 |
| 仓库本地生命周期 | 单仓复制与交接 | 假装已是跨仓 OS |
| 有界维护调度 | 人批 schedule；闭注册表 deterministic maintenance job；只读检查 + `.amber/harness/runtime/` append-only proposal/evidence/ledger；lease/fence、budget、no-progress、recovery | target command、agent、dynamic workflow、外部写、项目文档改写、自批 |
| 已获批执行的取消控制 | 仅控制已经过既有闸门的 execution；owned persisted handle、独立 cancel approval、race-safe terminal receipt/Evidence | 取消权变成启动权；用 cancel+release 冒充 kill；缺 receipt 猜成功 |

---

## 4. Integrate（集成、不拥有）

| 对象 | 规则 |
| --- | --- |
| 编码引擎 / 宿主 | 负责模型、agent loop、通用工具；Amber 经 skills / 插件 / MCP 挂载，不替代引擎；ADR-0103 的维护 runtime 不得调用这些 agent/模型能力 |
| Upper Shell（可选） | 仅经 MCP 消费 Amber；变更必须走 Approval Bridge；禁止直接写 .amber/；禁止把 agent loop 实现进 Amber 内核（见 PR 322 与 upper-shell README） |
| 旁路效果评估工具 | 可并列提供效果/证据洞察；不并入 Amber 内核承诺，不要求 Amber 变成评估平台 |

---

## 5. Exclude（硬非目标）

下列为产品边界，不是 backlog：

1. 通用 agent 操作系统 / 框架 / 第二套 agent 运行时
2. Dynamic Workflow 执行器、live subagent 调度、自动或定时执行用户项目命令
3. 组织级 Skill 市场、跨仓 MCP 网关、跨机器总控看板
4. 调度 target command、governed command、agent、外部 effect 的 always-on / cron / daemon；ADR-0103 只例外允许闭注册表的 Amber 内部 maintenance proposal runtime
5. caller-supplied scheduled code、自动 PR/issue/notification、外部系统写入
6. 未批准覆盖已有项目文档
7. 绕过 MCP 或 Approval Bridge 写入治理态
8. 复活/修补 ADR-0005 删除的 experimental daemon/autonomous executor（H7 必须全新实现）

---

## 6. Defer（本周期不做主承诺）

- Web Viewer 深度商业化叙事
- **首屏定位（F082 已翻）**：首屏现为「面向真实工程系统的受治理 Agent Harness / Amber Protocol 是 AI Agent 与真实系统之间的治理执行边界」（ADR-0030 F082 修正案，2026-09-24）；该修正案同时记录了 scope override（以内仓 H7 + 取消验收证据替代外部试点信号）。
- 分布式多仓 / 组织级同步作为首屏卖点
- 不与外部评估工具做代码级捆绑

实现可存在；首屏与对外一句定位不得升格。

---

## 7. 变更规则

1. 扩大 Own 面（新治理域、新对外承诺）：先改本 charter 草案 → 人工批 → 再改 SPEC/README。
2. 新增 Integrate 适配器：必须声明「消费者 only」；测试证明无对 .amber/ 的直写。
3. 任何把 agent loop / target-command 调度器塞进 Amber Core 的 PR：默认拒绝。ADR-0103/F079 只批准 bounded maintenance runtime；扩大 job registry、写入面、effect 或 authority tuple 必须重新修订 charter 并人批。
4. Maintenance Schedule 必须 human-approved、scoped、expiring、revocable；固定 `executesAnything=false`、`schedulesJobs=true`、`dispatchesAgents=false`、`writesExternalSystems=false`；既有 loop/workflow contract 继续 `schedulesJobs=false`。
5. Live cancellation 只有在 owned persisted handle、独立 cancel approval、race-safe settlement、restart reconciliation、terminal receipt/Evidence 全部存在时才能替换 F078 拒绝；取消权不授予启动权。
6. Exclude 条目降级为「可做」：视为定位变更，需新一轮 scope 决策，不单靠实现 PR。
7. 文档合入：README 首屏与本 charter 冲突时，以已批准的 charter 为准，先改文案再合入；F079 不改首页定位，§55 翻转需 H7+cancel 验收证据与独立 HITL。

---

## 8. 废止条件

若签名结果连续无法证明，或主用户明确只要运行时不要仓内证据，则暂停扩面，回到既定范围审计，而不是叠加功能。
