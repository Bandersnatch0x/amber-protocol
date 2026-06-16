# 多平台 Agent Skill 分发 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Amber 核心 5 命令（init/audit/wiki/doctor/handoff）封装为多平台 agent skill（修 SKILL.md）+ 手动 slash 命令（生成器派生 Claude `.md` 与 Gemini `.toml`），对齐两个 plugin manifest，新建根 `AGENTS.md`，全部由单一来源驱动并有测试守护。

**Architecture:** `skills/<name>/SKILL.md` 是单一来源；其 frontmatter 含标准 `name`/`description`（四家平台 skill 层直接读）+ 单行 `x-amber-json`（仅生成器读）。核心逻辑放 `scripts/lib/core/agent-commands.js`（纯函数、可测），CLI 入口 `scripts/gen-agent-commands.js` 薄封装（与项目 `amber.js → lib/core` 模式一致）。生成器幂等覆盖产物，`--check` 模式供 CI 防漂移。

**Tech Stack:** Node.js ≥18.17（CommonJS）、`node:test` + `node:assert`、零新增第三方依赖（手写 frontmatter 提取 + 最小 TOML 渲染，`JSON.parse` 解析 `x-amber-json`）。

**实现细化说明（相对 spec）：** spec §6.A 的 `x-amber` YAML 块，本计划以**单行 `x-amber-json:`** 落地——理由：项目无 YAML 库，单行 JSON 用内置 `JSON.parse` 解析最可靠，且仍是合法 YAML（平台读 frontmatter 时作为未知键忽略）。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `scripts/lib/core/agent-commands.js` | 解析 SKILL.md frontmatter、渲染 Claude/Gemini 命令、扫描收集、生成/校验 | 新建 |
| `scripts/gen-agent-commands.js` | CLI 入口：`--check` 解析、调用 core、退出码 | 新建 |
| `tests/unit/agent-commands.test.js` | 上述核心逻辑的单元测试 | 新建 |
| `skills/amber-init/SKILL.md` 等 5 个 | 修命令路径 + 加 `x-amber-json` | 修改 |
| `scripts/amber.js` | 导出 `COMMANDS`（供防漂移测试） | 修改（1 行） |
| `.claude-plugin/plugin.json` | version → 1.0.0 | 修改 |
| `.codex-plugin/plugin.json` | version → 1.0.0、skills 路径理顺 | 修改 |
| `AGENTS.md`（仓库根） | 通用标准入口，命令速查 | 新建 |
| `package.json` | 加 `gen:agents` / `gen:agents:check` | 修改 |
| `.claude/commands/amber-*.md`、`.gemini/commands/amber/*.toml` | 生成产物 | 由生成器产出并提交 |

当前分支：`feat/agent-skill-distribution`。

---

### Task 1: 核心模块骨架 + frontmatter 解析

**Files:**
- Create: `scripts/lib/core/agent-commands.js`
- Test: `tests/unit/agent-commands.test.js`

- [ ] **Step 1: 写失败测试**

`tests/unit/agent-commands.test.js`:

```js
const { describe, it } = require("node:test");
const assert = require("assert");
const {
	parseSkillFrontmatter,
} = require("../../scripts/lib/core/agent-commands");

describe("parseSkillFrontmatter", () => {
	it("parses name, description, and x-amber-json", () => {
		const md = [
			"---",
			"name: amber-init",
			"description: Install the scaffold.",
			'x-amber-json: {"command":"node scripts/amber.js init --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-init"}',
			"---",
			"",
			"# Body",
		].join("\n");
		const result = parseSkillFrontmatter(md);
		assert.strictEqual(result.name, "amber-init");
		assert.strictEqual(result.description, "Install the scaffold.");
		assert.strictEqual(
			result.amber.command,
			"node scripts/amber.js init --target {{target}}",
		);
		assert.strictEqual(result.amber.args[0].name, "target");
		assert.strictEqual(result.amber.manualName, "amber-init");
	});

	it("returns amber:null when x-amber-json is absent", () => {
		const md = ["---", "name: amber-x", "description: No amber.", "---"].join(
			"\n",
		);
		const result = parseSkillFrontmatter(md);
		assert.strictEqual(result.name, "amber-x");
		assert.strictEqual(result.amber, null);
	});

	it("returns null when there is no frontmatter", () => {
		assert.strictEqual(parseSkillFrontmatter("# just markdown"), null);
	});

	it("throws on invalid x-amber-json", () => {
		const md = ["---", "name: a", "x-amber-json: {not json}", "---"].join("\n");
		assert.throws(() => parseSkillFrontmatter(md), /x-amber-json/);
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: FAIL — `Cannot find module '../../scripts/lib/core/agent-commands'`

- [ ] **Step 3: 写最小实现**

`scripts/lib/core/agent-commands.js`:

```js
"use strict";

