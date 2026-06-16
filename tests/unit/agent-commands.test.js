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
