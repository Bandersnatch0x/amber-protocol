"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	fileMentionsWiki,
	hasNextAction,
	hasVerificationCommand,
	validateHandoff,
} = require("./audit");

const {
	REQUIRED_HARNESS_FILES,
} = require("./constants");

const {
	pathExists,
	resolveTarget,
} = require("./fs-utils");

const { validateManifests } = require("./manifests");
const { classifyTarget } = require("./target-classification");

const {
	inspectProjectProfile,
} = require("./profiles");

const {
	validateContinuousImprovementStateFile,
	validateFeatureListFile,
	validateWiki,
} = require("./validators");

const {
	inspectWorkflowPack,
} = require("./workflow-packs");

const { remedyFor } = require("./lifecycle");

const { CLI_VERSION } = require("./constants");

function hasPluginManifestDirectory(targetRoot) {
	return (
		pathExists(path.join(targetRoot, ".codex-plugin")) ||
		pathExists(path.join(targetRoot, ".claude-plugin"))
	);
}

function doctorProductRepo(targetRoot, classification) {
	const errors = [];
	const warnings = [];
	const productChecks = [];

	// Product-repo still owns a feature_list.json (self-dogfood). Enforce the
	// same feature-list invariants as target-repo doctor — including at most
	// one in_progress — so product-repo doctor can't print Errors:0 while the
	// list violates Operating Manual §6 (#66).
	const featureResult = validateFeatureListFile(
		path.join(targetRoot, "feature_list.json"),
	);
	errors.push(...featureResult.errors);
	warnings.push(...featureResult.warnings);
	productChecks.push({
		name: "feature_list.json",
		errors: featureResult.errors.length,
		warnings: featureResult.warnings.length,
	});

	if (hasPluginManifestDirectory(targetRoot)) {
		const manifestResult = validateManifests(targetRoot);
		errors.push(...manifestResult.errors);
		warnings.push(...manifestResult.warnings);
		productChecks.push({
			name: "plugin-manifests",
			errors: manifestResult.errors.length,
			warnings: manifestResult.warnings.length,
		});
	}

	const samplePackPath = path.join(
		targetRoot,
		"workflow-packs",
		"safe-amber-bootstrap.pack.json",
	);
	const sampleProfilePath = path.join(
		targetRoot,
		"profiles",
		"default.profile.json",
	);
	const packResult = inspectWorkflowPack(samplePackPath);
	const profileResult = inspectProjectProfile(sampleProfilePath);
	errors.push(...packResult.errors);
	warnings.push(...packResult.warnings);
	errors.push(...profileResult.errors);
	warnings.push(...profileResult.warnings);
	productChecks.push({
		name: "workflow-pack-smoke",
		errors: packResult.errors.length,
		warnings: packResult.warnings.length,
	});
	productChecks.push({
		name: "project-profile-smoke",
		errors: profileResult.errors.length,
		warnings: profileResult.warnings.length,
	});

	return {
		target: targetRoot,
		classification,
		productChecks,
		errors,
		warnings,
	};
}

