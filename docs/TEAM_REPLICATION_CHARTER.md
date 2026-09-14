# Team Replication Layer Charter

> 关联决策：amber-matt-scope-decision（2026-09-09）  
> 语言：中文正文；专有名词可保留英文。

---

## 1. 目的

把 Amber Protocol 冻结为仓库本地的 **team replication layer（团队复制层）**：

- 团队如何安全地用 AI 改 **这个** 仓库，以可检视文件的形式复制进仓库本身；
- 让会话 **可审查、有闸门、可交接**；证据在文件里，不在聊天记录里。

本 charter 约束范围与变更方式；不授权扩成 org-scale 平台或第二套 agent 运行时。

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

---

## 4. Integrate（集成、不拥有）

| 对象 | 规则 |
| --- | --- |
| 编码引擎 / 宿主 | 负责模型、agent loop、通用工具；Amber 经 skills / 插件 / MCP 挂载，不替代引擎 |
| Upper Shell（可选） | 仅经 MCP 消费 Amber；变更必须走 Approval Bridge；禁止直接写 .amber/；禁止把 agent loop 实现进 Amber 内核（见 PR 322 与 upper-shell README） |
| 旁路效果评估工具 | 可并列提供效果/证据洞察；不并入 Amber 内核承诺，不要求 Amber 变成评估平台 |

---

## 5. Exclude（硬非目标）

下列为产品边界，不是 backlog：

1. 通用 agent 操作系统 / 框架 / 第二运行时
2. Dynamic Workflow 执行器、live subagent 调度、自动执行用户项目命令
3. 组织级 Skill 市场、跨仓 MCP 网关、跨机器总控看板
4. Always-on / cron / daemon 调度 loop
5. 未批准覆盖已有项目文档
6. 绕过 MCP 或 Approval Bridge 写入治理态

---

## 6. Defer（本周期不做主承诺）

- Web Viewer 深度商业化叙事
- 分布式多仓 / 组织级同步作为首屏卖点
- 不与外部评估工具做代码级捆绑

实现可存在；首屏与对外一句定位不得升格。

---

## 7. 变更规则

1. 扩大 Own 面（新治理域、新对外承诺）：先改本 charter 草案 → 人工批 → 再改 SPEC/README。
2. 新增 Integrate 适配器：必须声明「消费者 only」；测试证明无对 .amber/ 的直写。
3. 任何把 agent loop / 调度器塞进 Amber Core 的 PR：默认拒绝，除非先修订本 charter 且人批。
4. Exclude 条目降级为「可做」：视为定位变更，需新一轮 scope 决策，不单靠实现 PR。
5. 文档合入：README 首屏与本 charter 冲突时，以已批准的 charter 为准，先改文案再合入。

---

## 8. 废止条件

若签名结果连续无法证明，或主用户明确只要运行时不要仓内证据，则暂停扩面，回到 Matt 范围审计，而不是叠加功能。