function stripQuotes(value) {
	const t = String(value).trim();
	if (
		(t.startsWith('"') && t.endsWith('"')) ||
		(t.startsWith("'") && t.endsWith("'"))
	) {
		return t.slice(1, -1);
	}
	return t;
}

function parseSkillFrontmatter(markdown) {
	const text = String(markdown || "");
	const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) {
		return null;
	}
	const lines = match[1].split(/\r?\n/);
	const result = { name: null, description: null, amber: null };
	for (const line of lines) {
		const nameMatch = line.match(/^name:\s*(.+?)\s*$/);
		if (nameMatch) {
			result.name = stripQuotes(nameMatch[1]);
			continue;
		}
		const descMatch = line.match(/^description:\s*(.+?)\s*$/);
		if (descMatch) {
			result.description = stripQuotes(descMatch[1]);
			continue;
		}
		const amberMatch = line.match(/^x-amber-json:\s*(.+?)\s*$/);
		if (amberMatch) {
			try {
				result.amber = JSON.parse(amberMatch[1]);
			} catch (error) {
				throw new Error(`Invalid x-amber-json in frontmatter: ${error.message}`);
			}
		}
	}
	return result;
}

module.exports = {
	parseSkillFrontmatter,
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/core/agent-commands.js tests/unit/agent-commands.test.js
git commit -m "feat: add SKILL.md frontmatter parser for agent command generation"
```

---

### Task 2: 提取命令短名 + Claude `.md` 渲染

**Files:**
- Modify: `scripts/lib/core/agent-commands.js`
- Test: `tests/unit/agent-commands.test.js`

- [ ] **Step 1: 追加失败测试**

在 `tests/unit/agent-commands.test.js` 顶部 require 增补：

```js
const {
	parseSkillFrontmatter,
	extractCommandName,
	renderClaudeCommand,
} = require("../../scripts/lib/core/agent-commands");
```

在文件末尾追加：

```js
const SAMPLE_SKILL = {
	name: "amber-init",
	description: "Install the V1 Amber Protocol scaffold.",
	amber: {
		command: "node scripts/amber.js init --target {{target}}",
		args: [{ name: "target", hint: "repo path", default: "." }],
		manualName: "amber-init",
	},
};

describe("extractCommandName", () => {
	it("pulls the amber subcommand from the command string", () => {
		assert.strictEqual(
			extractCommandName("node scripts/amber.js init --target {{target}}"),
			"init",
		);
	});
});

describe("renderClaudeCommand", () => {
	const output = renderClaudeCommand(SAMPLE_SKILL);

	it("starts with YAML frontmatter carrying the description", () => {
		assert.match(output, /^---\ndescription: Install the V1 Amber Protocol scaffold\.\n/);
	});

	it("includes an argument-hint and a GENERATED marker", () => {
		assert.match(output, /argument-hint: \[target\]/);
		assert.match(output, /GENERATED/);
	});

	it("substitutes {{target}} with the positional $1", () => {
		assert.match(output, /node scripts\/amber\.js init --target \$1/);
		assert.doesNotMatch(output, /\{\{target\}\}/);
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: FAIL — `extractCommandName is not a function`

- [ ] **Step 3: 实现并导出**

在 `scripts/lib/core/agent-commands.js` 的 `module.exports` 之前插入：

```js
function extractCommandName(command) {
	const match = String(command).match(/amber\.js\s+([a-z][a-z0-9-]*)/i);
	return match ? match[1] : null;
}

function applyPositionalArgs(command, args) {
	let result = command;
	(args || []).forEach((arg, index) => {
		result = result.split(`{{${arg.name}}}`).join(`$${index + 1}`);
	});
	return result;
}

function renderClaudeCommand(skill) {
	const args = skill.amber.args || [];
	const argHint = args.map((arg) => `[${arg.name}]`).join(" ");
	const commandLine = applyPositionalArgs(skill.amber.command, args);
	const lines = [
		"---",
		`description: ${skill.description}`,
	];
	if (argHint) {
		lines.push(`argument-hint: ${argHint}`);
	}
	lines.push(
		"---",
		"",
		"<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->",
		"",
		`Run the Amber **${skill.name}** workflow for the target repository.`,
		"If no target is given, use the current repository root (\`.\`).",
		"",
		`Execute: \`${commandLine}\``,
		"",
		"Report the command output faithfully. Do not overwrite user-authored files without approval.",
		"",
	);
	return lines.join("\n");
}
```

更新 `module.exports`:

```js
module.exports = {
	parseSkillFrontmatter,
	extractCommandName,
	applyPositionalArgs,
	renderClaudeCommand,
};
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/core/agent-commands.js tests/unit/agent-commands.test.js
git commit -m "feat: render Claude slash command markdown from skill metadata"
```

---

### Task 3: Gemini `.toml` 渲染

**Files:**
- Modify: `scripts/lib/core/agent-commands.js`
- Test: `tests/unit/agent-commands.test.js`

- [ ] **Step 1: 追加失败测试**

require 增补 `renderGeminiCommand`，文件末尾追加：

```js
describe("renderGeminiCommand", () => {
	const output = renderGeminiCommand(SAMPLE_SKILL);

	it("opens with a TOML comment GENERATED marker", () => {
		assert.match(output, /^# GENERATED/);
	});

	it("emits a quoted description field", () => {
		assert.match(output, /description = "Install the V1 Amber Protocol scaffold\."/);
	});

	it("emits a triple-quoted prompt containing {{args}}", () => {
		assert.match(output, /prompt = """[\s\S]*\{\{args\}\}[\s\S]*"""/);
		assert.match(output, /node scripts\/amber\.js init --target \{\{args\}\}/);
	});

	it("escapes embedded double quotes in description", () => {
		const out = renderGeminiCommand({
			...SAMPLE_SKILL,
			description: 'Use "quotes" here.',
		});
		assert.match(out, /description = "Use \\"quotes\\" here\."/);
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: FAIL — `renderGeminiCommand is not a function`

- [ ] **Step 3: 实现并导出**

在 `agent-commands.js` 插入（`module.exports` 前）：

```js
function applyGeminiArgs(command, args) {
	const list = args || [];
	if (list.length === 0) {
		return command;
	}
	return command.split(`{{${list[0].name}}}`).join("{{args}}");
}

function escapeTomlBasic(value) {
	return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderGeminiCommand(skill) {
	const promptCommand = applyGeminiArgs(skill.amber.command, skill.amber.args);
	return [
		"# GENERATED — edit skills/ instead. Run: npm run gen:agents",
		`description = "${escapeTomlBasic(skill.description)}"`,
		'prompt = """',
		`Run the Amber ${skill.name} workflow for the target repository.`,
		"If no target is provided, use the current repository root (.).",
		`Execute: ${promptCommand}`,
		"Report the command output faithfully; never overwrite user-authored files without approval.",
		'"""',
		"",
	].join("\n");
}
```

`module.exports` 增加 `renderGeminiCommand`、`applyGeminiArgs`、`escapeTomlBasic`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/core/agent-commands.js tests/unit/agent-commands.test.js
git commit -m "feat: render Gemini TOML command from skill metadata"
```

---

### Task 4: 扫描收集 skills 目录

**Files:**
- Modify: `scripts/lib/core/agent-commands.js`
- Test: `tests/unit/agent-commands.test.js`

- [ ] **Step 1: 追加失败测试**（用临时目录做 fixture）

require 增补 `collectAmberSkills`；在 `tests/unit/agent-commands.test.js` 顶部追加：

```js
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function makeTempSkills(entries) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-skills-"));
	for (const [dir, contents] of Object.entries(entries)) {
		const skillDir = path.join(root, dir);
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(path.join(skillDir, "SKILL.md"), contents);
	}
	return root;
}
```

文件末尾追加：

```js
describe("collectAmberSkills", () => {
	it("returns only skills that declare x-amber-json, sorted by name", () => {
		const root = makeTempSkills({
			"amber-wiki":
				'---\nname: amber-wiki\ndescription: Wiki.\nx-amber-json: {"command":"node scripts/amber.js wiki --target {{target}}","args":[{"name":"target"}],"manualName":"amber-wiki"}\n---\n',
			"amber-init":
				'---\nname: amber-init\ndescription: Init.\nx-amber-json: {"command":"node scripts/amber.js init --target {{target}}","args":[{"name":"target"}],"manualName":"amber-init"}\n---\n',
			"amber-plain": "---\nname: amber-plain\ndescription: No amber.\n---\n",
		});
		const skills = collectAmberSkills(root);
		assert.strictEqual(skills.length, 2);
		assert.deepStrictEqual(
			skills.map((s) => s.name),
			["amber-init", "amber-wiki"],
		);
	});

	it("returns empty array when the skills root is missing", () => {
		assert.deepStrictEqual(collectAmberSkills("/no/such/dir/amber"), []);
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: FAIL — `collectAmberSkills is not a function`

- [ ] **Step 3: 实现**

在 `agent-commands.js` 顶部补依赖（`"use strict";` 之后）：

```js
const fs = require("node:fs");
const path = require("node:path");
const { pathExists, readText } = require("./fs-utils");
```

插入函数：

```js
function collectAmberSkills(skillsRoot) {
	if (!pathExists(skillsRoot)) {
		return [];
	}
	const entries = fs
		.readdirSync(skillsRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory());
	const skills = [];
	for (const entry of entries) {
		const skillFile = path.join(skillsRoot, entry.name, "SKILL.md");
		if (!pathExists(skillFile)) {
			continue;
		}
		const parsed = parseSkillFrontmatter(readText(skillFile));
		if (parsed && parsed.amber) {
			skills.push(parsed);
		}
	}
	return skills.sort((a, b) => a.name.localeCompare(b.name));
}
```

`module.exports` 增加 `collectAmberSkills`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/core/agent-commands.js tests/unit/agent-commands.test.js
git commit -m "feat: scan skills directory for amber command metadata"
```

---

### Task 5: 生成 / 校验（含幂等与 CRLF 归一）

**Files:**
- Modify: `scripts/lib/core/agent-commands.js`
- Test: `tests/unit/agent-commands.test.js`

- [ ] **Step 1: 追加失败测试**

require 增补 `generateAgentCommands`；文件末尾追加：

```js
describe("generateAgentCommands", () => {
	function setup() {
		const skillsRoot = makeTempSkills({
			"amber-init":
				'---\nname: amber-init\ndescription: Init.\nx-amber-json: {"command":"node scripts/amber.js init --target {{target}}","args":[{"name":"target"}],"manualName":"amber-init"}\n---\n',
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));
		return { skillsRoot, repoRoot };
	}

	it("writes Claude .md and Gemini .toml products", () => {
		const { skillsRoot, repoRoot } = setup();
		const result = generateAgentCommands({ skillsRoot, repoRoot });
		assert.strictEqual(result.changed, true);
		assert.ok(
			fs.existsSync(path.join(repoRoot, ".claude/commands/amber-init.md")),
		);
		assert.ok(
			fs.existsSync(path.join(repoRoot, ".gemini/commands/amber/init.toml")),
		);
	});

	it("is idempotent — second run reports no changes", () => {
		const { skillsRoot, repoRoot } = setup();
		generateAgentCommands({ skillsRoot, repoRoot });
		const second = generateAgentCommands({ skillsRoot, repoRoot });
		assert.strictEqual(second.changed, false);
		assert.deepStrictEqual(second.stale, []);
	});

	it("check mode reports stale without writing", () => {
		const { skillsRoot, repoRoot } = setup();
		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.strictEqual(result.changed, true);
		assert.ok(result.stale.length > 0);
		assert.strictEqual(
			fs.existsSync(path.join(repoRoot, ".claude/commands/amber-init.md")),
			false,
		);
	});

	it("treats CRLF-only differences as unchanged", () => {
		const { skillsRoot, repoRoot } = setup();
		generateAgentCommands({ skillsRoot, repoRoot });
		const file = path.join(repoRoot, ".claude/commands/amber-init.md");
		fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
		const check = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.strictEqual(check.changed, false);
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: FAIL — `generateAgentCommands is not a function`

- [ ] **Step 3: 实现**

在 `agent-commands.js` 顶部 require 增补：

```js
const { relativeSlash } = require("./fs-utils");
```

插入函数：

```js
function normalizeEol(value) {
	return String(value).replace(/\r\n/g, "\n");
}

function planOutputs(skills, repoRoot) {
	const outputs = [];
	for (const skill of skills) {
		const shortName = extractCommandName(skill.amber.command);
		outputs.push({
			path: path.join(
				repoRoot,
				".claude",
				"commands",
				`${skill.amber.manualName}.md`,
			),
			content: renderClaudeCommand(skill),
		});
		outputs.push({
			path: path.join(
				repoRoot,
				".gemini",
				"commands",
				"amber",
				`${shortName}.toml`,
			),
			content: renderGeminiCommand(skill),
		});
	}
	return outputs;
}

function generateAgentCommands({ skillsRoot, repoRoot, check = false }) {
	const skills = collectAmberSkills(skillsRoot);
	const outputs = planOutputs(skills, repoRoot);
	const stale = [];
	for (const output of outputs) {
		const existing = pathExists(output.path) ? readText(output.path) : null;
		const isStale =
			existing === null ||
			normalizeEol(existing) !== normalizeEol(output.content);
		if (isStale) {
			stale.push(relativeSlash(repoRoot, output.path));
			if (!check) {
				fs.mkdirSync(path.dirname(output.path), { recursive: true });
				fs.writeFileSync(output.path, output.content);
			}
		}
	}
	return {
		written: outputs.map((output) => relativeSlash(repoRoot, output.path)),
		stale,
		changed: stale.length > 0,
	};
}
```

`module.exports` 增加 `generateAgentCommands`。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: PASS（全部 describe 通过）

- [ ] **Step 5: 提交**

```bash
git add scripts/lib/core/agent-commands.js tests/unit/agent-commands.test.js
git commit -m "feat: generate and check agent command products idempotently"
```

---

### Task 6: CLI 入口 `scripts/gen-agent-commands.js`

**Files:**
- Create: `scripts/gen-agent-commands.js`

- [ ] **Step 1: 写实现**（薄封装，遵循 `amber.js` 的 `require.main` 模式）

`scripts/gen-agent-commands.js`:

```js
#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { generateAgentCommands } = require("./lib/core/agent-commands");

function main(argv = process.argv.slice(2)) {
	const check = argv.includes("--check");
	const repoRoot = path.resolve(__dirname, "..");
	const skillsRoot = path.join(repoRoot, "skills");
	const result = generateAgentCommands({ skillsRoot, repoRoot, check });

	if (check) {
		if (result.changed) {
			console.error("Agent command files are stale. Run: npm run gen:agents");
			for (const file of result.stale) {
				console.error(`  stale: ${file}`);
			}
			return 1;
		}
		console.log(`Agent command files up to date (${result.written.length} files).`);
		return 0;
	}

	console.log(`Generated ${result.written.length} agent command files:`);
	for (const file of result.written) {
		console.log(`  ${file}`);
	}
	return 0;
}

if (require.main === module) {
	process.exitCode = main();
}

module.exports = { main };
```

- [ ] **Step 2: 手动 smoke（此时 skills 尚未加 x-amber-json，应生成 0 个文件、退出 0）**

Run: `node scripts/gen-agent-commands.js`
Expected: `Generated 0 agent command files:`（退出码 0）

- [ ] **Step 3: 提交**

```bash
git add scripts/gen-agent-commands.js
git commit -m "feat: add gen-agent-commands CLI entry point"
```

---

### Task 7: 接线 npm scripts

**Files:**
- Modify: `package.json:11-19`（`scripts` 块）

- [ ] **Step 1: 加两条 script**

在 `package.json` 的 `"scripts"` 对象内、`"test:e2e"` 行之后加：

```json
		"gen:agents": "node scripts/gen-agent-commands.js",
		"gen:agents:check": "node scripts/gen-agent-commands.js --check"
```

（注意给前一行 `"test:e2e": "..."` 补上行尾逗号。）

- [ ] **Step 2: 验证可运行**

Run: `npm run gen:agents:check`
Expected: `Agent command files up to date (0 files).`（退出码 0；此时无 x-amber-json，无产物）

- [ ] **Step 3: 提交**

```bash
git add package.json
git commit -m "chore: wire gen:agents and gen:agents:check npm scripts"
```

---

### Task 8: 导出 `COMMANDS` + 修复 5 个 SKILL.md + 防漂移测试

**Files:**
- Modify: `scripts/amber.js:912`（`module.exports`）
- Modify: `skills/amber-init/SKILL.md`、`skills/amber-audit/SKILL.md`、`skills/amber-wiki/SKILL.md`、`skills/amber-doctor/SKILL.md`、`skills/amber-handoff/SKILL.md`
- Test: `tests/unit/agent-commands.test.js`

- [ ] **Step 1: 导出 COMMANDS**

`scripts/amber.js` 末尾改：

```js
module.exports = { run, usage, COMMANDS };
```

- [ ] **Step 2: 写失败测试（防漂移 + 真实 skills 收集）**

在 `tests/unit/agent-commands.test.js` 末尾追加：

```js
const { COMMANDS } = require("../../scripts/amber.js");

describe("real skills integration", () => {
	const repoRoot = path.resolve(__dirname, "../..");
	const skills = collectAmberSkills(path.join(repoRoot, "skills"));

	it("discovers the five core skills", () => {
		const names = skills.map((s) => s.name).sort();
		assert.deepStrictEqual(names, [
			"amber-audit",
			"amber-doctor",
			"amber-handoff",
			"amber-init",
			"amber-wiki",
		]);
	});

	it("every skill command targets a real amber.js subcommand", () => {
		for (const skill of skills) {
			const name = extractCommandName(skill.amber.command);
			assert.ok(
				COMMANDS.includes(name),
				`${skill.name} → unknown command "${name}"`,
			);
			assert.match(skill.amber.command, /^node scripts\/amber\.js /);
		}
	});
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: FAIL — `discovers the five core skills` 不通过（现有 SKILL.md 无 `x-amber-json`，收集到 0 个）。

- [ ] **Step 4: 改 5 个 SKILL.md**（每个：修正命令引用 + 加 `x-amber-json`）

`skills/amber-init/SKILL.md` — frontmatter 替换为：

```yaml
---
name: amber-init
description: Install the V1 Amber Protocol scaffold in a repository without overwriting existing files.
x-amber-json: {"command":"node scripts/amber.js init --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-init"}
---
```

并把正文 Workflow 第 2 步 `node scripts/scaffold-harness.js --target <repo>` 改为 `node scripts/amber.js init --target <repo>`。

`skills/amber-audit/SKILL.md` — frontmatter：

```yaml
---
name: amber-audit
description: Inspect an existing repository for Harness readiness without modifying project files.
x-amber-json: {"command":"node scripts/amber.js audit --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-audit"}
---
```

正文第 1 步 `node scripts/audit-project.js --target <repo>` → `node scripts/amber.js audit --target <repo>`。

`skills/amber-wiki/SKILL.md` — frontmatter：

```yaml
---
name: amber-wiki
description: Create or validate the repository-local Amber Protocol Wiki skeleton.
x-amber-json: {"command":"node scripts/amber.js wiki --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-wiki"}
---
```

正文第 2 步 `node scripts/validate-wiki.js --target <repo>` → `node scripts/amber.js wiki --target <repo>`。

`skills/amber-doctor/SKILL.md` — frontmatter：

```yaml
---
name: amber-doctor
description: Validate that a repository-local Amber Protocol is usable and internally consistent.
x-amber-json: {"command":"node scripts/amber.js doctor --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-doctor"}
---
```

正文第 1 步 `node scripts/doctor.js --target <repo>` → `node scripts/amber.js doctor --target <repo>`。

`skills/amber-handoff/SKILL.md` — frontmatter：

```yaml
---
name: amber-handoff
description: Prepare session continuity using Progress, feature state, and handoff files.
x-amber-json: {"command":"node scripts/amber.js handoff --target {{target}}","args":[{"name":"target","hint":"repo path","default":"."}],"manualName":"amber-handoff"}
---
```

正文第 4 步 `node scripts/doctor.js --target <repo>` → `node scripts/amber.js doctor --target <repo>`，并补一句可运行 `node scripts/amber.js handoff --target <repo>` 校验 `session-handoff.md`。

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: PASS（含 `discovers the five core skills` 与防漂移断言）

- [ ] **Step 6: 提交**

```bash
git add scripts/amber.js skills/amber-init/SKILL.md skills/amber-audit/SKILL.md skills/amber-wiki/SKILL.md skills/amber-doctor/SKILL.md skills/amber-handoff/SKILL.md tests/unit/agent-commands.test.js
git commit -m "feat: align 5 core SKILL.md to amber.js entry and add x-amber metadata"
```

---

### Task 9: 生成实际产物并提交

**Files:**
- Create（由生成器产出）：`.claude/commands/amber-{init,audit,wiki,doctor,handoff}.md`、`.gemini/commands/amber/{init,audit,wiki,doctor,handoff}.toml`

- [ ] **Step 1: 运行生成器**

Run: `npm run gen:agents`
Expected: `Generated 10 agent command files:` 后列出 5 个 `.claude/commands/*.md` 与 5 个 `.gemini/commands/amber/*.toml`。

- [ ] **Step 2: 校验幂等 / 不漂移**

Run: `npm run gen:agents:check`
Expected: `Agent command files up to date (10 files).`（退出码 0）

- [ ] **Step 3: 人工抽查一个产物**

Run: `cat .claude/commands/amber-init.md`
Expected: 含 `argument-hint: [target]`、`Execute: \`node scripts/amber.js init --target $1\``、GENERATED 标记。

- [ ] **Step 4: 提交产物**

```bash
git add .claude/commands .gemini/commands
git commit -m "feat: generate Claude and Gemini command products for 5 core skills"
```

---

### Task 10: 对齐两个 plugin manifest

**Files:**
- Modify: `.claude-plugin/plugin.json:3`、`.codex-plugin/plugin.json:3,15`
- Test: `tests/unit/agent-commands.test.js`

- [ ] **Step 1: 写失败测试**（断言 manifest 校验通过且 version=1.0.0）

在 `tests/unit/agent-commands.test.js` 末尾追加：

```js
const { validateManifests } = require("../../scripts/lib/core/manifests");
const { readJson } = require("../../scripts/lib/core/fs-utils");

describe("plugin manifests", () => {
	const repoRoot = path.resolve(__dirname, "../..");

	it("validate without errors", () => {
		const result = validateManifests(repoRoot);
		assert.deepStrictEqual(result.errors, []);
	});

	it("declare version 1.0.0 matching package.json", () => {
		const pkg = readJson(path.join(repoRoot, "package.json"));
		const claude = readJson(
			path.join(repoRoot, ".claude-plugin/plugin.json"),
		);
		const codex = readJson(path.join(repoRoot, ".codex-plugin/plugin.json"));
		assert.strictEqual(claude.version, pkg.version);
		assert.strictEqual(codex.version, pkg.version);
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: FAIL — version `0.1.0` ≠ `1.0.0`。

- [ ] **Step 3: 改 manifest**

`.claude-plugin/plugin.json`：`"version": "0.1.0"` → `"version": "1.0.0"`。

`.codex-plugin/plugin.json`：`"version": "0.1.0"` → `"version": "1.0.0"`；并把 `"skills": "./skills/"` → `"skills": "../skills"`（与 `.claude-plugin` 一致，指向仓库根 `skills/`，语义清晰；`validateSkillsPath` 仍通过）。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: PASS

- [ ] **Step 5: 跑既有 manifest 校验确保未回归**

Run: `npm run manifests`
Expected: 无 error 输出（退出码 0）。

- [ ] **Step 6: 提交**

```bash
git add .claude-plugin/plugin.json .codex-plugin/plugin.json tests/unit/agent-commands.test.js
git commit -m "fix: align plugin manifests to version 1.0.0 and clarify codex skills path"
```

---

### Task 11: 新建仓库根 `AGENTS.md`

**Files:**
- Create: `AGENTS.md`
- Test: `tests/unit/agent-commands.test.js`

- [ ] **Step 1: 写失败测试**（AGENTS.md 存在且命令清单与 skills 同源）

末尾追加：

```js
describe("root AGENTS.md", () => {
	const repoRoot = path.resolve(__dirname, "../..");

	it("exists and documents the amber.js entry", () => {
		const file = path.join(repoRoot, "AGENTS.md");
		assert.ok(fs.existsSync(file), "AGENTS.md missing");
		const text = fs.readFileSync(file, "utf8");
		assert.match(text, /node scripts\/amber\.js/);
	});

	it("lists every core skill command name", () => {
		const text = fs.readFileSync(path.join(repoRoot, "AGENTS.md"), "utf8");
		const skills = collectAmberSkills(path.join(repoRoot, "skills"));
		for (const skill of skills) {
			const name = extractCommandName(skill.amber.command);
			assert.match(
				text,
				new RegExp(`amber\\.js ${name}\\b`),
				`AGENTS.md missing command: ${name}`,
			);
		}
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: FAIL — `AGENTS.md missing`。

- [ ] **Step 3: 写 `AGENTS.md`**（仓库根）

```markdown
# AGENTS.md

Amber Protocol is a repository-local governance layer for agent-assisted engineering.
All capability is exposed through one CLI entry point.

## Entry point

```bash
node scripts/amber.js <command> --target <repo>
```

## Core commands

- `node scripts/amber.js init --target <repo>` — install the V1 scaffold (skips existing files).
- `node scripts/amber.js audit --target <repo>` — read-only readiness inspection.
- `node scripts/amber.js wiki --target <repo>` — create/validate the wiki skeleton.
- `node scripts/amber.js doctor --target <repo>` — validate the Amber setup.
- `node scripts/amber.js handoff --target <repo>` — validate session handoff state.

## Safety boundaries

- Read-only / dry-run first; `init` and `wiki` never overwrite existing files.
- Amber does not auto-execute target-project commands, dispatch live agents, or run dynamic workflows.
- Never overwrite user-authored files without explicit approval.

## Skills & commands

Per-command agent instructions live in `skills/<name>/SKILL.md` (the source of truth).
Run `npm run gen:agents` to regenerate Claude (`.claude/commands/`) and Gemini
(`.gemini/commands/amber/`) command products; edit `skills/`, never the generated files.
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/unit/agent-commands.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add AGENTS.md tests/unit/agent-commands.test.js
git commit -m "docs: add root AGENTS.md documenting amber commands and boundaries"
```

---

### Task 12: 全量验证

**Files:** 无（仅运行校验）

- [ ] **Step 1: 跑全部测试**

Run: `npm test`
Expected: 全部测试通过（含新增 `agent-commands.test.js` 全部用例），无 failing。

- [ ] **Step 2: 跑生成器 check + manifest 校验**

Run: `npm run gen:agents:check && npm run manifests`
Expected: `Agent command files up to date (10 files).` 且 manifest 无 error，退出码 0。

- [ ] **Step 3: 跑 doctor smoke（确保未破坏现有入口）**

Run: `node scripts/amber.js doctor --target . || true`
Expected: 正常输出 doctor 结果（不因本次改动崩溃）。

- [ ] **Step 4: 确认工作树干净**

Run: `git status --porcelain`
Expected: 空输出（所有改动已提交）。

---

## 验收标准回顾（对应 spec §10）

- [x] 5 个核心 SKILL.md 命令指向 `node scripts/amber.js <command>`，防漂移断言通过（Task 8）。
- [x] `npm run gen:agents` 产出 5 个 `.claude/commands/*.md` + 5 个 `.gemini/commands/amber/*.toml`，幂等（Task 5、9）。
- [x] `npm run gen:agents:check` 在产物最新时退出 0（Task 9、12）。
- [x] 两个 plugin manifest version=1.0.0、skills 路径解析正确（Task 10）。
- [x] 仓库根存在 `AGENTS.md`，命令清单与 skills 同源（Task 11）。
- [x] `node --test tests/` 全绿（Task 12）。

## 范围边界（对应 spec §8）

不做：Copilot/Windsurf 适配、`amber-continuous-improvement` 与其余 19 命令、由 plugin/skill 实际执行命令、外部 marketplace 发布。

## 待验证点（对应 spec §9，更新：2026-06-16）

- ✅ **Codex / Cursor skill 目录 = `.agents/skills/`**（官方确认）。生成器已镜像全部 `skills/` 到 `.agents/skills/`（`listSkillDirs` + 镜像 outputs，幂等、`check` 守护）。
- ✅ **Codex 不需 `.codex/skills/`，也不依赖 `.codex-plugin` 指向**：官方机制即 `.agents/skills/` 实体目录，已满足。
- ⏳ **Gemini skill 层目录**未核实——当前靠 `.gemini/commands/*.toml` 手动命令覆盖。
- ⏳ **Claude plugin `commands` 字段**：未使用，slash 直接放 `.claude/commands/` 已生效。
