const { describe, it } = require("node:test");
const assert = require("assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	parseSkillFrontmatter,
	extractCommandName,
	renderClaudeCommand,
	renderGeminiCommand,
	collectAmberSkills,
	listSkillDirs,
	generateAgentCommands,
} = require("../../scripts/lib/core/agent-commands");

function makeTempSkills(entries) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-skills-"));
	for (const [dir, contents] of Object.entries(entries)) {
		const skillDir = path.join(root, dir);
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(path.join(skillDir, "SKILL.md"), contents);
	}
	return root;
}

function skillMd(name, command, manualName = name) {
	const amber = JSON.stringify({
		command,
		args: [{ name: "target" }],
		manualName,
	});
	return `---\nname: ${name}\ndescription: ${name} description.\nx-amber-json: ${amber}\n---\n`;
}

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
		assert.match(
			output,
			/^---\ndescription: Install the V1 Amber Protocol scaffold\.\n/,
		);
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

describe("renderGeminiCommand", () => {
	const output = renderGeminiCommand(SAMPLE_SKILL);

	it("opens with a TOML comment GENERATED marker", () => {
		assert.match(output, /^# GENERATED/);
	});

	it("emits a quoted description field", () => {
		assert.match(
			output,
			/description = "Install the V1 Amber Protocol scaffold\."/,
		);
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

describe("collectAmberSkills", () => {
	it("returns only skills that declare x-amber-json, sorted by name", () => {
		const root = makeTempSkills({
			"amber-wiki": skillMd(
				"amber-wiki",
				"node scripts/amber.js wiki --target {{target}}",
			),
			"amber-init": skillMd(
				"amber-init",
				"node scripts/amber.js init --target {{target}}",
			),
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

describe("generateAgentCommands", () => {
	function setup() {
		const skillsRoot = makeTempSkills({
			"amber-init": skillMd(
				"amber-init",
				"node scripts/amber.js init --target {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));
		return { skillsRoot, repoRoot };
	}

	it("writes Claude .md and Gemini .toml products", () => {
		const { skillsRoot, repoRoot } = setup();
		const result = generateAgentCommands({ skillsRoot, repoRoot });
		// 1 amber skill → claude .md + gemini .toml + .agents/skills mirror
		assert.strictEqual(result.changed.length, 3);
		assert.deepStrictEqual(result.paths, result.changed);
		assert.ok(
			fs.existsSync(path.join(repoRoot, ".claude/commands/amber-init.md")),
		);
		assert.ok(
			fs.existsSync(path.join(repoRoot, ".gemini/commands/amber/init.toml")),
		);
	});

	it("is idempotent — second run reports nothing changed", () => {
		const { skillsRoot, repoRoot } = setup();
		generateAgentCommands({ skillsRoot, repoRoot });
		const second = generateAgentCommands({ skillsRoot, repoRoot });
		assert.deepStrictEqual(second.changed, []);
		assert.strictEqual(second.paths.length, 3);
	});

	it("check mode reports changes without writing", () => {
		const { skillsRoot, repoRoot } = setup();
		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.ok(result.changed.length > 0);
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
		assert.deepStrictEqual(check.changed, []);
	});

	it("sanitizes manualName to prevent path traversal", () => {
		const skillsRoot = makeTempSkills({
			"amber-evil": skillMd(
				"amber-evil",
				"node scripts/amber.js init --target {{target}}",
				"../../evil",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));
		const result = generateAgentCommands({ skillsRoot, repoRoot });
		for (const relativePath of result.paths) {
			assert.ok(!relativePath.includes(".."), `path escaped: ${relativePath}`);
		}
		assert.ok(fs.existsSync(path.join(repoRoot, ".claude/commands/evil.md")));
	});
});

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
		const claude = readJson(path.join(repoRoot, ".claude-plugin/plugin.json"));
		const codex = readJson(path.join(repoRoot, ".codex-plugin/plugin.json"));
		assert.strictEqual(claude.version, pkg.version);
		assert.strictEqual(codex.version, pkg.version);
	});
});

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

describe("listSkillDirs + .agents/skills mirror", () => {
	it("lists all directories containing SKILL.md, sorted", () => {
		const root = makeTempSkills({
			"b-skill": skillMd(
				"b-skill",
				"node scripts/amber.js doctor --target {{target}}",
			),
			"a-skill": "---\nname: a-skill\ndescription: plain.\n---\n",
		});
		fs.mkdirSync(path.join(root, "empty-dir"));
		assert.deepStrictEqual(listSkillDirs(root), ["a-skill", "b-skill"]);
	});

	it("mirrors every skill (amber or not) to .agents/skills", () => {
		const skillsRoot = makeTempSkills({
			"amber-init": skillMd(
				"amber-init",
				"node scripts/amber.js init --target {{target}}",
			),
			"plain-skill": "---\nname: plain-skill\ndescription: plain.\n---\n",
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));
		generateAgentCommands({ skillsRoot, repoRoot });
		const mirrored = path.join(repoRoot, ".agents/skills/amber-init/SKILL.md");
		assert.ok(fs.existsSync(mirrored));
		assert.strictEqual(
			fs.readFileSync(mirrored, "utf8"),
			fs.readFileSync(path.join(skillsRoot, "amber-init/SKILL.md"), "utf8"),
		);
		assert.ok(
			fs.existsSync(path.join(repoRoot, ".agents/skills/plain-skill/SKILL.md")),
		);
	});
});
