"use strict";

const path = require("node:path");

const {
	REQUIRED_HANDOFF_SECTIONS,
	REQUIRED_HARNESS_FILES,
} = require("./constants");

const { classifyTarget } = require("./target-classification");

const {
	fileContains,
	isIgnoredAuditPath,
	pathExists,
	readJson,
	readText,
	relativeSlash,
	resolveTarget,
	walkProjectFiles,
} = require("./fs-utils");

const {
	MESSAGES,
} = require("./terminology");

const {
	getSectionBody,
	hasSectionWithBody,
} = require("./text-utils");

function detectCommands(targetRoot, parseIssues = []) {
	const commands = [];
	const packageJsonPath = path.join(targetRoot, "package.json");
	if (pathExists(packageJsonPath)) {
		try {
			const packageJson = readJson(packageJsonPath);
			for (const [name, command] of Object.entries(packageJson.scripts || {})) {
				commands.push({ source: "package.json", name, command });
			}
		} catch (error) {
			parseIssues.push({ source: "package.json", message: error.message });
		}
	}

	for (const fileName of ["Makefile", "makefile"]) {
		if (pathExists(path.join(targetRoot, fileName))) {
			commands.push({
				source: fileName,
				name: "make",
				command: "make <target>",
			});
			break;
		}
	}

	return commands;
}

function detectToolingEvidence(targetRoot) {
	const candidates = [
		{ source: "package-lock.json", name: "npm" },
		{ source: "npm-shrinkwrap.json", name: "npm" },
		{ source: "pnpm-lock.yaml", name: "pnpm" },
		{ source: "yarn.lock", name: "yarn" },
		{ source: "bun.lock", name: "bun" },
		{ source: "bun.lockb", name: "bun" },
		{ source: "pyproject.toml", name: "python" },
		{ source: "requirements.txt", name: "python" },
		{ source: "go.mod", name: "go" },
		{ source: "Cargo.toml", name: "rust" },
	];

	return candidates.filter((candidate) =>
		pathExists(path.join(targetRoot, candidate.source)),
	);
}

function addCandidateCommand(candidateCommands, command) {
	if (
		!candidateCommands.some(
			(candidate) => candidate.command === command.command,
		)
	) {
		candidateCommands.push(command);
	}
}

// Pure decision core for detectCandidateCommands: given the python-tooling
// evidence flags already gathered from disk, emit the candidate verification
// commands. Extracted so the pytest/ruff/default branching is testable without
// touching the filesystem.
function buildPythonCandidates({
	hasTestsDirectory,
	hasPytestEvidence,
	hasRuffEvidence,
}) {
	const candidateCommands = [];
	if (hasPytestEvidence) {
		addCandidateCommand(candidateCommands, {
			source: hasTestsDirectory ? "tests/" : "python tooling evidence",
			name: "pytest",
			command: "python -m pytest",
			confidence: "candidate",
			reason:
				"Python test evidence was found, but the command must be confirmed by the project owner.",
		});
	}

	if (hasRuffEvidence) {
		addCandidateCommand(candidateCommands, {
			source: "python tooling evidence",
			name: "ruff",
			command: "python -m ruff check .",
			confidence: "candidate",
			reason:
				"Ruff evidence was found, but lint settings and scope must be confirmed by the project owner.",
		});
	}

	if (candidateCommands.length === 0) {
		addCandidateCommand(candidateCommands, {
			source: "python tooling evidence",
			name: "pytest",
			command: "python -m pytest",
			confidence: "candidate",
			reason:
				"Python project files were found, but no explicit verification command was declared.",
		});
	}

	return candidateCommands;
}

