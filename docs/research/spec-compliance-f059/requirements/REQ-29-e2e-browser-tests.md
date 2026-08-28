# REQ-29 — UI 六项行为在真实浏览器对 live CLI 数据源的验证

> "UI behavior (rendering, filters, jump links, Ask view, i18n, dual theme) is verified in a real
> browser against the live CLI data source — the prototype's Playwright checks are the baseline to
> reproduce against real data."
> — F059 spec L170-172

**Verdict:** implemented · confidence: medium

---

## What this demands of an implementation

Playwright（真实浏览器）e2e 测试覆盖六项行为——rendering、filters、jump links、Ask view、i18n、dual theme——且页面吃到的数据来自 live CLI 数据源（真实共享解析器端到端），不是 prototype 的 DTO fixture（spec L188-189："Its fixture is a DTO-shape reference only — the shipped surface reads real repository data end-to-end"）。

---

## Where enforcement lives

测试文件：`apps/web/tests/e2e/knowledge.spec.ts`（651 行，4 个 describe 套件）。真实浏览器：playwright.config.ts:84-89（`devices['Desktop Chrome'], channel: 'chrome'`——真 Chrome，非仅 chromium bundle）。CI 门真跑：.github/workflows/ci.yml:224-226（`npm run test:e2e`）；apps/web/package.json:13-14 使 `test:e2e` 先后跑无 key 模式与 `AMBER_E2E_SEMANTIC_STUB=1` 的 stub-provider 模式（`--grep 'user-triggered semantic stub'`）。

**数据源（核心问题：真实树还是 fixture）** — tests/e2e/globalSetup.ts:28-76：把**真实仓库的知识语料**（`docs/adr`、`docs/wiki/knowledge`、`docs/architecture`、`docs/knowledge-corpus`、`feature_list.json`、`MEMORY.md`，:46-64）复制进临时根，playwright.config.ts:27 将 `AMBER_REPO_ROOT` 指向它；web 服务器经共享解析器（`readKnowledgeGraphSnapshot` → `scripts/lib/web-adapter.js` → 真实 CLI parser）现算图——即 spec 所称的 live CLI data source 代码路径，不是预烘焙 DTO。三处策展偏差：feature paths 除 F001/F007 外置空（globalSetup.ts:66-73）、git 历史为合成 25 个真实 commit（:78-103）、外加一个 fixture session（:108）。反-fixture 断言在测试内显式存在：

```ts
await expect(page.locator('text=/fixture/i')).not.toBeVisible();
await expect(page.locator('text=/Failed to load knowledge graph/i')).not.toBeVisible();
```
（knowledge.spec.ts:96-97）

**逐项行为：**

1. **rendering** — knowledge.spec.ts:78-90：真实非平凡计数 `expect(total).toBeGreaterThanOrEqual(100)`、`expect(edges).toBeGreaterThanOrEqual(80)`、初载 `visible === total`；节点详情含真实 source path/context/anchors/edge rows/mini graph（:166-220），F001 死锚在真实数据上复现且徽标可见（:222-247 `scaffoldingAnchor.getByText(/dead anchor|死锚点/i)`）；`adr:0003` 的 `+N` 溢出指示 `parseInt(label) > 0`（:325-350）。
2. **filters** — 搜索命中收缩计数 `0 < hitVisible < total`、miss 归零 `missVisible === 0`（:102-125）；kind 过滤片收缩 `0 < filteredVisible < total`（:127-143）；布局切换 active 态（:145-164）。
3. **jump links** — ADR 详情跳转 `a[href="/governance"]` 可见（:217-219）；Recent 面板每条 link 禁 placeholder（`expect(target.href).not.toMatch(/placeholder|fixture/i)`，:306）、href 按 linkTo 精确成形（:307-319）、且**逐条 `page.request.get(href)` 断言 200**（:320-322）——链接目标真实可解析。
4. **Ask view** — 无 provider：提问后 `toContainText(/no LLM provider/i)` 且图仍可用（:387-398）；stub 模式：cited segments 渲染、`knowledge-citation-adr:0001` chip 点击后 `knowledge-node-adr:0001` 得 `border-amber-400` 高亮选中（:465-512）。
5. **i18n** — zh-CN 全页（标题"知识与决策地图"、zh 计数契约同 en、搜索占位、聚簇/分层/提问、面板"最近变更与漂移"、F001 详情"来源/上下文/锚点/死锚点/关卡"、Ask 视图 zh 文案，:515-579）；语言切换 en↔zh 存活图（:581-608）。
6. **dual theme** — 深色 palette 经 canvas 归一化通道值断言 `channel < 60`（:611-629 + :7-38）、浅色 `> 200`、in-app toggle 往返翻转且图保持可数（:631-651）。

