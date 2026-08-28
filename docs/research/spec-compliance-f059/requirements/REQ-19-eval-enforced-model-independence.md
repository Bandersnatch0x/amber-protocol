# REQ-19 — eval 强制模型无关面：QA 契约面文件扫 vendor/network token，复用 F058 词汇与非空洞通过规则，provider adapter 例外

> "The model-independent surface is enforced by eval: `amber eval run` scans the QA contract-surface files (prompt template, DTO schema, citation validator, ask handler) for vendor/network tokens, reusing the F058 vocabulary and non-vacuous-pass rule. The provider adapter is excluded by design — vendor confinement there is the #243 abstraction boundary."
> — F059 spec L140-143

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

1. `amber eval run` 包含一个扫描 QA 契约面文件的 eval。
2. 扫描清单覆盖四类契约面：prompt template、DTO schema、citation validator、ask handler。
3. 词汇（vendor/network token 集）复用 F058 的扫描词汇，而非另起一套。
4. 非空洞通过：零文件扫描本身是 finding；不可读文件不是静默跳过。
5. provider adapter（vendor 边界文件）被有意排除在扫描外。

---

## Where enforcement lives

**(1) eval 注册与接线** — eval 定义 `eval.instruction-surface.qa-contract-model-independence`（`scripts/lib/core/instruction-surface-evals.js:38`），实现 `evalQaContractModelIndependence`（同文件 L337-364），由 `runInstructionSurfaceEvals` 固定纳入四 eval 套件（L685-691），`eval run` 命令处理器直接调用它（`scripts/lib/eval-commands.js:134-154`）。本机实测：

```
node scripts/amber.js eval run --target . --json
→ "evalId": "eval.instruction-surface.qa-contract-model-independence",
  "status": "pass",
  "scanned": { "qaModelScanFiles": 3, "qaModelScanPaths": [
    "apps/web/server/lib/knowledge-qa.ts",
    "apps/web/server/routers/knowledge.ts",
    "apps/web/src/lib/knowledge-dto.ts" ] }
```

**(2) 四类契约面 → 三个文件的映射** — 扫描清单 `defaultQaModelScanFiles()`（`instruction-surface-evals.js:122-128`）。角色核对：
- prompt template：`CITED_QA_PROMPT`/`CITED_QA_PROMPT_VERSION`/`CITED_QA_PROMPT_HASH` 在 `apps/web/server/lib/knowledge-qa.ts:16-30` ✓（在扫描清单内）。
- DTO schema：`apps/web/src/lib/knowledge-dto.ts`（`KnowledgeAskResultDTO` 等，L73-105）✓；provider 输出的 zod schema `ProviderAnswerSchema` 也在 `knowledge-qa.ts:41-73` ✓。
- citation validator：`validateCitedAnswer`，`knowledge-qa.ts:167-214` ✓。
- ask handler：`knowledge.ask` procedure，`apps/web/server/routers/knowledge.ts:131-164` ✓（`answerKnowledgeQuestion` 编排在 `knowledge-qa.ts:216-244`，同在清单内）。

四个角色全部落在三个被扫文件中，无角色遗漏。

**(3) F058 词汇复用** — 两个 eval 共用**同一个正则对象**与同一扫描函数：词汇表 `MODEL_LIBRARY_TOKENS`/`MODEL_SCOPED_TOKENS`/`MODEL_CALL_CLIENTS` 及 `MODEL_NETWORK_RE`（`instruction-surface-evals.js:73-106`，token 以两段拼接防自扫命中，L63-70），扫描器 `evalModelIndependence`（L230-257）；F058 MCP eval 在 L299 调用它，QA eval 在 L339 调用它——字面同源，非复制品。

**(4) 非空洞通过** — 零文件：`scanSet.length === 0` → `AMBER_E_EVAL_EMPTY_SCAN`（L347-355）；不可读文件：readFileSync 失败 → `AMBER_E_EVAL_MODEL_DEPENDENCY` + `"QA contract surface unreadable"`（L236-244 经 opts L341-344）。测试锁定：`tests/unit/instruction-surface-evals.test.js:220-227`（空扫描 fail + EMPTY_SCAN）、L230-240（缺失文件 → 类型化 finding）、L243-265（fixture 植入 vendor/network client → 只有 QA eval fail，finding detail 匹配 `/^QA contract surface references/`——spec Testing Decisions L168-169 的 fixture 测试）、L268-283（清单排序去重确定性）。本机 `node --test` 21/21 通过。