// Pure decision core for Go candidates. `go.mod` is enough to propose the
// standard `go test ./...`; a Wails project (wails.json present) additionally
// gets a `wails build` candidate. Both stay confidence:"candidate" — Amber
// proposes, the project owner confirms.
function buildGoCandidates({ hasWailsConfig }) {
	const candidateCommands = [];
	addCandidateCommand(candidateCommands, {
		source: "go.mod",
		name: "go-test",
		command: "go test ./...",
		confidence: "candidate",
		reason:
			"A go.mod was found, but the verification command must be confirmed by the project owner.",
	});
	if (hasWailsConfig) {
		addCandidateCommand(candidateCommands, {
			source: "wails.json",
			name: "wails-build",
			command: "wails build",
			confidence: "candidate",
			reason:
				"A wails.json was found, but the build command must be confirmed by the project owner.",
		});
	}
	return candidateCommands;
}

// Pure decision core for Rust candidates. A Cargo.toml is enough to propose the
// standard `cargo test`; confirmation remains with the project owner.
function buildRustCandidates() {
	const candidateCommands = [];
	addCandidateCommand(candidateCommands, {
		source: "Cargo.toml",
		name: "cargo-test",
		command: "cargo test",
		confidence: "candidate",
		reason:
			"A Cargo.toml was found, but the verification command must be confirmed by the project owner.",
	});
	return candidateCommands;
}

