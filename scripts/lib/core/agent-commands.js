"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathExists, readText, relativeSlash } = require("./fs-utils");
const { COMMANDS, commandInvocationContract } = require("../command-registry");
const { getFlagSpec } = require("./cli-output");

const SAFETY_NOTE =
	"Report the command output faithfully; never overwrite user-authored files without approval.";
const GENERATED_MARKER = "GENERATED — edit skills/ instead. Run: npm run gen:agents";

function markSkillMirror(content) {
	return String(content).replace(/^---\r?\n/, `---\n# ${GENERATED_MARKER}\n`);
}

function stripQuotes(value) {
	const t = String(value).trim();
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
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
	const result = {
		name: null,
		description: null,
		amber: null,
		body: text.slice(match[0].length).trim(),
	};
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
				throw new Error(`Invalid x-amber-json in frontmatter: ${error.message}`, { cause: error });
			}
		}
	}
	return result;
}

function extractCommandName(command) {
	const match = String(command).match(/amber\.js\s+([a-z][a-z0-9-]*)/i);
	return match ? match[1] : null;
}

function tokenizeSkillCommand(command) {
	const tokens = [];
	let current = "";
	let quote = null;
	let escaped = false;

	for (const character of String(command || "").trim()) {
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\" && !quote) {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = null;
			else current += character;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (/\s/.test(character)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += character;
	}

	if (escaped || quote) {
		return { tokens: [], error: "unterminated escape or quote" };
	}
	if (current) tokens.push(current);
	return { tokens, error: null };
}

function validateSkillCommand(skill) {
	const command = String(skill?.amber?.command || "").trim();
	const name = skill?.name || "<unnamed>";
	const parsed = tokenizeSkillCommand(command);
	if (parsed.error) {
		return `Skill ${name} declares an invalid Governance Console command: ${parsed.error}.`;
	}

	const [runtime, script, commandName] = parsed.tokens;
	if (runtime !== "node" || script !== "scripts/amber.js" || !commandName) {
		return `Skill ${name} declares unsupported Governance Console invocation "${command}".`;
	}
	if (!COMMANDS.includes(commandName)) {
		return `Skill ${name} declares unknown Governance Console command "${commandName}".`;
	}

	const invocationTokens = parsed.tokens.slice(3);
	const positionalPrefix = invocationTokens.filter((token, index) => {
		return invocationTokens.slice(0, index + 1).every((value) => !value.startsWith("--"));
	});
	let subcommand = null;
	let consumedPositionals = 0;
	for (let count = 1; count <= positionalPrefix.length; count += 1) {
		const candidate = positionalPrefix.slice(0, count).join(" ");
		if (commandInvocationContract(commandName, candidate).recognized) {
			subcommand = candidate;
			consumedPositionals = count;
		}
	}

	const contract = commandInvocationContract(commandName, subcommand);
	if (!contract.recognized || positionalPrefix.length > consumedPositionals) {
		const attempted = positionalPrefix.length > 0 ? positionalPrefix.join(" ") : null;
		const invocation = [commandName, attempted].filter(Boolean).join(" ");
		return `Skill ${name} declares unknown Governance Console invocation "${invocation}".`;
	}
	const invocation = [commandName, subcommand].filter(Boolean).join(" ");
	const optionTokens = invocationTokens.slice(consumedPositionals);
	const seenOptions = new Set();
	for (let index = 0; index < optionTokens.length; index += 1) {
		const option = optionTokens[index];
		if (!option.startsWith("--")) {
			return `Skill ${name} declares unexpected argument "${option}" for Governance Console invocation "${invocation}".`;
		}
		if (!contract.allowedOptions.includes(option)) {
			return `Skill ${name} declares Governance Console invocation "${invocation}" with unknown option "${option}".`;
		}
		const spec = getFlagSpec(option);
		if (!spec) {
			return `Skill ${name} declares Governance Console option "${option}" that its parser does not accept.`;
		}
		seenOptions.add(option);
		if (spec.kind === "boolean") continue;
		const value = optionTokens[index + 1];
		if (!value || value.startsWith("--")) {
			return `Skill ${name} declares Governance Console option "${option}" without a value.`;
		}
		const allowedValues = contract.allowedValues[option];
		const isPlaceholder = /^\{\{[^{}]+\}\}$/.test(value);
		if (allowedValues && !isPlaceholder && !allowedValues.includes(value)) {
			return `Skill ${name} declares Governance Console option "${option}" with unknown value "${value}".`;
		}
		index += 1;
	}
	const missingOption = contract.requiredOptions.find((option) => !seenOptions.has(option));
	if (missingOption) {
		return `Skill ${name} declares Governance Console invocation "${invocation}" that requires option "${missingOption}".`;
	}

	const declaredArgs = new Set((skill.amber.args || []).map((arg) => arg.name));
	const placeholders = [...command.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]);
	const unknownPlaceholder = placeholders.find((placeholder) => !declaredArgs.has(placeholder));
	if (unknownPlaceholder) {
		return `Skill ${name} uses undeclared command argument "${unknownPlaceholder}".`;
	}
	const unusedArgument = [...declaredArgs].find((argument) => !placeholders.includes(argument));
	if (unusedArgument) {
		return `Skill ${name} declares unused command argument "${unusedArgument}".`;
	}

	return null;
}

