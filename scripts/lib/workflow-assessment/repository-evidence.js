"use strict";

// ADR-0008 P1: repository-only evidence collection. Reads static repo
// artifacts + .amber non-session telemetry. Does NOT parse timeline.jsonl or
// manifest.json session events (P2). Reuses existing pure collectors from
// governance-readiness / maintenance / lifecycle / handoff-bundle / text-utils
// rather than reimplementing — ponytail: no new logic where stdlib-grade
// collectors already exist.

const fs = require("node:fs");
const path = require("node:path");

const {
	inspectRoutes,
	inspectWorkflowPacks,
	inspectGlxControls,
} = require("../core/governance-readiness");
const {
	countEvolutionFindings,
	extractEvolutionFindings,
	extractRegressionProposals,
} = require("../core/maintenance");
const { detectCommands } = require("../core/audit");
const {
	REQUIRED_BUNDLE_FILES,
	defaultBundleDir,
} = require("../core/handoff-bundle");
const { getSectionBody, hasSectionWithBody } = require("../core/text-utils");
const { resolveStateDirForRead } = require("../state-dir-resolver");

function slash(p) {
	return p.split(path.sep).join("/");
}

function readJsonSafe(filePath) {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return null;
	}
}

function listMarkdownFiles(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(".md"))
		.sort()
		.map((name) => path.join(dir, name));
}

// Feature list: user_visible_behavior + verification per feature.
function collectFeatures(targetRoot) {
	const filePath = path.join(targetRoot, "feature_list.json");
	if (!fs.existsSync(filePath)) return { present: false, features: [] };
	const data = readJsonSafe(filePath);
	const features = Array.isArray(data?.features) ? data.features : [];
	return { present: true, features };
}

// Plans: Goal + Acceptance Criteria sections per plan file.
function collectPlans(targetRoot) {
	const plansDir = path.join(targetRoot, "docs", "plans");
	const files = listMarkdownFiles(plansDir);
	const plans = files.map((filePath) => {
		const text = fs.readFileSync(filePath, "utf8");
		return {
			file: slash(path.relative(targetRoot, filePath)),
			hasGoal: hasSectionWithBody(text, "Goal"),
			hasAcceptanceCriteria: hasSectionWithBody(text, "Acceptance Criteria"),
			hasVerification: hasSectionWithBody(text, "Verification"),
		};
	});
	return { present: files.length > 0, plans };
}

// Execution evidence: commands recorded per execution.
function collectExecutions(targetRoot) {
	const execRoot = path.join(resolveStateDirForRead(targetRoot), "executions");
	if (!fs.existsSync(execRoot)) return { present: false, executions: [], hasCommands: false };
	const taskDirs = fs
		.readdirSync(execRoot)
		.map((name) => path.join(execRoot, name))
		.filter((p) => fs.statSync(p).isDirectory());
	let hasCommands = false;
	const executions = taskDirs.map((taskDir) => {
		const evidencePath = path.join(taskDir, "evidence.json");
		const data = readJsonSafe(evidencePath);
		const commands = Array.isArray(data?.commands) ? data.commands : [];
		if (commands.length > 0) hasCommands = true;
		return { dir: path.basename(taskDir), commands };
	});
	return { present: executions.length > 0, executions, hasCommands };
}

// Handoff bundle: required files + risks/recovery body.
function collectHandoff(targetRoot, bundleDir) {
	const dir = bundleDir || defaultBundleDir(targetRoot);
	if (!fs.existsSync(dir)) return { present: false, missing: [], risksBody: "", recoveryBody: "" };
	const missing = REQUIRED_BUNDLE_FILES.filter(
		(name) => !fs.existsSync(path.join(dir, name)),
	);
	const risksText = (() => {
		const p = path.join(dir, "risks.md");
		return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
	})();
	const recoveryText = (() => {
		const p = path.join(dir, "recovery-commands.md");
		return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
	})();
	return {
		present: true,
		missing,
		risksBody: getSectionBody(risksText, "Risks") || "",
		recoveryBody: getSectionBody(recoveryText, "Recovery Commands") || "",
	};
}

// Aggregate all repository-only evidence. Pure: filesystem-in, plain-object-out.
function collectRepositoryEvidence(targetRoot, options = {}) {
	const routes = inspectRoutes(targetRoot);
	const workflowPacks = inspectWorkflowPacks(targetRoot);
	const glx = inspectGlxControls(targetRoot);
	const features = collectFeatures(targetRoot);
	const plans = collectPlans(targetRoot);
	const executions = collectExecutions(targetRoot);
	const handoff = collectHandoff(targetRoot, options.handoffBundleDir);
	const evolution = {
		findings: countEvolutionFindings(targetRoot),
		significant: extractEvolutionFindings(targetRoot),
	};
	const regressionProposals = extractRegressionProposals(targetRoot);
	const verifyCommand = (() => {
		const commands = detectCommands(targetRoot);
		if (commands.some((c) => c.source === "package.json" && c.name === "test")) {
			return "npm test";
		}
		// Fallback: only accept verify-shaped command names; do not fabricate
		// a verify command from build/start/etc. (ADR-0008: missing evidence
		// stays missing, not invented).
		const verifyShaped = commands.find((c) => /^(test|check|verify|ci).*$/i.test(c.name));
		return verifyShaped ? verifyShaped.command : null;
	})();

	return {
		target: targetRoot,
		routes,
		workflowPacks,
		glx,
		features,
		plans,
		executions,
		handoff,
		evolution,
		regressionProposals,
		verifyCommand,
	};
}

module.exports = {
	collectRepositoryEvidence,
	collectFeatures,
	collectPlans,
	collectExecutions,
	collectHandoff,
};
