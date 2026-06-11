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

function detectStaleDocs(projectRoot, thresholdDays = 180) {
	const now = Date.now();
	const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
	const staleDocs = [];

	for (const filePath of listWikiMarkdownFiles(projectRoot)) {
		const content = readText(filePath);
		const relativePath = relativeSlash(projectRoot, filePath);
		const match = content.match(/^Last Reviewed:\s*(\d{4}-\d{2}-\d{2})\s*$/m);

		if (!match) {
			staleDocs.push({
				path: relativePath,
				lastReviewed: null,
				ageDays: null,
				reason: "missing Last Reviewed marker",
			});
			continue;
		}

		const reviewedAt = new Date(`${match[1]}T00:00:00Z`);
		const ageMs = now - reviewedAt.getTime();
		const ageDays = Math.floor(ageMs / 86400000);

		if (ageMs > thresholdMs) {
			staleDocs.push({
				path: relativePath,
				lastReviewed: match[1],
				ageDays,
				reason: `last reviewed ${ageDays} days ago`,
			});
		}
	}

	return { staleDocs, thresholdDays };
}

function buildWikiLintCi(targetRoot) {
	return {
		ciCommand: `node scripts/amber.js wiki --target ${JSON.stringify(targetRoot)} --dry-run --json`,
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
			installCommand: `node scripts/amber.js team install --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --preset safe-bootstrap`,
		};
	}

	return {
		installed: true,
		currentVersion: lock.installedVersion,
		latestVersion,
		updateAvailable: compareSemver(lock.installedVersion, latestVersion) < 0,
		previewCommand: `node scripts/amber.js team update --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --dry-run --json`,
		upgradeCommand: `node scripts/amber.js team update --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --confirm --json`,
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
			nextCommand: `node scripts/amber.js team install --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --preset safe-bootstrap`,
		};
	}

	return {
		needed:
			lock.profile !== latestRelease.profile ||
			compareSemver(lock.installedVersion, latestVersion) < 0,
		currentProfile: lock.profile,
		targetProfile: latestRelease.profile,
		nextCommand: `node scripts/amber.js team update --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --dry-run --json`,
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

function rollupEvolutionFindings(projectRoot) {
	const filePath = path.join(projectRoot, "docs", "wiki", "engineering", "harness-evolution.md");
	if (!pathExists(filePath)) {
		return { findings: [], threshold: 2 };
	}

	const counts = new Map();
	for (const line of readText(filePath).split(/\r?\n/)) {
		const match = line.match(/Finding:\s*(.+?)\s*$/);
		if (match) {
			const text = match[1].trim();
			counts.set(text, (counts.get(text) || 0) + 1);
		}
	}

	const findings = [...counts.entries()]
		.filter(([, count]) => count >= 2)
		.map(([text, count]) => ({ text, count }))
		.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));

	return { findings, threshold: 2 };
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
	const staleDocsResult = detectStaleDocs(targetRoot);

	return {
		target: targetRoot,
		readOnly: true,
		staleDocs: staleDocsResult.staleDocs,
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
		lines.push("--- standards/amber-delivery.json");
		lines.push("+++ standards/amber-delivery.json");
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

function detectPackDrift(projectRoot, registryPath) {
	const paths = teamStatePaths(projectRoot);
	if (!pathExists(paths.lockPath)) {
		return { drifted: false, installed: [], latest: [], diff: [] };
	}

	const lock = readJson(paths.lockPath);
	const registry = readJson(registryPath);
	const installed = Array.isArray(lock.rulePacks) ? lock.rulePacks : [];
	const latestVer = latestTeamVersion(registry);
	const latest = registry.versions?.[latestVer]?.rulePacks || [];
	const diff = latest.filter(p => !installed.includes(p));

	return {
		drifted: JSON.stringify([...installed].sort()) !== JSON.stringify([...latest].sort()),
		installed,
		latest,
		diff,
	};
}

function validateWikiStructure(projectRoot) {
	return validateWiki(projectRoot);
}

function previewUpgrade(projectRoot, version, registryPath) {
	const paths = teamStatePaths(projectRoot);
	const lock = loadTeamLock(paths);
	const registry = readJson(registryPath);
	const targetVersion = version || latestTeamVersion(registry);
	const targetRelease = registry.versions?.[targetVersion];

	if (!lock) {
		return {
			currentVersion: null,
			targetVersion,
			changes: { addedPacks: targetRelease?.rulePacks || [], removedPacks: [], updatedPacks: [] },
		};
	}

	const current = Array.isArray(lock.rulePacks) ? lock.rulePacks : [];
	const target = Array.isArray(targetRelease?.rulePacks) ? targetRelease.rulePacks : [];
	const addedPacks = target.filter(p => !current.includes(p));
	const removedPacks = current.filter(p => !target.includes(p));
	const updatedPacks = target.filter(p => current.includes(p));

	return {
		currentVersion: lock.installedVersion,
		targetVersion,
		changes: { addedPacks, removedPacks, updatedPacks },
	};
}

function generateMaintenanceProposal(projectRoot, outputPath) {
	const targetRoot = resolveTarget(projectRoot);
	const loaded = loadTeamRegistry();

	const m1 = detectStaleDocs(targetRoot);
	const m2 = validateWiki(targetRoot);
	const m3 = detectRulePackDrift(targetRoot, loaded.registry);
	const m4 = buildUpgradeAssistant(targetRoot, loaded.registry);
	const m5 = rollupEvolutionFindings(targetRoot);
	const m6 = extractRegressionProposals(targetRoot);

	const actions = [];
	if (m1.staleDocs.length > 0) {
		actions.push({ impact: "high", action: `Review ${m1.staleDocs.length} stale docs` });
	}
	if (m2.errors.length > 0) {
		actions.push({ impact: "high", action: `Fix ${m2.errors.length} wiki lint errors` });
	}
	if (m3.drifted) {
		actions.push({ impact: "medium", action: "Sync rule pack drift" });
	}
	if (m4.updateAvailable) {
		actions.push({ impact: "medium", action: `Upgrade to ${m4.latestVersion}` });
	}
	if (m5.findings.length > 0) {
		actions.push({ impact: "low", action: `Address ${m5.findings.length} repeated findings` });
	}
	if (m6.length > 0) {
		actions.push({ impact: "low", action: `Review ${m6.length} regression proposals` });
	}

	const sortOrder = { high: 0, medium: 1, low: 2 };
	actions.sort((a, b) => sortOrder[a.impact] - sortOrder[b.impact]);

	const lines = [
		"# Harness Maintenance Proposal",
		"",
		`Generated: ${new Date().toISOString()}`,
		`Target: ${targetRoot}`,
		"",
		"## 1. Stale Docs",
		"",
		m1.staleDocs.length === 0 ? "No stale docs detected." : m1.staleDocs.map(d => `- ${d.path}: ${d.reason}`).join("\n"),
		"",
		"## 2. Wiki Lint Errors",
		"",
		m2.errors.length === 0 ? "No wiki lint errors." : m2.errors.map(e => `- ${e}`).join("\n"),
		m2.warnings.length > 0 ? `\nWarnings:\n${m2.warnings.map(w => `- ${w}`).join("\n")}` : "",
		"",
		"## 3. Pack Drift",
		"",
		`Drifted: ${m3.drifted}`,
		m3.installed ? `- Installed version: ${m3.installedVersion}` : "- Not installed",
		`- Expected packs: ${m3.expected.join(", ") || "none"}`,
		`- Actual packs: ${m3.actual.join(", ") || "none"}`,
		"",
		"## 4. Available Upgrades",
		"",
		`Current: ${m4.currentVersion || "not installed"}`,
		`Latest: ${m4.latestVersion}`,
		`Update available: ${m4.updateAvailable || false}`,
		m4.upgradeCommand ? `Command: \`${m4.upgradeCommand}\`` : "",
		"",
		"## 5. Repeated Findings",
		"",
		m5.findings.length === 0 ? "No repeated findings." : m5.findings.map(f => `- ${f.text} (${f.count}×)`).join("\n"),
		"",
		"## 6. Regression Proposals",
		"",
		m6.length === 0 ? "No regression proposals." : m6.map(p => `- ${p.taskId}: ${p.assertion}\n  Source: ${p.source}`).join("\n\n"),
		"",
		"## 7. Prioritized Actions",
		"",
		actions.length === 0 ? "No actions required." : actions.map(a => `- [${a.impact.toUpperCase()}] ${a.action}`).join("\n"),
		"",
	];

	const content = lines.filter(l => l !== undefined).join("\n");
	fs.writeFileSync(outputPath, content, "utf8");

	return {
		sections: 7,
		staleDocs: m1.staleDocs.length,
		drifted: m3.drifted,
		proposals: m6.length,
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
	rollupEvolutionFindings,
	readRegressionProposal,
	extractRegressionProposals,
	inspectMaintenance,
	buildMaintenanceProposalContent,
	proposeMaintenance,
	validateWikiStructure,
	detectPackDrift,
	previewUpgrade,
	generateMaintenanceProposal,
};