function validateSkillCommands(skills) {
	const errors = [];
	for (const skill of skills) {
		const error = validateSkillCommand(skill);
		if (error) errors.push(error);
	}
	return { valid: errors.length === 0, errors };
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
	if (["router", "journey"].includes(skill.amber.kind)) {
		const lines = ["---", `description: ${skill.description}`];
		if (argHint) lines.push(`argument-hint: ${argHint}`);
		lines.push(
			"---",
			"",
			"<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->",
			"",
			"User input: $ARGUMENTS",
			"",
			skill.body,
			"",
		);
		return lines.join("\n");
	}
	const commandLine = applyPositionalArgs(skill.amber.command, args);
	const lines = ["---", `description: ${skill.description}`];
	if (argHint) {
		lines.push(`argument-hint: ${argHint}`);
	}
	lines.push(
		"---",
		"",
		"<!-- GENERATED — edit skills/ instead. Run: npm run gen:agents -->",
		"",
		`Run the Amber **${skill.name}** workflow for the target repository.`,
		"If no target is given, use the current repository root (`.`).",
		"",
		`Execute: \`${commandLine}\``,
		"",
		SAFETY_NOTE,
		"",
	);
	return lines.join("\n");
}

function applyGeminiArgs(command, args) {
	const list = args || [];
	if (list.length === 0) {
		return command;
	}
	if (list.length === 1) {
		return command.split(`{{${list[0].name}}}`).join("{{args}}");
	}
	// Multi-argument skills collapse the entire argument block into a single
	// {{args}} placeholder. The prompt instructs the user to supply all
	// required values (e.g. --target . --feature F001 --title "Slice").
	const first = command.indexOf("{{");
	const last = command.lastIndexOf("}}");
	if (first === -1 || last === -1) {
		return command;
	}
	return command.slice(0, first) + "{{args}}" + command.slice(last + 2);
}

