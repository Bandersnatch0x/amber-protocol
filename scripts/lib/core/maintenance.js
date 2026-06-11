"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForRead, resolveStateDirForCreate } = require("../state-dir-resolver");

const {
	pathExists,
	readJson,
	readText,
	relativeSlash,
	resolveTarget,
	walkFiles,
} = require("./fs-utils");

const {
	compareSemver,
	latestTeamVersion,
	loadTeamLock,
	loadTeamRegistry,
	teamStatePaths,
} = require("./team");

const {
	validateWiki,
} = require("./validators");

function listWikiMarkdownFiles(targetRoot) {
	const wikiRoot = path.join(targetRoot, "docs", "wiki");
	return walkFiles(wikiRoot).filter((filePath) => filePath.endsWith(".md"));
}

function detectStaleDocs(targetRoot, options = {}) {
	const now = options.now || new Date();
	const maxAgeDays = options.maxAgeDays || 180;
	const staleDocs = [];

	for (const filePath of listWikiMarkdownFiles(targetRoot)) {
		const content = readText(filePath);
		const relativePath = relativeSlash(targetRoot, filePath);
		const match = content.match(/^Last Reviewed:\s*(\d{4}-\d{2}-\d{2})\s*$/m);
		if (!match) {
			staleDocs.push({
				path: relativePath,
				reason: "missing Last Reviewed marker",
			});
			continue;
		}
		const reviewedAt = new Date(`${match[1]}T00:00:00Z`);
		const ageDays = Math.floor(
			(now.getTime() - reviewedAt.getTime()) / 86400000,
		);
		if (Number.isFinite(ageDays) && ageDays > maxAgeDays) {
			staleDocs.push({
				path: relativePath,
				reason: `last reviewed ${ageDays} days ago`,
				lastReviewed: match[1],
			});
		}
	}

	return staleDocs;
}

function buildWikiLintCi(targetRoot) {
	return {
		ciCommand: `node scripts/harness.js wiki --target ${JSON.stringify(targetRoot)} --dry-run --json`,
		localCommand: `node scripts/validate-wiki.js --target ${JSON.stringify(targetRoot)}`,
		check: "wiki-link-and-starter-file-lint",
	};
}

function detectRulePackDrift(targetRoot, registry) {
	const paths = teamStatePaths(targetRoot);
	const lock = loadTeamLock(paths);
	if (!lock) {
		return { installed: false, drifted: false, expected: [], actual: [] };
	}

	const release = registry.versions && registry.versions[lock.installedVersion];
	const expected =
		release && Array.isArray(release.rulePacks)
			? [...release.rulePacks].sort()
			: [];
	const actual = Array.isArray(lock.rulePacks)
		? [...lock.rulePacks].sort()
		: [];

	return {
		installed: true,
		drifted: JSON.stringify(expected) !== JSON.stringify(actual),
		expected,
		actual,
		installedVersion: lock.installedVersion,
	};
}

function buildUpgradeAssistant(targetRoot, registry) {
	const paths = teamStatePaths(targetRoot);
	const lock = loadTeamLock(paths);
	const latestVersion = latestTeamVersion(registry);

	if (!lock) {
		return {
			installed: false,
			currentVersion: null,
			latestVersion,
			installCommand: `node scripts/harness.js team install --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --preset safe-bootstrap`,
		};
	}

	return {
		installed: true,
		currentVersion: lock.installedVersion,
		latestVersion,
		updateAvailable: compareSemver(lock.installedVersion, latestVersion) < 0,
		previewCommand: `node scripts/harness.js team update --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --dry-run --json`,
		upgradeCommand: `node scripts/harness.js team update --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --confirm --json`,
	};
}