function detectCandidateCommands(targetRoot, toolingEvidence = []) {
	const hasEvidence = (name) =>
		toolingEvidence.some((item) => item.name === name);

	const candidateCommands = [];

	if (hasEvidence("python")) {
		const hasTestsDirectory =
			pathExists(path.join(targetRoot, "tests")) ||
			pathExists(path.join(targetRoot, "test"));
		const hasPytestEvidence =
			hasTestsDirectory ||
			pathExists(path.join(targetRoot, "pytest.ini")) ||
			fileContains(targetRoot, "requirements.txt", /^pytest(?:[<>=~! ]|$)/im) ||
			fileContains(targetRoot, "pyproject.toml", /\[tool\.pytest/i);
		const hasRuffEvidence =
			fileContains(targetRoot, "requirements.txt", /^ruff(?:[<>=~! ]|$)/im) ||
			fileContains(targetRoot, "pyproject.toml", /\[tool\.ruff/i);

		for (const candidate of buildPythonCandidates({
			hasTestsDirectory,
			hasPytestEvidence,
			hasRuffEvidence,
		})) {
			addCandidateCommand(candidateCommands, candidate);
		}
	}

	if (hasEvidence("go")) {
		const hasWailsConfig = pathExists(path.join(targetRoot, "wails.json"));
		for (const candidate of buildGoCandidates({ hasWailsConfig })) {
			addCandidateCommand(candidateCommands, candidate);
		}
	}

	if (hasEvidence("rust")) {
		for (const candidate of buildRustCandidates()) {
			addCandidateCommand(candidateCommands, candidate);
		}
	}

	return candidateCommands;
}

function isLikelyDocumentation(relativePath) {
	const normalized = relativePath.toLowerCase();
	return (
		normalized === "readme.md" ||
		normalized === "agents.md" ||
		normalized === "claude.md" ||
		normalized.startsWith("docs/") ||
		normalized.endsWith(".md")
	);
}

function listProjectDocs(targetRoot) {
	return walkProjectFiles(targetRoot)
		.map((filePath) => relativeSlash(targetRoot, filePath))
		.filter((relativePath) => {
			const normalized = relativePath.toLowerCase();
			if (isIgnoredAuditPath(normalized)) {
				return false;
			}
			return isLikelyDocumentation(relativePath);
		})
		.sort();
}

function isWikiLike(relativePath) {
	const normalized = relativePath.toLowerCase();
	return (
		normalized.includes("wiki") ||
		normalized.startsWith("docs/") ||
		normalized.includes("architecture") ||
		normalized.includes("runbook") ||
		normalized.includes("progress") ||
		normalized.includes("handoff")
	);
}

function buildSuggestedPatches(conflicts) {
	return conflicts.map((file) => ({
		file,
		requiresApproval: true,
		reason: "Existing project instruction file must be merged by a human.",
		suggestion:
			MESSAGES.wikiTemplateLinkHint,
	}));
}

function buildAuditUnknowns(
	commands,
	toolingEvidence = [],
	parseIssues = [],
	candidateCommands = [],
) {
	const unknowns = [];
	if (commands.length === 0) {
		unknowns.push("No package, test, build, or verification command detected.");
	}

	for (const issue of parseIssues) {
		unknowns.push(`${issue.source} could not be parsed: ${issue.message}`);
	}

	if (commands.length === 0 && toolingEvidence.length > 0) {
		const sources = toolingEvidence.map((item) => item.source).join(", ");
		unknowns.push(
			`Tooling evidence found (${sources}), but the exact verification command is unknown.`,
		);
	}

	if (candidateCommands.length > 0) {
		unknowns.push(
			"Candidate verification commands require confirmation before being treated as project commands.",
		);
	}

	return unknowns;
}

function buildNextSafeCommand(targetRoot) {
	return `node scripts/amber.js audit --target ${JSON.stringify(targetRoot)} --json`;
}

function listStarterFileStatus(rootDir, relativePaths) {
	const existing = [];
	const missing = [];

	for (const relativePath of relativePaths) {
		if (pathExists(path.join(rootDir, relativePath))) {
			existing.push(relativePath);
		} else {
			missing.push(relativePath);
		}
	}

	return { existing, missing };
}

function listAgentDocs(targetRoot) {
	return [
		"AGENTS.md",
		"CLAUDE.md",
		".cursorrules",
		".windsurfrules",
	].filter((fileName) => pathExists(path.join(targetRoot, fileName)));
}

function buildAuditDetection(targetRoot) {
	const docs = listProjectDocs(targetRoot);
	const wikiLikeFiles = docs.filter(isWikiLike);
	const parseIssues = [];
	const commands = detectCommands(targetRoot, parseIssues);
	const toolingEvidence = detectToolingEvidence(targetRoot);
	const candidateCommands = detectCandidateCommands(
		targetRoot,
		toolingEvidence,
	);
	const unknowns = buildAuditUnknowns(
		commands,
		toolingEvidence,
		parseIssues,
		candidateCommands,
	);

	return {
		docs,
		wikiLikeFiles,
		commands,
		candidateCommands,
		toolingEvidence,
		parseIssues,
		unknowns,
	};
}

function auditTargetRepo(targetRoot, classification) {
	const { existing, missing } = listStarterFileStatus(
		targetRoot,
		REQUIRED_HARNESS_FILES,
	);
	const agentDocs = listAgentDocs(targetRoot);
	const conflicts = agentDocs.filter((fileName) =>
		["AGENTS.md", "CLAUDE.md"].includes(fileName),
	);

	// Count historical .workflow/ artifacts beyond continuous-improvement.
	let workflowArtifactCount = 0;
	try {
		const workflowDir = path.join(targetRoot, ".workflow");
		if (pathExists(workflowDir)) {
			const entries = require("node:fs").readdirSync(workflowDir, { withFileTypes: true });
			workflowArtifactCount = entries.filter(
				(e) => e.isDirectory() && e.name !== "continuous-improvement",
			).length;
		}
	} catch (_) {
		// .workflow/ is optional — skip if unreadable.
	}

	return {
		target: targetRoot,
		readOnly: true,
		auditMode: "target-repo",
		classification,
		existing,
		missing,
		agentDocs,
		conflicts,
		workflowArtifactCount,
		suggestedAdditions: missing,
		suggestedPatches: buildSuggestedPatches(conflicts),
		untouchedFiles: conflicts,
		...buildAuditDetection(targetRoot),
		nextSafeCommand: buildNextSafeCommand(targetRoot),
	};
}

function auditProductRepo(targetRoot, classification) {
	const templateRoot = path.join(targetRoot, "templates");
	const templateStarterFiles = listStarterFileStatus(
		templateRoot,
		REQUIRED_HARNESS_FILES,
	);

	return {
		target: targetRoot,
		readOnly: true,
		auditMode: "product-repo",
		classification,
		templateStarterFiles,
		existing: [],
		missing: [],
		agentDocs: listAgentDocs(targetRoot),
		conflicts: [],
		suggestedAdditions: [],
		suggestedPatches: [],
		untouchedFiles: [],
		...buildAuditDetection(targetRoot),
		nextSafeCommand: buildNextSafeCommand(targetRoot),
	};
}

function auditProject(target) {
	const targetRoot = resolveTarget(target);
	const classification = classifyTarget(targetRoot);

	if (classification.type === "product-repo") {
		return auditProductRepo(targetRoot, classification);
	}

	return auditTargetRepo(targetRoot, classification);
}

function fileMentionsWiki(filePath) {
	if (!pathExists(filePath)) {
		return false;
	}
	return /docs[\\/]+wiki|docs\/wiki|Project Wiki|wiki\/index/i.test(
		readText(filePath),
	);
}

// Pure core of hasNextAction: given the handoff file's full content, extract
// the Next Action(s) section body and decide whether it records a real action.
// Lines that are blank, HTML comments, or sentinel placeholders (none/n/a/tbd/
// todo/pending/...) are ignored. Extracted so the line-analysis is testable.
function hasNextActionInContent(content) {
	const body =
		getSectionBody(content, "Next Action") ??
		getSectionBody(content, "Next Actions");
	if (!body) {
		return false;
	}

	return body
		.split(/\r?\n/)
		.map((line) => line.trim())
		.some((line) => {
			if (line === "" || /^<!--.*-->$/.test(line)) {
				return false;
			}
			const normalized = line
				.replace(/^[-*]\s+/, "")
				.replace(/\.$/, "")
				.trim();
			return !/^(none|n\/a|tbd|todo|pending|no next actions?(?: is| are)? recorded(?: here)?)$/i.test(
				normalized,
			);
		});
}

function hasNextAction(filePath) {
	if (!pathExists(filePath)) {
		return false;
	}
	return hasNextActionInContent(readText(filePath));
}

// Pure core of hasVerificationCommand: true when the wiki verification doc's
// content contains a fenced shell/bash/powershell/cmd code block.
function hasVerificationCommandInContent(content) {
	return /```(?:sh|bash|powershell|ps1|cmd)?\s*[\r\n]+[^`]+```/i.test(content);
}

function hasVerificationCommand(targetRoot) {
	const verificationPath = path.join(
		targetRoot,
		"docs",
		"wiki",
		"engineering",
		"verification.md",
	);
	if (!pathExists(verificationPath)) {
		return false;
	}
	return hasVerificationCommandInContent(readText(verificationPath));
}

function validateHandoff(target) {
	const targetRoot = resolveTarget(target);
	const handoffPath = path.join(targetRoot, "session-handoff.md");
	const errors = [];
	const warnings = [];

	if (!pathExists(handoffPath)) {
		return {
			target: targetRoot,
			errors: ["session-handoff.md is missing."],
			warnings,
		};
	}

	const content = readText(handoffPath);
	for (const section of REQUIRED_HANDOFF_SECTIONS) {
		if (!hasSectionWithBody(content, section)) {
			errors.push(
				`session-handoff.md must include a non-empty ${section} section.`,
			);
		}
	}

	return { target: targetRoot, errors, warnings };
}

module.exports = {
	detectCommands,
	detectToolingEvidence,
	addCandidateCommand,
	detectCandidateCommands,
	buildPythonCandidates,
	buildGoCandidates,
	buildRustCandidates,
	isLikelyDocumentation,
	listProjectDocs,
	isWikiLike,
	buildSuggestedPatches,
	buildAuditUnknowns,
	buildNextSafeCommand,
	auditProject,
	fileMentionsWiki,
	hasNextAction,
	hasNextActionInContent,
	hasVerificationCommand,
	hasVerificationCommandInContent,
	validateHandoff,
};
