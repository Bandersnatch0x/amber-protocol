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

| T1（dogfood，计入本月 4 次分母） | 2026-09-22 | 本仓（dogfood） | F065–F069 五批 Harness 交付（今日真实任务） | 2026-09-22（本批 J0 自此表起算） | `session-handoff.md`（`amber handoff` 生成） | 新 agent 会话（盲读 handoff 单文件） | 是 | ①改了什么=**半对**（仓库状态 master/clean/f9451ce、63+4 特征对；但「最近完成的工作」归因到旧 G-1…G-11 会话——handoff 摘要锚定最后一次 amber session，F065–F069 未走 session 生命周期） ②谁批准=**部分改善**（F065 的 0069 用户确认证据行首次可从 handoff 读到；F066–F069 的确认未入证据行） ③证据在哪=**对**（聚焦测试 + 全量数字 + `.scratch/` 日志路径全部可核验） ④下一步=**错**（同一误触发：建议给已 accepted 的 F001 补 plan；后继者自己都标出「自相矛盾，值得先核实」） | **失败（2/4）** | 交付会话对照地面真值判定；判定人未读「被交接会话」的聊天 | 否 | handoff 会话摘要滞后于真实工作（未走 session 生命周期）；F001 plan 误触发未修 |

### T1 判定依据

- ①③ 与 git log（f9451ce、70d09e7 等五批）、feature_list（63 accepted + 4 passing = F066–F069 passing）一致；但「最近工作」被 handoff 摘要带偏到 G-1…G-11——摘要是 session 级的，而本仓近五批交付没有走 `amber session start` 生命周期，导致 handoff 叙事与 git 事实脱节。
- ② 相比 T0 是真实改善：F065 的 feature_list 证据行包含用户确认记录，盲答者读到了它。F066–F069 的确认（0076/0082/0088/0094）未写进各自证据行——同类信息不同批不同命。
- ④ 与 T0 同一误触发（next 对已 accepted 且无 plan 的 feature 仍建议补 plan），且盲答者主动标记了矛盾。
- 后继者为 AI 盲读代理而非人类；此为披露的限制，不冒充用户测试。

### T1 暴露的缺口（转 J7 候选；第一条为 T0 缺口的再现，后两条为新面）

1. （T0 再现）`amber next` 对已 accepted 且无 plan 的 feature 仍建议「补 plan」→ 验收态短路缺失。
2. （T1 新面）handoff 摘要锚定最后一次 amber session——不走 session 生命周期的交付在 handoff 里没有叙事；git 事实（最近提交、feature 状态）与 session 摘要脱节。
3. （T1 新面）确认/审批证据的落位不一致：F065 把用户确认写进了 feature 证据行，F066–F069 没有——同类治理事实应统一落位。

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