function escapeTomlBasic(value) {
	return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function renderGeminiCommand(skill) {
	if (["router", "journey"].includes(skill.amber.kind)) {
		const body = String(skill.body || "").replace(/"""/g, '\\"\\"\\"');
		return [
			"# GENERATED — edit skills/ instead. Run: npm run gen:agents",
			`description = "${escapeTomlBasic(skill.description)}"`,
			'prompt = """',
			"User input: {{args}}",
			"",
			body,
			'"""',
			"",
		].join("\n");
	}
	const promptCommand = applyGeminiArgs(skill.amber.command, skill.amber.args);
	return [
		"# GENERATED — edit skills/ instead. Run: npm run gen:agents",
		`description = "${escapeTomlBasic(skill.description)}"`,
		'prompt = """',
		`Run the Amber ${skill.name} workflow for the target repository.`,
		"If no target is provided, use the current repository root (.).",
		`Execute: ${promptCommand}`,
		SAFETY_NOTE,
		'"""',
		"",
	].join("\n");
}

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

function listSkillDirs(skillsRoot) {
	if (!pathExists(skillsRoot)) {
		return [];
	}
	return fs
		.readdirSync(skillsRoot, { withFileTypes: true })
		.filter(
			(entry) => entry.isDirectory() && pathExists(path.join(skillsRoot, entry.name, "SKILL.md")),
		)
		.map((entry) => entry.name)
		.sort();
}

function normalizeEol(value) {
	return String(value).replace(/\r\n/g, "\n");
}

function planOutputs(skills, repoRoot) {
	const outputs = [];
	for (const skill of skills) {
		const manualName = path.basename(skill.amber.manualName);
		const shortName = skill.amber.commandName || extractCommandName(skill.amber.command);
		if (!shortName || !/^[a-z][a-z0-9-]*$/.test(shortName)) {
			throw new Error(`Skill ${skill.name} requires a safe commandName or amber command`);
		}
		outputs.push({
			path: path.join(repoRoot, ".claude", "commands", `${manualName}.md`),
			content: renderClaudeCommand(skill),
		});
		outputs.push({
			path: path.join(repoRoot, ".gemini", "commands", "amber", `${shortName}.toml`),
			content: renderGeminiCommand(skill),
		});
	}
	return outputs;
}

function generateAgentCommands({ skillsRoot, repoRoot, check = false }) {
	const skills = collectAmberSkills(skillsRoot);
	const validation = validateSkillCommands(skills);
	if (!validation.valid) {
		return { paths: [], changed: [], removed: [], ...validation };
	}
	const outputs = planOutputs(skills, repoRoot);
	for (const name of listSkillDirs(skillsRoot)) {
		outputs.push({
			path: path.join(repoRoot, ".agents", "skills", name, "SKILL.md"),
			content: markSkillMirror(readText(path.join(skillsRoot, name, "SKILL.md"))),
		});
	}
	const paths = [];
	const changed = [];
	for (const output of outputs) {
		const relativePath = relativeSlash(repoRoot, output.path);
		paths.push(relativePath);
		const existing = pathExists(output.path) ? readText(output.path) : null;
		const isStale = existing === null || normalizeEol(existing) !== normalizeEol(output.content);
		if (isStale) {
			changed.push(relativePath);
			if (!check) {
				fs.mkdirSync(path.dirname(output.path), { recursive: true });
				fs.writeFileSync(output.path, output.content);
			}
		}
	}
	const planned = new Set(paths.map((value) => value.toLowerCase()));
	const stale = findStaleGeneratedOutputs(repoRoot, planned);
	for (const relativePath of stale) {
		changed.push(relativePath);
		if (!check) fs.rmSync(path.join(repoRoot, relativePath), { recursive: true, force: true });
	}
	return { paths, changed, removed: stale, valid: true, errors: [] };
}

function findStaleGeneratedOutputs(repoRoot, planned) {
	const stale = [];
	const roots = [
		{
			dir: path.join(repoRoot, ".claude", "commands"),
			accept: (name) => /^amber(?:-|\.md$)/.test(name) && name.endsWith(".md"),
		},
		{
			dir: path.join(repoRoot, ".gemini", "commands", "amber"),
			accept: (name) => name.endsWith(".toml"),
		},
		{
			dir: path.join(repoRoot, ".agents", "skills"),
			accept: (name, entry) => entry.isDirectory(),
			resolveFile: (name) => path.join(name, "SKILL.md"),
		},
	];
	for (const root of roots) {
		if (!pathExists(root.dir)) continue;
		for (const entry of fs.readdirSync(root.dir, { withFileTypes: true })) {
			if (!root.accept(entry.name, entry)) continue;
			const file = path.join(
				root.dir,
				root.resolveFile ? root.resolveFile(entry.name) : entry.name,
			);
			if (!pathExists(file)) continue;
			const relative = relativeSlash(repoRoot, file);
			if (!planned.has(relative.toLowerCase()) && readText(file).includes(GENERATED_MARKER))
				stale.push(relative);
		}
	}
	return stale.sort();
}

module.exports = {
	parseSkillFrontmatter,
	extractCommandName,
	applyPositionalArgs,
	renderClaudeCommand,
	applyGeminiArgs,
	escapeTomlBasic,
	renderGeminiCommand,
	collectAmberSkills,
	listSkillDirs,
	generateAgentCommands,
	findStaleGeneratedOutputs,
};
