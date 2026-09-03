# Dev workflow — Amber Protocol

任务级流水线：一个想法从提出到验收的固定路径。仓库门禁的权威定义在
`docs/wiki/AMBER_AGENT_OPERATING_MANUAL.md` §10；票据惯例在
`docs/agents/issue-tracker.md`。本文档只管**单条工作流内**的阶段顺序、横切机制与粘性规则。

## 流水线

| #   | 阶段 | 命令 / skill                          | 职责                                          | 出口判据                                                                                                     |
| --- | ---- | ------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | 路由 | `/external-review`                            | 判断当前情况该进哪个阶段                      | 指出下一个阶段命令                                                                                             |
| 2   | 探路 | `/wayfinder`                           | 超会话体量的工作 → 决策票地图（本地票仓 `issues/`） | 决策票全 resolved                                                                                              |
| 3   | 拷问 | `/grill-with-docs`                     | 逼问计划，沉淀 ADR + 词汇                     | 无未决问题；决策写入 `docs/adr/` 与 `UBIQUITOUS_LANGUAGE.md`                                                   |
| 4   | 成谱 | `/to-spec`                             | 会话 → spec，发布到本地票仓                   | spec 票建立（`issues/NNNN-<slug>.md`）                                                                         |
| 5   | 成票 | `/to-tickets`                          | spec → tracer-bullet 票 + blocking 边         | 票全建立且 `blocked-by` 边已声明                                                                               |
| 6   | 落码 | `/implement`                           | 按票实现                                      | 门禁全绿：`npm test`、`npm run manifests`、`npm run doctor`、`npm run gen:agents:check`（wiki 改动加 `node scripts/validate-wiki.js --target .`） |
| 7   | 验收 | `code-review` + `spec-to-code-compliance` | 全量测试通过后的双重核查                      | 两轴评审（Standards + Spec）findings 全部裁决；spec-to-code 合规核查无 contradicts；报告落 `.scratch/`，结论登记到票的 Log |

进入规则：小任务直接从 3（方向未定）或 4（方向已定）进入；bug 修复对着 GitHub bug 票从 6 进入；只有超出单会话体量的工作才走 2。阶段 7 对每次交付生效，不可跳过。

## 全量测试纪律

阶段 6→7 的门槛是**全量**测试：日志完整落盘到文件后整体读取，管道截断（`| tail` 之类）不算数。失败先归因——负载 flake 用空载复证、自伤清理后复证、既有红向历史溯源——再决定修复还是重锚。

## 横切机制（按触发条件生效，不占流水线位置）

| 机制               | 触发条件                                             | 产出                                                                     |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `discernment-nudge` | 给出方案、建议、草案、估算等用户将据以行动的内容时   | 附 2-3 个针对本次输出的检验追问（查事实 / 问推理 / 补上下文）             |
| `roundtable-debate` | 到达决策点（≥2 个存活选项待裁决）时                  | 按决策派生 3-5 个利益冲突视角辩论 → 裁决 + 异议记录 + 裁决批次           |

## 粘性规则（整条流水线生效，跨阶段不失效）

1. **点名即常驻**：用户点名过的分析 skill 在后续每个阶段继续使用，无需用户再次点名。
2. **裁决批次**：每批待裁决项输出编号清单并标注推荐项，让用户可用一句「全部按推荐」完成裁决。
3. **自研措辞**：吸收外部内容（skill / 文章 / 仓库）时一律改写为自研表述，上游名词不落入产品内容与 AGENTS.md。

## 依赖

阶段命令与横切机制都是用户全局 skills（`~/.agents/skills/`、`~/.claude/skills/`），不随本仓分发。缺失时按上表「职责」列手工执行等价步骤即可，流水线顺序不变。

## 产物落盘规则（跨阶段生效）

1. **三类产物三个家**：交付物进 `docs/` 对应子目录；本仓运行态进 `.amber/`；一切中间产物、外部 harness 输出、评审草稿、截图、日志进 `.scratch/<来源>/`。根级不新增任何文件。
2. **外部 harness 只写 `.scratch/`**：legacy、external-review skill、external-host、design tool、design-quality 等工具的产物一律落 `.scratch/<harness-name>/`。它们的产物要进交付物，必须经阶段 7 评审后由人手工移入 `docs/`，并在票的 Log 里记录来源。
3. **评审报告的归宿**：阶段 7 的评审报告先落 `.scratch/`；票关闭时，结论摘要进票的 Log，报告本体若有长期价值移入 `docs/quality/`，否则留在 `.scratch/` 随时可删。
4. **一个 F-number 三个文件**：`docs/specs/F0NN-*.md`、`docs/plans/F0NN-*.md`、`feature_list.json` 条目（含 `paths`）。缺任何一个，`amber review` 应报 warning。
5. **.gitignore 不是产物地图**：新增 ignore 条目前先问"这个产物为什么不在 `.scratch/`"。只有运行态和依赖才配单独条目。
6. **每周 dogfood 附带目录健康检查**：`git status --short --untracked-files=all | wc -l` 在完整测试后应为 0；根级文件数、docs 子目录数作为 governance report 的 maintenance 维度输入（P2 候选）。

## P2-04 目录大迁移延后

根级文档（`ROADMAP.md`、`PRODUCT.md`、`UBIQUITOUS_LANGUAGE.md`）和 `docs/` 内历史布局的批量迁移已规划为 P2-04 阶段工作。执行前提：clean worktree、迁移计划、引用图检查、corpus 重生成。F063 P0 交付不含该迁移。