function doctor(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const classification = classifyTarget(targetRoot);
	if (classification.type === "product-repo") {
		return doctorProductRepo(targetRoot, classification);
	}

	const errors = [];
	const warnings = [];
	const checks = [];

	function addCheck(name, passed, detail, remedy) {
		const check = { name, passed, detail: detail || null };
		if (!passed && remedy) check.remedy = remedy;
		checks.push(check);
	}

	// Required harness files
	let missingFiles = 0;
	for (const relativePath of REQUIRED_HARNESS_FILES) {
		if (!pathExists(path.join(targetRoot, relativePath))) {
			missingFiles++;
			if (
				relativePath === "docs/wiki/agent/amber.md" &&
				pathExists(path.join(targetRoot, "docs", "wiki", "agent", "harness.md"))
			) {
				errors.push(
					`Missing required file: ${relativePath} (legacy harness.md found — run: amber migrate wiki --target .)`,
				);
				continue;
			}
			errors.push(`Missing required file: ${relativePath}`);
		}
	}
	addCheck("Required harness files", missingFiles === 0,
		missingFiles === 0 ? "all present" : `${missingFiles} missing`,
		remedyFor("init", { targetDisplay: target || "." }));

	// Feature list validation
	const featureResult = validateFeatureListFile(
		path.join(targetRoot, "feature_list.json"),
	);
	errors.push(...featureResult.errors);
	warnings.push(...featureResult.warnings);
	addCheck("feature_list.json", featureResult.errors.length === 0,
		featureResult.errors.length === 0 ? "valid" : featureResult.errors[0]);

	// Continuous improvement state
	const continuousImprovementResult = validateContinuousImprovementStateFile(
		path.join(targetRoot, ".workflow", "continuous-improvement", "state.json"),
	);
	errors.push(...continuousImprovementResult.errors);
	warnings.push(...continuousImprovementResult.warnings);
	addCheck("Continuous improvement state", continuousImprovementResult.errors.length === 0,
		continuousImprovementResult.errors.length === 0 ? "valid" : continuousImprovementResult.errors[0]);

	// Wiki validation
	const wikiResult = validateWiki(targetRoot, { okf: options.okf === true });
	errors.push(...wikiResult.errors);
	warnings.push(...wikiResult.warnings);
	addCheck("Wiki structure", wikiResult.errors.length === 0,
		wikiResult.errors.length === 0 ? "valid" : `${wikiResult.errors.length} errors`);

	// AGENTS.md wiki routing
	const agentsRoutesWiki = fileMentionsWiki(path.join(targetRoot, "AGENTS.md"));
	if (!agentsRoutesWiki) {
		errors.push("AGENTS.md does not route agents to docs/wiki.");
	}
	addCheck("AGENTS.md → wiki routing", agentsRoutesWiki);

	// CLAUDE.md wiki routing
	const claudeExists = pathExists(path.join(targetRoot, "CLAUDE.md"));
	const claudeRoutesWiki = claudeExists && fileMentionsWiki(path.join(targetRoot, "CLAUDE.md"));
	if (claudeExists && !claudeRoutesWiki) {
		errors.push("CLAUDE.md does not route agents to docs/wiki.");
	}
	// When the file doesn't exist, report as not-applicable (null) rather than
	// passing — a missing file is not the same as a validated routing link.
	addCheck("CLAUDE.md → wiki routing", claudeExists ? claudeRoutesWiki : null,
		!claudeExists ? "file not present — check skipped" : claudeRoutesWiki ? "routes to wiki" : "missing wiki routing");

	// Verification command
	const hasVerify = hasVerificationCommand(targetRoot);
	if (!hasVerify) {
		errors.push(
			"docs/wiki/engineering/verification.md does not contain a verification command block.",
		);
	}
	addCheck("Verification command block", hasVerify);

	// PROGRESS.md next action
	const hasNext = hasNextAction(path.join(targetRoot, "PROGRESS.md"));
	if (!hasNext) {
		errors.push("PROGRESS.md does not contain a next action.");
	}
	addCheck("PROGRESS.md next action", hasNext);

	// Session handoff
	const handoffResult = validateHandoff(targetRoot);
	errors.push(...handoffResult.errors);
	warnings.push(...handoffResult.warnings);
	addCheck("Session handoff", handoffResult.errors.length === 0,
		handoffResult.errors.length === 0 ? "valid" : `${handoffResult.errors.length} errors`);

	// Plugin manifests (optional)
	if (hasPluginManifestDirectory(targetRoot)) {
		const manifestResult = validateManifests(targetRoot);
		errors.push(...manifestResult.errors);
		warnings.push(...manifestResult.warnings);
		addCheck("Plugin manifests", manifestResult.errors.length === 0,
			manifestResult.errors.length === 0 ? "valid" : `${manifestResult.errors.length} errors`);
	}

	// Version drift — scan artifacts with amber_protocol_version against the
	// installed package version. Only warn when the field is present and doesn't
	// match; absent fields are legal legacy artifacts (ADR-0012).
	const amberDir = path.join(targetRoot, ".amber");
	if (pathExists(amberDir)) {
		const driftArtifacts = [];
		const queue = [amberDir];
		while (queue.length > 0) {
			const dir = queue.shift();
			let entries;
			try {
				entries = fs.readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}
			for (const entry of entries) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
					queue.push(full);
				} else if (entry.isFile() && entry.name.endsWith(".json")) {
					try {
						const content = JSON.parse(fs.readFileSync(full, "utf8"));
						if (content && typeof content.amber_protocol_version === "string") {
							if (content.amber_protocol_version !== CLI_VERSION) {
								const rel = path.relative(targetRoot, full);
								driftArtifacts.push(`${rel} (${content.amber_protocol_version})`);
							}
						}
					} catch {
						// Unparseable or non-object JSON; skip silently.
					}
				}
			}
		}
		if (driftArtifacts.length > 0) {
			const detail = `${driftArtifacts.length} artifact(s) at a different protocol version than installed (${CLI_VERSION}): ${driftArtifacts.join(", ")}`;
			warnings.push(detail);
			addCheck("Artifact protocol version", false, detail, "amber migrate --target .");
		} else {
			addCheck("Artifact protocol version", true, `all versioned artifacts match ${CLI_VERSION}`);
		}
	}

	// Context pages (optional — only when the context layer is in use, ADR-0009 D8)
	if (pathExists(path.join(targetRoot, ".amber", "context"))) {
		const { verifyPages } = require("./context-verify");
		const ctx = verifyPages(targetRoot);
		if (ctx.summary.total > 0) {
			const hardFailures = ctx.summary.tampered + ctx.summary.obsolete + ctx.summary.orphaned;
			const detail = `${ctx.summary.total} pages: ok ${ctx.summary.ok}, stale ${ctx.summary.stale}, tampered ${ctx.summary.tampered}, obsolete ${ctx.summary.obsolete}, orphaned ${ctx.summary.orphaned}`;
			addCheck("Context pages", hardFailures === 0, detail,
				hardFailures === 0 ? null : "amber context verify --target .");
			if (hardFailures > 0) errors.push(detail);
		}
	}

	return { target: targetRoot, classification, checks, errors, warnings };
}

module.exports = {
	hasPluginManifestDirectory,
	doctorProductRepo,
	doctor,
};
