"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	TEMPLATE_ROOT,
	WIKI_CONTEXT_STARTER_FILES,
} = require("./constants");

const {
	pathExists,
	readText,
	relativeSlash,
	resolveTarget,
	walkFiles,
	writeJson,
} = require("./fs-utils");

const {
	validateWiki,
} = require("./validators");

const { detectGitWorkflow } = require("./git-workflow-detector");
const { generateGovernanceAdvice } = require("./team-governance-advisor");

function listTemplateFiles(templateRoot = TEMPLATE_ROOT) {
	return walkFiles(templateRoot).map((filePath) => ({
		source: filePath,
		relativePath: relativeSlash(templateRoot, filePath),
	}));
}

function copyTemplateFiles(targetRoot, items, options = {}) {
	const dryRun = Boolean(options.dryRun);
	const created = [];
	const skipped = [];

	for (const item of items) {
		const destination = path.join(targetRoot, item.relativePath);
		if (pathExists(destination)) {
			skipped.push(item.relativePath);
			continue;
		}

		created.push(item.relativePath);
		if (!dryRun) {
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			fs.copyFileSync(item.source, destination);
		}
	}

	return { created, skipped };
}

function checkGitignoreConflicts(targetRoot, createdFiles) {
	// Check if .gitignore rules would hide any of the newly created amber files.
	const gitignorePath = path.join(targetRoot, ".gitignore");
	if (!pathExists(gitignorePath)) return [];

	const conflicts = [];
	let raw;
	try {
		raw = readText(gitignorePath);
	} catch {
		return [];
	}

	const patterns = raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));

	for (const file of createdFiles) {
		for (const pattern of patterns) {
			// Simple glob matching: `docs/` matches `docs/**`, `.*/ `matches `.amber/...`
			const escaped = pattern
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*/g, ".*")
				.replace(/\?/g, ".");
			const regex = new RegExp("^" + escaped);
			if (regex.test(file)) {
				conflicts.push({ file, rule: pattern });
				break;
			}
		}
	}
	return conflicts;
}

// Warnings raised by an install: CLAUDE.md changes agent behavior immediately,
// and .gitignore rules can hide governance files from the team.
function buildScaffoldWarnings(targetRoot, created, options) {
	const warnings = [];

	if (created.some((f) => f === "CLAUDE.md")) {
		warnings.push(
			"CLAUDE.md was created. Claude Code will read it on the next session " +
				"and follow its instructions — review it before your next chat.",
		);
	}

	if (!options.dryRun && created.length > 0) {
		const conflicts = checkGitignoreConflicts(targetRoot, created);
		if (conflicts.length > 0) {
			const rules = [...new Set(conflicts.map((c) => c.rule))];
			warnings.push(
				`${conflicts.length} of ${created.length} created files are hidden by .gitignore rules: ` +
					rules.join(", ") +
					". These governance files should be committed for team visibility. " +
					"Consider updating .gitignore.",
			);
		}
	}

	return warnings;
}

// The init-time analysis layer. --with-wiki adds a readiness check; detection is
// on by default (opt out with --skip-detection). On a non-git target
// detectGitWorkflow returns null, so detection stays null and the base install
// behavior is untouched.
function gatherInitInsights(targetRoot, options) {
	const wikiReadiness = options.withWiki ? checkWikiReadiness(targetRoot) : null;

	let detection = null;
	if (!options.skipDetection) {
		const workflow = detectGitWorkflow(targetRoot);
		const governance = workflow
			? generateGovernanceAdvice(targetRoot, workflow)
			: null;
		if (workflow || governance) {
			detection = { workflow, governance };
		}
	}

	return { wikiReadiness, detection };
}

function buildInitNextSteps(created, wikiReadiness, detection) {
	const steps = [];

	if (created.length > 0) {
		steps.push(
			"1. Review CLAUDE.md and AGENTS.md — they control agent behavior.",
			"2. Customize feature_list.json with your project's features.",
			"3. Fill in docs/wiki/product/overview.md with project context.",
			"4. Add a verification command in docs/wiki/engineering/verification.md.",
			"5. Run `amber doctor --target .` to verify the setup.",
		);
	}
	if (wikiReadiness && wikiReadiness.contextPlaceholders.length > 0) {
		steps.push(
			`Fill in ${wikiReadiness.contextPlaceholders.length} wiki context file(s) still using placeholder content (see Wiki readiness).`,
		);
	}
	if (
		detection &&
		detection.governance &&
		detection.governance.recommendations.gitignore.missing.length > 0
	) {
		steps.push(
			"Update .gitignore to ignore personal Amber state (see .amber/init-report.json).",
		);
	}

	return steps;
}