补充（非本条主证据）：jsdom 客户端测试 apps/web/tests/client/KnowledgeMapPage.test.tsx（549 行：recent changes / semantic consent / semantic results / cited QA / i18n 五个 describe）覆盖同类交互，但非真实浏览器。

---

## Paths walked

- ✓ 真实浏览器：playwright.config.ts:84-89（Chrome channel）
- ✓ live CLI 数据源（非 DTO fixture）：globalSetup.ts:46-64 复制真实语料 + 服务器现算（knowledge-graph-reader → web-adapter → CLI parser）+ 反-fixture 哨兵断言 knowledge.spec.ts:92-100 —— 有三处策展偏差（见 Open questions）
- ✓ rendering：knowledge.spec.ts:78-90、:166-247、:325-350
- ✓ filters：knowledge.spec.ts:102-143（+:145-164）
- ✓ jump links：knowledge.spec.ts:217-219、:258-323（逐链接 HTTP 200）
- ✓ Ask view：knowledge.spec.ts:387-398（无 key）、:465-512（stub 引文交互）；两模式均入 `test:e2e`（apps/web/package.json:13-14）
- ✓ i18n：knowledge.spec.ts:515-608
- ✓ dual theme：knowledge.spec.ts:611-651

---

## Searched

- `ls apps/web/tests/e2e/` → knowledge.spec.ts、globalSetup.ts、globalTeardown.ts、theme.spec.ts 等
- playwright.config.ts:51-63 → 无 key 模式 `LLM_API_KEY: ''`；stub 模式 `AMBER_E2E_SEMANTIC_STUB=1` 时注入 stub provider
- `grep "test:e2e" apps/web/package.json` → :13 `"playwright test && npm run test:e2e:semantic"`、:14 stub 二段
- CI：ci.yml:220-226（`npx playwright install --with-deps` + `npm run test:e2e`）→ e2e 在 CI 真跑并当门
- prototype 基线对照：spec L186-189（worktree-knowledge-map 分支 fixture 仅为 DTO 形状参考）——e2e 复现了其交互项（force-cluster、mini graph、+N、jump links、edge rows、en/zh）

---

## How the verdict was reached

六项行为逐项定位到 Playwright 断言且多为精确值/精确交互断言（计数下限、HTTP 200、class 匹配、通道值区间），浏览器是真 Chrome，数据由真实共享解析器对真实仓库语料现算（同一批 F001 死锚、≥100 节点在 CLI 层被 REQ-25 独立证实），并显式断言页面不含 fixture 哨兵。CI 把 e2e（含两种 provider 模式）设为门。按任务约定 e2e 静态核读、未本地执行 Playwright；通过性证据为 CI 门 + 断言文本本身，故 implemented 但 confidence 取 medium 而非 high。

---

## Open questions

1. "live CLI data source" 的字面强度：e2e 树是真实语料的**临时策展复制**而非活仓根——feature paths 除 F001/F007 外被置空（globalSetup.ts:66-73，避免复制树里真实代码路径全部假性死锚）、git 历史是合成的 25 个 commit（:78-103）。数据源的"live"落在解析器代码路径与真实语料内容上；若按"必须对活仓根本体跑"的最严读法，此条降为 partial——spec L103 对 Recent 面板要求的是 "real ids from the live data source"，e2e 以逐链接 HTTP 200（knowledge.spec.ts:320-322）满足其意图。
2. 本次核查未执行 Playwright（任务允许静态读）；六项断言的最近一次本机通过记录来自 CI 与本会话早前的浏览器实测任务，不在本文件的取证命令内。若需 high confidence，补一次 `npm run test:e2e`（apps/web）运行记录即可。
3. `AMBER_E2E_SEMANTIC_STUB` 两模式互斥地 skip 对方套件（knowledge.spec.ts:354、:402），完整覆盖依赖 package.json:13 把两段串联执行——单独跑 `playwright test` 只得无 key 模式；CI 用的是串联脚本，无缺口，但本地手跑者可能漏掉 stub 段。