function buildMigrationAssistant(targetRoot, registry) {
	const paths = teamStatePaths(targetRoot);
	const lock = loadTeamLock(paths);
	const latestVersion = latestTeamVersion(registry);
	const latestRelease = registry.versions[latestVersion];

	if (!lock) {
		return {
			needed: true,
			reason: "team distribution is not installed",
			nextCommand: `node scripts/harness.js team install --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --preset safe-bootstrap`,
		};
	}

	return {
		needed:
			lock.profile !== latestRelease.profile ||
			compareSemver(lock.installedVersion, latestVersion) < 0,
		currentProfile: lock.profile,
		targetProfile: latestRelease.profile,
		nextCommand: `node scripts/harness.js team update --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --dry-run --json`,
	};
}

function extractEvolutionFindings(targetRoot) {
	const filePath = path.join(
		targetRoot,
		"docs",
		"wiki",
		"engineering",
		"harness-evolution.md",
	);
	if (!pathExists(filePath)) {
		return [];
	}

	const counts = new Map();
	for (const line of readText(filePath).split(/\r?\n/)) {
		const match = line.match(/Finding:\s*(.+?)\s*$/);
		if (match) {
			const finding = match[1].trim();
			counts.set(finding, (counts.get(finding) || 0) + 1);
		}
	}

	return [...counts.entries()]
		.map(([finding, count]) => ({ finding, count }))
		.filter((item) => item.count > 1)
		.sort(
			(left, right) =>
				right.count - left.count || left.finding.localeCompare(right.finding),
		);
}

function readRegressionProposal(evidencePath, taskDir, targetRoot) {
	let data;
	try {
		data = readJson(evidencePath);
	} catch (error) {
		return null;
	}

	if (
		!data.regressionProposal ||
		data.regressionProposal.status !== "proposed"
	) {
		return null;
	}
	const assertion = data.regressionProposal.assertion;
	if (!assertion) {
		return null;
	}

	return {
		taskId: data.taskId || taskDir,
		plan: data.plan || "",
		assertion,
		traceInput: data.traceReplay ? data.traceReplay.traceInput || "" : "",
		agentConfig: data.traceReplay ? data.traceReplay.agentConfig || "" : "",
		modifiesTests: false,
		approvalRequired: true,
		source: relativeSlash(targetRoot, evidencePath),
	};
}