// The persisted init report. Deliberately timestamp-free, and installation lists
// repo state (created ∪ skipped — the full set of template files Amber manages)
// rather than this run's delta, so re-running init on an unchanged repo yields a
// byte-identical report.
function buildInitReport(targetRoot, created, skipped, wikiReadiness, detection) {
	return {
		version: "1.0.0",
		target: targetRoot,
		workflow: detection ? detection.workflow : null,
		governance: detection ? detection.governance : null,
		wikiReadiness,
		installation: {
			templates: [...created, ...skipped].sort(),
		},
	};
}

function scaffoldHarness(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const templateRoot = options.templateRoot || TEMPLATE_ROOT;
	const items = listTemplateFiles(templateRoot);
	const result = copyTemplateFiles(targetRoot, items, options);

	const created = result.created;
	const warnings = buildScaffoldWarnings(targetRoot, created, options);

	const { wikiReadiness, detection } = gatherInitInsights(targetRoot, options);
	const nextSteps = buildInitNextSteps(created, wikiReadiness, detection);

	// Persist the detection report so downstream commands can read it. Never
	// written during a dry run, and only when there is something to record.
	if (!options.dryRun && (detection || wikiReadiness)) {
		saveInitReport(
			targetRoot,
			buildInitReport(targetRoot, created, result.skipped, wikiReadiness, detection),
		);
	}

	return {
		target: targetRoot,
		created: result.created,
		skipped: result.skipped,
		wikiReadiness,
		detection,
		warnings,
		nextSteps,
	};
}

// Assess how "ready" the installed wiki is. The base init copies every wiki
// template verbatim, so a file whose bytes still match its template is an
// unfilled placeholder; a file that differs has been customised. Missing files
// (deleted after a prior init) are reported too. The actionable subset is the
// context starter files — the ones a team is expected to author.
function checkWikiReadiness(target) {
	const targetRoot = resolveTarget(target);
	const wikiTemplateRoot = path.join(TEMPLATE_ROOT, "docs", "wiki");
	const items = listTemplateFiles(wikiTemplateRoot);

	const presentFiles = [];
	const missing = [];
	const placeholders = [];
	const customized = [];

	for (const item of items) {
		const wikiRel = `docs/wiki/${item.relativePath.split(path.sep).join("/")}`;
		const dest = path.join(targetRoot, "docs", "wiki", item.relativePath);
		if (!pathExists(dest)) {
			missing.push(wikiRel);
			continue;
		}
		presentFiles.push(wikiRel);
		let identical = false;
		try {
			identical = readText(dest) === readText(item.source);
		} catch {
			identical = false;
		}
		(identical ? placeholders : customized).push(wikiRel);
	}

	const contextPlaceholders = placeholders.filter((p) =>
		WIKI_CONTEXT_STARTER_FILES.has(p),
	);

	return {
		total: items.length,
		present: presentFiles.length,
		missing,
		placeholders,
		customized,
		contextPlaceholders,
	};
}

// Write the init detection report to <target>/.amber/init-report.json. writeJson
// creates the .amber directory as needed.
function saveInitReport(targetRoot, data) {
	const reportPath = path.join(targetRoot, ".amber", "init-report.json");
	writeJson(reportPath, data);
	return reportPath;
}

function scaffoldWiki(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const wikiTemplateRoot = path.join(TEMPLATE_ROOT, "docs", "wiki");
	const items = listTemplateFiles(wikiTemplateRoot).map((item) => ({
		source: item.source,
		relativePath: path.join("docs", "wiki", item.relativePath),
	}));
	const result = copyTemplateFiles(targetRoot, items, options);
	const validation = options.dryRun
		? { errors: [], warnings: [] }
		: validateWiki(targetRoot);

	return {
		target: targetRoot,
		created: result.created,
		skipped: result.skipped,
		errors: validation.errors,
		warnings: validation.warnings,
	};
}

module.exports = {
	listTemplateFiles,
	copyTemplateFiles,
	scaffoldHarness,
	scaffoldWiki,
	checkWikiReadiness,
	saveInitReport,
};
