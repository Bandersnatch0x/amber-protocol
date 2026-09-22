# Continuation Log

手工续接判定账本。北极星的唯一数据源：不读旧聊天、仅凭仓内 plan/evidence/handoff，由新人或新 agent 正确继续的真实任务比例。Dogfood 与外部仓分开记账；本表是手工表格，不埋点、不改代码。测量规则见 `docs/wiki/product/user-scenarios.md` 旅程指标与 goals 校准（2026-09-22）：`init` 次数、命令退出码、文件存在性、session 计数一律不进分子；判定人不得是刚写出该 handoff 的同一会话。

## 记录

| # | 日期 | 仓 | 任务 | J0 时刻 | Handoff 路径 | 后继者 | 禁读聊天 | 四格结果 | 判定 | 判定人 | 翻聊天 | 缺失工件 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T0（试跑，不计分子） | 2026-09-22 | 本仓（dogfood） | G-1…G-11 trusted-control 治理切片（最近完成会话） | 未记（会话早于本表） | `session-handoff.md`（`amber handoff` 生成） | 新 agent 会话（盲读 handoff 单文件） | 是 | ①改了什么=对 ②谁批准=包内无审批痕迹（真值：人工 `--yes` 委托）→缺 ③证据在哪=对（命令 + `.scratch/` 日志路径可核验） ④下一步=建议给已 accepted 的 F001 补建 plan →过期误导 | **失败（2/4）** | 交付会话对照地面真值判定；判定人未读「被交接会话」的聊天 | 否 | 审批/评审记录未进 handoff；`next` 对已验收 feature 误触发 plan 建议 |

### T0 判定依据

- ①③ 与 git log（`2a3a500`、`62a021c`、`25a6104`）、feature 状态、`.scratch/` 日志一致。
- ② 真值是会话内的人工路由门（`--yes` 委托批准），handoff 不携带任何审批痕迹；后继者必须追问 → 按杀死规则该格失败。
- ④ `amber next` 自动选中 F001 并建议补 plan；F001 已 accepted 且实现早已落地，建议不成立。
- 后继者为 AI 盲读代理而非人类；此为披露的限制，不冒充用户测试。

### T0 暴露的两条产品缺口（转 J7 候选，不自动修）

1. Handoff 包不含 Approval/Review 维度 → 后继者无法回答「谁批准」。
2. `amber next` 对已 accepted 且无 plan 的 feature 仍建议「补 plan」→ 建议器缺验收态短路。

## 护栏快照

| 护栏 | 值 | 核对日 |
| --- | --- | --- |
| 默认帮助动词数 | 7（audit, init, doctor, next, plan, handoff, session） | 2026-09-22 |
| J0–J2 必调命令数 | 6（session 不作 J2 完成条件） | 2026-09-22 |
| 误续接（越范围/跳审批） | 0 起（观测中） | 2026-09-22 |
| 覆盖用户文件 | 0 起（T0 未触发 init 覆盖） | 2026-09-22 |
| dogfood 冒充外部 | 0（T0 已标注 dogfood 账本） | 2026-09-22 |

## 本月验收（至 2026-10-22）

本仓 dogfood 账本 ≥4 次禁读聊天的续接尝试，全有判定（比例允许 0/4）；每次失败记录缺失工件名；本仓 Activation 分母记 1 或 0（doctor 可复验 + 本月 ≥1 次通过 J2），并得出第一个 Time to Trusted Continuation。不招募外部仓。

## 本季验收（至 2026-12-22）

二者其一，季末如实写入：①「未验证」——外部独立仓真实续接尝试仍为 0；②「第一个外部仓」——非本仓、非维护者日常开发的仓库完成 J0→doctor 可复验→≥3 次已判定的真实 J2 尝试。2×10 不是本季接受条件。护栏四项无恶化。

## 明确不作为数据源

`docs/quality/external-adoption-evidence.json`（兴趣信号且已过期）、`docs/examples/` 审计输出、`docs/dogfood-weekly.md`（仪式说明）、单元测试/文件存在/init 成功/session 计数。