function extractRegressionProposals(targetRoot) {
	const executionsRoot = path.join(resolveStateDirForRead(targetRoot), "executions");
	if (!pathExists(executionsRoot)) {
		return [];
	}

	const seen = new Set();
	const proposals = [];
	for (const taskDir of fs.readdirSync(executionsRoot)) {
		const evidencePath = path.join(executionsRoot, taskDir, "evidence.json");
		if (!pathExists(evidencePath)) {
			continue;
		}
		const proposal = readRegressionProposal(evidencePath, taskDir, targetRoot);
		if (!proposal) {
			continue;
		}
		const key = `${proposal.taskId}\n${proposal.assertion}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		proposals.push(proposal);
	}

	return proposals
		.sort((left, right) => left.taskId.localeCompare(right.taskId))
		.slice(0, 50);
}

function inspectMaintenance(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const loaded = loadTeamRegistry(options.registry);
	const wikiValidation = validateWiki(targetRoot);

	return {
		target: targetRoot,
		readOnly: true,
		staleDocs: detectStaleDocs(targetRoot),
		wikiLint: {
			...buildWikiLintCi(targetRoot),
			errors: wikiValidation.errors,
			warnings: wikiValidation.warnings,
		},
		rulePackDrift: detectRulePackDrift(targetRoot, loaded.registry),
		migrationAssistant: buildMigrationAssistant(targetRoot, loaded.registry),
		upgradeAssistant: buildUpgradeAssistant(targetRoot, loaded.registry),
		evolutionRollup: extractEvolutionFindings(targetRoot),
		regressionProposals: extractRegressionProposals(targetRoot),
		errors: loaded.errors,
		warnings: loaded.warnings,
	};
}

function buildMaintenanceProposalContent(inspection) {
	const lines = [
		"# Harness Maintenance Proposal",
		"",
		`Target: ${inspection.target}`,
		`Generated: ${new Date().toISOString()}`,
		"",
		"## Stale Docs",
		"",
	];

	if (inspection.staleDocs.length === 0) {
		lines.push("- None detected.");
	} else {
		for (const doc of inspection.staleDocs) {
			lines.push(`- ${doc.path}: ${doc.reason}`);
		}
	}

	lines.push("", "## Upgrade Assistant", "");
	lines.push(
		`- Current: ${inspection.upgradeAssistant.currentVersion || "not installed"}`,
	);
	lines.push(`- Latest: ${inspection.upgradeAssistant.latestVersion}`);
	if (inspection.upgradeAssistant.previewCommand) {
		lines.push(`- Preview: \`${inspection.upgradeAssistant.previewCommand}\``);
	}

	lines.push("", "## Rule-Pack Drift", "");
	lines.push(`- Drifted: ${inspection.rulePackDrift.drifted}`);
	lines.push(
		`- Expected: ${(inspection.rulePackDrift.expected || []).join(", ") || "none"}`,
	);
	lines.push(
		`- Actual: ${(inspection.rulePackDrift.actual || []).join(", ") || "none"}`,
	);

	lines.push("", "## Evolution Rollup", "");
	if (inspection.evolutionRollup.length === 0) {
		lines.push("- No repeated findings detected.");
	} else {
		for (const item of inspection.evolutionRollup) {
			lines.push(`- ${item.finding} (${item.count} occurrences)`);
		}
	}

	lines.push("", "## Regression Proposals", "");
	if (
		!Array.isArray(inspection.regressionProposals) ||
		inspection.regressionProposals.length === 0
	) {
		lines.push("- No trace-derived regression proposals detected.");
	} else {
		for (const proposal of inspection.regressionProposals) {
			lines.push(`- ${proposal.taskId}: ${proposal.assertion}`);
			lines.push(`  - Trace input: ${proposal.traceInput}`);
			lines.push(`  - Agent config: ${proposal.agentConfig}`);
			lines.push(`  - Source: ${proposal.source}`);
			lines.push(`  - Modifies tests: ${proposal.modifiesTests}`);
			lines.push(`  - Approval required: ${proposal.approvalRequired}`);
		}
	}

	lines.push("", "## Suggested Standards Diff", "", "```diff");
	if (inspection.evolutionRollup.length === 0) {
		lines.push("# No repeated delivery findings to promote.");
	} else {
		lines.push("--- standards/harness-delivery.json");
		lines.push("+++ standards/harness-delivery.json");
		for (const item of inspection.evolutionRollup) {
			lines.push(`+ delivery finding: ${item.finding}`);
		}
	}
	lines.push(
		"```",
		"",
		"No source docs or standards were changed by this proposal.",
		"",
	);

	return lines.join("\n");
}

function proposeMaintenance(target, options = {}) {
	const inspection = inspectMaintenance(target, options);
	if (inspection.errors.length > 0) {
		return {
			target: inspection.target,
			errors: inspection.errors,
			warnings: inspection.warnings,
		};
	}

	const proposalRoot = path.join(
		resolveStateDirForCreate(inspection.target),
		"maintenance",
		"proposals",
	);
	const proposalPath = path.join(
		proposalRoot,
		`${new Date().toISOString().replace(/[:.]/g, "-")}-maintenance-proposal.md`,
	);
	fs.mkdirSync(proposalRoot, { recursive: true });
	fs.writeFileSync(proposalPath, buildMaintenanceProposalContent(inspection));

	return {
		target: inspection.target,
		proposalPath: relativeSlash(inspection.target, proposalPath),
		reviewable: true,
		sourceFilesChanged: false,
		inspection,
		errors: [],
		warnings: inspection.warnings,
	};
}

module.exports = {
	listWikiMarkdownFiles,
	detectStaleDocs,
	buildWikiLintCi,
	detectRulePackDrift,
	buildUpgradeAssistant,
	buildMigrationAssistant,
	extractEvolutionFindings,
	readRegressionProposal,
	extractRegressionProposals,
	inspectMaintenance,
	buildMaintenanceProposalContent,
	proposeMaintenance,
};