**(5) provider adapter 排除** — `apps/web/server/lib/knowledge-llm.ts` 不在 `defaultQaModelScanFiles`（L122-128 仅三项）；其文件头 L1-4 注释 `"VENDOR-AWARE BOUNDARY — this is the ONLY module that may reference provider-specific HTTP endpoints..."` 即 #243 边界声明（该文件含 `'openai' | 'anthropic'` 字面量 L6 与 `fetch(` L246，进清单必然 fail——排除是设计而非巧合）。测试双重断言排除：`instruction-surface-evals.test.js:75-76` 与 L286-292。

---

## Paths walked

- ✓ `amber eval run --target .` 主路径：QA eval 执行、pass 且报告扫描 census（本机实测输出如上）。
- ✓ 契约面文件含 vendor token：fixture 测试注入后产出 `AMBER_E_EVAL_MODEL_DEPENDENCY`（测试 L243-265）。
- ✓ 扫描清单为空：EMPTY_SCAN finding（L347-355；测试 L220-227）。
- ✓ 清单文件缺失/不可读：类型化 finding 而非跳过（L236-244；测试 L230-240）。
- ✓ provider adapter 意外进清单的路径：默认清单硬编码三项（L122-128），无动态收集逻辑可把它加进来；`opts.qaModelScanFiles` 覆盖仅测试注入用。
- ✓ 词汇分叉路径：不可达——QA eval 无自有 token 表，只引用共享常量（L339 调 L230）。
- ✓ 非法 suite 名：`eval run --suite` 校验拒绝（`eval-commands.js:135-145`）。

---

## Searched

- `contract-surface|qa-contract` in `scripts/` → 2 文件：`lib/command-registry.js`（命令帮助文案）、`lib/core/instruction-surface-evals.js`（实现）。
- `defaultQaModelScanFiles` → 定义 L122、调用 L340、测试覆盖（census 断言 `instruction-surface-evals.test.js:66-74`）。
- `MODEL_NETWORK_RE` → 单一定义 L93，两处消费路径（L246 经 L299 与 L339）——无第二套词汇。
- `knowledge-llm` in `instruction-surface-evals.js` → 0 命中（排除是"不在场"而非"在场后滤除"）；测试以 `qaModelScanPaths` 反向断言（L75-76,286-292）。
- `openai|anthropic|fetch\(` in 三个被扫文件 → 0 命中（与 eval pass 一致）；in `knowledge-llm.ts` → 多处命中（L6,82,246,304 等），佐证排除的必要性。

---

## How the verdict was reached

不是 `partial`：四个角色逐一映射进被扫文件，词汇为字面同一对象，非空洞规则两个分支（零文件、不可读）都有类型化 finding 与通过的测试，adapter 排除有双重测试断言加实测 census——五项要求无失守路径。不是 `contradicted`：实测 eval pass 且 census 与代码清单一致。不是 `stronger-than-spec`：`scanned.qaModelScanPaths` 把被扫路径写进结果（L360-361）是 F058 census 惯例的延续，spec L140 "reusing the F058 ... rule" 已涵盖。不是 `undecidable`：spec 括号内四类文件的措辞按角色而非文件数解读，三文件覆盖四角色无歧义残留（残留量级入 Open questions 1）。

---

## Open questions

1. 清单是硬编码路径（`instruction-surface-evals.js:122-128`）与角色（prompt template / citation validator）之间无自动耦合：若日后把 `CITED_QA_PROMPT` 抽成独立文件而忘改清单，eval 仍 pass 但契约面出现未被扫描的盲区——census 只报数量与路径，不校验"四角色都被某个被扫文件承载"。
2. `MODEL_NETWORK_RE` 的 call-form 匹配 `\b(?:fetch|got|ky|request)\s*\(`（L98）对 TypeScript 属性简写如 `request: {`（`knowledge-qa.ts:230`）不命中——正确；但形如 `myFetch(` 的包装别名不在词汇内，词汇表的漏报边界继承自 F058，spec 允许（"reusing the F058 vocabulary"），仍属残余暴露面。
3. `knowledge-llm-prompts.ts`（semantic/summary 两 facade 的 prompt）不在 QA 清单也不在 F058 清单——它不属于 QA 契约面（QA prompt 在 knowledge-qa.ts），排除与 spec 一致，但语义层 prompt 面当前无任何 eval 覆盖，spec 未提出该要求（文档发现）。
