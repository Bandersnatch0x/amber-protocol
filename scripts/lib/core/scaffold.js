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

function scaffoldHarness(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const templateRoot = options.templateRoot || TEMPLATE_ROOT;
	const items = listTemplateFiles(templateRoot);
	const result = copyTemplateFiles(targetRoot, items, options);

	const warnings = [];
	const created = result.created;

	// Warn if CLAUDE.md was created — it changes agent behavior immediately.
	if (created.some((f) => f === "CLAUDE.md")) {
		warnings.push(
			"CLAUDE.md was created. Claude Code will read it on the next session " +
				"and follow its instructions — review it before your next chat.",
		);
	}

	// Detect gitignore rules that hide amber governance files.
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

	// Wiki readiness (--with-wiki). The base install already copies every wiki
	// template, so the useful signal here is not "did we create files" but "are
	// the context files still placeholders" — which connects init to the doctor
	// and feature workflows downstream.
	const wikiReadiness = options.withWiki ? checkWikiReadiness(targetRoot) : null;

	// Best-effort Git workflow detection + governance advice (opt out with
	// --skip-detection). On a non-git target detectGitWorkflow returns null, so
	// detection stays null and nothing is written — base init behavior is intact.
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

	// Next-steps guidance for first-time users.
	const nextSteps = [];
	if (created.length > 0) {
		nextSteps.push(
			"1. Review CLAUDE.md and AGENTS.md — they control agent behavior.",
			"2. Customize feature_list.json with your project's features.",
			"3. Fill in docs/wiki/product/overview.md with project context.",
			"4. Add a verification command in docs/wiki/engineering/verification.md.",
			"5. Run `amber doctor --target .` to verify the setup.",
		);
	}
	if (wikiReadiness && wikiReadiness.contextPlaceholders.length > 0) {
		nextSteps.push(
			`Fill in ${wikiReadiness.contextPlaceholders.length} wiki context file(s) still using placeholder content (see Wiki readiness).`,
		);
	}
	if (
		detection &&
		detection.governance &&
		detection.governance.recommendations.gitignore.missing.length > 0
	) {
		nextSteps.push(
			"Update .gitignore to ignore personal Amber state (see .amber/init-report.json).",
		);
	}

	// Persist the detection report so downstream commands can read it. Never
	// written during a dry run, and only when there is something to record.
	if (!options.dryRun && (detection || wikiReadiness)) {
		saveInitReport(targetRoot, {
			version: "1.0.0",
			timestamp: new Date().toISOString(),
			target: targetRoot,
			workflow: detection ? detection.workflow : null,
			governance: detection ? detection.governance : null,
			wikiReadiness,
			installation: {
				templatesCreated: created,
				skipped: result.skipped,
			},
		});
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
