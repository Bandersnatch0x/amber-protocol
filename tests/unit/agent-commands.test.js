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
		assert.strictEqual(result.amber.command, "node scripts/amber.js init --target {{target}}");
		assert.strictEqual(result.amber.args[0].name, "target");
		assert.strictEqual(result.amber.manualName, "amber-init");
	});

	it("returns amber:null when x-amber-json is absent", () => {
		const md = ["---", "name: amber-x", "description: No amber.", "---"].join("\n");
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

	it("collapses multiple argument placeholders into a single {{args}}", () => {
		const out = renderGeminiCommand({
			name: "amber-plan",
			description: "Scaffold a plan.",
			amber: {
				command:
					"node scripts/amber.js plan --target {{target}} --feature {{feature}} --title {{title}}",
				args: [{ name: "target" }, { name: "feature" }, { name: "title" }],
				manualName: "amber-plan",
			},
		});
		assert.match(out, /node scripts\/amber\.js plan --target \{\{args\}\}/);
		assert.doesNotMatch(out, /\{\{feature\}\}/);
		assert.doesNotMatch(out, /\{\{title\}\}/);
	});
});

describe("collectAmberSkills", () => {
	it("returns only skills that declare x-amber-json, sorted by name", () => {
		const root = makeTempSkills({
			"amber-wiki": skillMd("amber-wiki", "node scripts/amber.js wiki --target {{target}}"),
			"amber-init": skillMd("amber-init", "node scripts/amber.js init --target {{target}}"),
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
			"amber-init": skillMd("amber-init", "node scripts/amber.js init --target {{target}}"),
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
		assert.ok(fs.existsSync(path.join(repoRoot, ".claude/commands/amber-init.md")));
		assert.ok(fs.existsSync(path.join(repoRoot, ".gemini/commands/amber/init.toml")));
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
		assert.strictEqual(result.valid, true);
		assert.deepStrictEqual(result.errors, []);
		assert.ok(result.changed.length > 0);
		assert.strictEqual(fs.existsSync(path.join(repoRoot, ".claude/commands/amber-init.md")), false);
	});

	it("check mode rejects a stale command-family invocation", () => {
		const skillsRoot = makeTempSkills({
			"amber-loop": skillMd(
				"amber-loop",
				"node scripts/amber.js loop schedule --target {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.deepStrictEqual(result.errors, [
			'Skill amber-loop declares unknown Governance Console invocation "loop schedule".',
		]);
		assert.deepStrictEqual(result.changed, []);
		assert.strictEqual(fs.existsSync(path.join(repoRoot, ".claude")), false);
	});

	it("check mode rejects an invented top-level command", () => {
		const skillsRoot = makeTempSkills({
			"amber-journey": skillMd(
				"amber-journey",
				"node scripts/amber.js journey --target {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.deepStrictEqual(result.errors, [
			'Skill amber-journey declares unknown Governance Console command "journey".',
		]);
		assert.deepStrictEqual(result.changed, []);
	});

	it("check mode rejects an undeclared command placeholder", () => {
		const skillsRoot = makeTempSkills({
			"amber-next": skillMd(
				"amber-next",
				"node scripts/amber.js next --objective {{objective}} --target {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.deepStrictEqual(result.errors, [
			'Skill amber-next uses undeclared command argument "objective".',
		]);
		assert.deepStrictEqual(result.changed, []);
		assert.strictEqual(fs.existsSync(path.join(repoRoot, ".claude")), false);
	});

	it("check mode rejects an undocumented command option", () => {
		const skillsRoot = makeTempSkills({
			"amber-loop": skillMd(
				"amber-loop",
				"node scripts/amber.js loop recommend --stale {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.match(result.errors.join("\n"), /loop recommend.*unknown option "--stale"/i);
		assert.deepStrictEqual(result.changed, []);
	});

	it("check mode rejects an option owned by another command", () => {
		const skillsRoot = makeTempSkills({
			"amber-next": skillMd("amber-next", "node scripts/amber.js next --goal {{target}}"),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.match(result.errors.join("\n"), /next.*unknown option "--goal"/i);
		assert.deepStrictEqual(result.changed, []);
	});

	it("check mode rejects a command missing a required option", () => {
		const skillsRoot = makeTempSkills({
			"amber-context": skillMd(
				"amber-context",
				"node scripts/amber.js context load --target {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.match(result.errors.join("\n"), /context load.*requires option "--route"/i);
		assert.deepStrictEqual(result.changed, []);
	});

	it("check mode rejects an option missing its value", () => {
		const skillsRoot = makeTempSkills({
			"amber-audit": skillMd("amber-audit", "node scripts/amber.js audit --target"),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.match(result.errors.join("\n"), /option "--target" without a value/i);
		assert.deepStrictEqual(result.changed, []);
	});

	it("check mode rejects a literal outside the documented option value domain", () => {
		const skillsRoot = makeTempSkills({
			"amber-benchmark": skillMd(
				"amber-benchmark",
				"node scripts/amber.js context benchmark --fixture fixture.json --mode bogus --target {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.match(result.errors.join("\n"), /option "--mode".*unknown value "bogus"/i);
		assert.deepStrictEqual(result.changed, []);
	});

	it("check mode rejects a documented family invocation missing its required option", () => {
		const skillsRoot = makeTempSkills({
			"amber-findings": skillMd(
				"amber-findings",
				"node scripts/amber.js workflow findings --target {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.match(result.errors.join("\n"), /workflow findings.*requires option "--report"/i);
		assert.deepStrictEqual(result.changed, []);
	});

	it("check mode accepts a complete documented family invocation", () => {
		const skillsRoot = makeTempSkills({
			"amber-findings": skillMd(
				"amber-findings",
				"node scripts/amber.js workflow findings --report report.json --target {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.strictEqual(result.valid, true);
		assert.deepStrictEqual(result.errors, []);
	});

	it("check mode accepts a default action beside documented subcommands", () => {
		const skillsRoot = makeTempSkills({
			"amber-handoff": skillMd(
				"amber-handoff",
				"node scripts/amber.js handoff --target {{target}}",
			),
			"amber-break-loop": skillMd(
				"amber-break-loop",
				"node scripts/amber.js break-loop --issue 1 --title defect --recurrence 2 --target {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.strictEqual(result.valid, true);
		assert.deepStrictEqual(result.errors, []);
	});

	it("check mode accepts nested documented subcommands", () => {
		const skillsRoot = makeTempSkills({
			"amber-hooks": skillMd(
				"amber-hooks",
				"node scripts/amber.js hooks breadcrumb print --target {{target}}",
			),
			"amber-context": skillMd(
				"amber-context",
				"node scripts/amber.js context projection status --target {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.strictEqual(result.valid, true);
		assert.deepStrictEqual(result.errors, []);
	});

	it("check mode accepts every slash-separated documented action", () => {
		const skillsRoot = makeTempSkills({
			"amber-show": skillMd(
				"amber-show",
				"node scripts/amber.js context show --page page-id --target {{target}}",
			),
			"amber-delete": skillMd(
				"amber-delete",
				"node scripts/amber.js context delete --page page-id --target {{target}}",
			),
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.strictEqual(result.valid, true);
		assert.deepStrictEqual(result.errors, []);
	});

	it("check mode rejects a declared argument unused by the command", () => {
		const markdown = skillMd(
			"amber-next",
			"node scripts/amber.js next --target {{target}}",
		).replace('"args":[{"name":"target"}]', '"args":[{"name":"target"},{"name":"objective"}]');
		const skillsRoot = makeTempSkills({ "amber-next": markdown });
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));

		const result = generateAgentCommands({ skillsRoot, repoRoot, check: true });
		assert.match(result.errors.join("\n"), /declares unused command argument "objective"/i);
		assert.deepStrictEqual(result.changed, []);
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

	it("removes only stale generated command projections", () => {
		const { skillsRoot, repoRoot } = setup();
		const commands = path.join(repoRoot, ".claude", "commands");
		fs.mkdirSync(commands, { recursive: true });
		fs.writeFileSync(
			path.join(commands, "amber-old.md"),
			"<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->\n",
		);
		fs.writeFileSync(path.join(commands, "amber-user.md"), "# user authored\n");
		const result = generateAgentCommands({ skillsRoot, repoRoot });
		assert.deepStrictEqual(result.removed, [".claude/commands/amber-old.md"]);
		assert.equal(fs.existsSync(path.join(commands, "amber-old.md")), false);
		assert.equal(fs.existsSync(path.join(commands, "amber-user.md")), true);
	});

	it("removes stale generated skill mirrors but preserves user-authored mirrors", () => {
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-agent-stale-mirror-"));
		const skillsRoot = makeTempSkills({
			current: skillMd("current", "node scripts/amber.js audit --target {{target}}"),
		});
		const mirrors = path.join(repoRoot, ".agents", "skills");
		for (const [name, content] of [
			["old", `---\n# GENERATED — edit skills/ instead. Run: npm run gen:agents\nname: old\n---\n`],
			["user", "---\nname: user\n---\n# user authored\n"],
		]) {
			fs.mkdirSync(path.join(mirrors, name), { recursive: true });
			fs.writeFileSync(path.join(mirrors, name, "SKILL.md"), content);
		}
		const result = generateAgentCommands({ skillsRoot, repoRoot });
		assert.ok(result.removed.includes(".agents/skills/old/SKILL.md"));
		assert.equal(fs.existsSync(path.join(mirrors, "old", "SKILL.md")), false);
		assert.equal(fs.existsSync(path.join(mirrors, "user", "SKILL.md")), true);
	});
});

const { COMMANDS } = require("../../scripts/amber.js");

describe("real skills integration", () => {
	const repoRoot = path.resolve(__dirname, "../..");
	const skills = collectAmberSkills(path.join(repoRoot, "skills"));

	it("discovers the core skills", () => {
		const names = skills.map((s) => s.name).sort();
		assert.deepStrictEqual(names, [
			"amber",
			"amber-context-continuity",
			"amber-continuous-improvement",
			"amber-delivery",
			"amber-diagnosis-adoption",
		]);
	});

	it("every skill command targets a real amber.js subcommand", () => {
		for (const skill of skills) {
			const name = extractCommandName(skill.amber.command);
			assert.ok(COMMANDS.includes(name), `${skill.name} → unknown command "${name}"`);
			assert.match(skill.amber.command, /^node scripts\/amber\.js /);
		}
	});

	it("all shipped skill commands pass the generator contract", () => {
		const result = generateAgentCommands({
			skillsRoot: path.join(repoRoot, "skills"),
			repoRoot,
			check: true,
		});
		assert.strictEqual(result.valid, true);
		assert.deepStrictEqual(result.errors, []);
	});

	it("keeps next --objective as the only router matcher", () => {
		const { JOURNEYS, nextObjectiveCommand } = require("../../scripts/lib/route-journey-decision");
		const router = skills.find((skill) => skill.amber.kind === "router");
		const journeys = skills.filter((skill) => skill.amber.kind === "journey");
		assert.strictEqual(router.name, "amber");
		assert.strictEqual(
			router.amber.command,
			nextObjectiveCommand("{{objective}}", "{{target}}").join(" "),
		);
		assert.deepStrictEqual(
			journeys.map((skill) => skill.name).sort(),
			JOURNEYS.map((journey) => journey.id).sort(),
		);
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

	it("declare version matching package.json", () => {
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
			if (skill.amber.kind === "router") {
				assert.match(text, /`amber` router/);
			} else {
				const name = extractCommandName(skill.amber.command);
				assert.match(
					text,
					new RegExp(`amber\\.js ${name}\\b`),
					`AGENTS.md missing command: ${name}`,
				);
			}
		}
	});
});

describe("listSkillDirs + .agents/skills mirror", () => {
	it("lists all directories containing SKILL.md, sorted", () => {
		const root = makeTempSkills({
			"b-skill": skillMd("b-skill", "node scripts/amber.js doctor --target {{target}}"),
			"a-skill": "---\nname: a-skill\ndescription: plain.\n---\n",
		});
		fs.mkdirSync(path.join(root, "empty-dir"));
		assert.deepStrictEqual(listSkillDirs(root), ["a-skill", "b-skill"]);
	});

	it("mirrors every skill (amber or not) to .agents/skills", () => {
		const skillsRoot = makeTempSkills({
			"amber-init": skillMd("amber-init", "node scripts/amber.js init --target {{target}}"),
			"plain-skill": "---\nname: plain-skill\ndescription: plain.\n---\n",
		});
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amber-repo-"));
		generateAgentCommands({ skillsRoot, repoRoot });
		const mirrored = path.join(repoRoot, ".agents/skills/amber-init/SKILL.md");
		assert.ok(fs.existsSync(mirrored));
		const mirroredText = fs.readFileSync(mirrored, "utf8");
		assert.match(mirroredText, /^---\n# GENERATED/);
		assert.deepStrictEqual(
			parseSkillFrontmatter(mirroredText),
			parseSkillFrontmatter(fs.readFileSync(path.join(skillsRoot, "amber-init/SKILL.md"), "utf8")),
		);
		assert.ok(fs.existsSync(path.join(repoRoot, ".agents/skills/plain-skill/SKILL.md")));
	});
});
