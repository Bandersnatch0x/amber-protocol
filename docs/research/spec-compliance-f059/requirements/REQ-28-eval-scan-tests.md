# REQ-28 — eval 扫描目标的两项测试断言（vendor fixture 必出 finding；零文件扫描即 finding）

> "The eval scan target is tested with a fixture that vendors a model client in a contract-surface
> file and must produce a finding; a zero-file scan is itself a finding."
> — F059 spec L168-169

**Verdict:** implemented · confidence: high

---

## What this demands of an implementation

针对 `amber eval run` 的 QA contract-surface 扫描目标存在测试：
1. 用一个在 contract-surface 文件里 vendor 模型客户端的 fixture 测试，必须产出 finding；
2. 扫描到零个文件本身就是一个 finding（非空洞通过，F058 non-vacuous-pass 规则）。

---

## Where enforcement lives

测试文件：`tests/unit/instruction-surface-evals.test.js`（21 个测试），被核查对象是 `runInstructionSurfaceEvals`（`amber eval run` 的套件接缝，instruction-surface-evals.test.js:3-5 文件头明示"Detector functions are not a test seam"）。

**1. vendor fixture 必出 finding** — instruction-surface-evals.test.js:243-266：

```js
test("a QA contract-surface fixture with vendor and network clients fails only the QA eval", () => {
	const modelFile = path.join(tempDir("qa-vendor"), "knowledge-qa.ts");
	fs.writeFileSync(
		modelFile,
		'const client = require("' + "open" + "ai" + '");\n' +
			"fe" + "tch" + '("https://example.invalid");\n',
	);
	const suite = runInstructionSurfaceEvals(tempDir("qa-vendor-target"), {
		qaModelScanFiles: [modelFile],
	});
	assert.equal(suite.overall, "fail");
	assert.equal(suite.failedCount, 1);
	assert.equal(suite.modelIndependent, false);
	assert.equal(evalById(suite, EVAL_IDS.mcp).status, "pass");
	const qa = evalById(suite, EVAL_IDS.qa);
	assert.equal(qa.status, "fail");
	assert.deepEqual(findingCodes(suite, EVAL_IDS.qa), ["AMBER_E_EVAL_MODEL_DEPENDENCY"]);
	assert.match(qa.findings[0].detail, /^QA contract surface references/);
});
```

fixture 逐项对齐规格用词：文件名 `knowledge-qa.ts` 即 contract-surface 文件名；内容是 vendor 模型客户端 `require("openai")` **加**网络客户端 `fetch(url)`（源码里拆串拼接只为避免本测试文件自身被扫描时自我误报，写入 fixture 的字节是完整 token）。断言强度：**精确值**——finding code 用 `deepEqual` 钉成恰好一个 `AMBER_E_EVAL_MODEL_DEPENDENCY`、`failedCount` 精确 1、隔离性（mcp eval 仍 pass）、detail 前缀正则。

**2. 零文件扫描即 finding** — instruction-surface-evals.test.js:220-228：

```js
test("an empty QA contract-surface scan fails instead of passing vacuously", () => {
	const suite = runInstructionSurfaceEvals(tempDir("qa-empty"), { qaModelScanFiles: [] });
	assert.equal(suite.overall, "fail");
	assert.equal(suite.modelIndependent, true);
	const qa = evalById(suite, EVAL_IDS.qa);
	assert.equal(qa.status, "fail");
	assert.deepEqual(qa.scanned, { qaModelScanFiles: 0, qaModelScanPaths: [] });
	assert.ok(findingCodes(suite, EVAL_IDS.qa).includes("AMBER_E_EVAL_EMPTY_SCAN"));
});
```

强度：**精确值**（census 精确为零 + 套件整体 fail + `AMBER_E_EVAL_EMPTY_SCAN` finding 存在性）。

超出规格承诺的相邻覆盖（同文件）：
- 缺失 contract-surface 文件 → typed finding 而非崩溃（:230-241，`deepEqual(..., ["AMBER_E_EVAL_MODEL_DEPENDENCY"])` + detail `/^QA contract surface unreadable:/`）；
- 默认 census 钉死真实三文件路径并显式排除 provider adapter（:65-77 `deepEqual(qa.scanned, { qaModelScanFiles: 3, qaModelScanPaths: ["apps/web/server/lib/knowledge-qa.ts", "apps/web/server/routers/knowledge.ts", "apps/web/src/lib/knowledge-dto.ts"] })`；:286-294 断言 `knowledge-llm.ts` 不在扫描集——对应 spec L142-143 "The provider adapter is excluded by design"）；
- census 排序去重确定性（:268-284）。

---

## Paths walked

- ✓ fixture vendors a model client in a contract-surface file → must produce a finding：instruction-surface-evals.test.js:243-266（vendor `require("openai")` + 网络 `fetch`，finding code 精确 deepEqual，且只 fail QA eval）
- ✓ a zero-file scan is itself a finding：instruction-surface-evals.test.js:220-228（`AMBER_E_EVAL_EMPTY_SCAN`，overall fail）
- ✓（规格未逐字要求但同属该扫描目标）缺失文件 typed finding :230-241；真实 census 钉死 + adapter 排除 :65-77、:286-294

---

## Searched

- `Grep "qa-contract|knowledge-qa|contract-surface|zero-file|vendors|vendor" tests/unit/instruction-surface-evals.test.js` → 11 命中，全部落在 :65-294 区间（上引四组测试），tests/unit 其余文件无第二处 QA 扫描测试
- `EVAL_IDS.qa` 的套件接缝：scripts/lib/core/instruction-surface-evals.js（经 require :13-19），版本 2 四 Eval 套件形状由 :36-53 断言（`suite.version === 2`、`evalCount === 4`）
- CI 门：`.github/workflows/ci.yml:85-86` `npm test`（package.json:40 → scripts/run-tests.js，含 tests/unit）

---

## How the verdict was reached

两个断言点各自定位到独立测试，断言强度均为精确值级（finding code 全量 deepEqual、census 精确对象、隔离性断言），且 fixture 的构造逐字复现规格场景（contract-surface 文件名 + vendor 模型客户端）。运行取证：`node --test tests/unit/instruction-surface-evals.test.js` → **21 pass / 0 fail**（本机，duration 3.0s）。规格承诺之外还有缺失文件、census 钉死、排序去重、adapter 排除四组邻接断言，覆盖高于承诺但不与之矛盾，按承诺口径判 implemented，confidence high。

---

## Open questions

1. vendor fixture 经 `qaModelScanFiles` 参数注入扫描集，而非把 fixture 放进目标树由默认发现逻辑捡起——默认发现逻辑（真实三文件路径）由 :65-77 与 :286-294 独立钉死，两者合成后无缺口；但"fixture 在目标 repo 里被自动发现"这一端到端形态没有单独测试，若默认路径解析逻辑回归（例如仓库布局变更），报警点是 :66-73 的 census deepEqual 而非 vendor 测试本身。
2. `amber eval run` 的 CLI 出口（dispatch/exit code）不在本文件测试范围；本文件测的是套件函数接缝（文件头 :3-5 自述）。REQ-28 的规格文字只承诺"tested with a fixture"到 finding 产出，CLI 报告层通道属 spec L170 之外的 T7 admission 路径，未构成本条缺口。
