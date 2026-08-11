"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathExists, readText, relativeSlash } = require("./fs-utils");

const SAFETY_NOTE =
	"Report the command output faithfully; never overwrite user-authored files without approval.";

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
		const shortName = extractCommandName(skill.amber.command);
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
	const outputs = planOutputs(skills, repoRoot);
	for (const name of listSkillDirs(skillsRoot)) {
		outputs.push({
			path: path.join(repoRoot, ".agents", "skills", name, "SKILL.md"),
			content: readText(path.join(skillsRoot, name, "SKILL.md")),
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
	return { paths, changed };
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
};
