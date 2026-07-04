"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForRead, resolveStateDirForCreate } = require("../state-dir-resolver");

const {
	pathExists,
	readJson,
	readJsonSafe,
	readText,
	relativeSlash,
	resolveTarget,
	walkFiles,
} = require("./fs-utils");

const {
	TEMPLATE_ROOT,
} = require("./constants");

const {
	compareSemver,
	latestTeamVersion,
	loadTeamLock,
	loadTeamRegistry,
	teamStatePaths,
} = require("./team");

const {
	MESSAGES,
} = require("./terminology");

const {
	validateWiki,
} = require("./validators");

function listWikiMarkdownFiles(targetRoot) {
	const wikiRoot = path.join(targetRoot, "docs", "wiki");
	return walkFiles(wikiRoot).filter((filePath) => filePath.endsWith(".md"));
}

// An init-generated wiki file that still matches its template byte-for-byte is an
// unfilled placeholder, not a reviewed doc that has gone stale. Flagging all of
// them the moment `init` runs produces pure noise (a fresh install reports every
// wiki file as stale). We treat a file as a pristine placeholder only when its
// bytes are identical to the shipped template; the moment a team edits it, it
// re-enters staleness tracking and a missing/old Last Reviewed marker is fair game.
function isUneditedWikiTemplate(targetRoot, filePath) {
	const relativeFromWiki = relativeSlash(
		path.join(targetRoot, "docs", "wiki"),
		filePath,
	);
	const templatePath = path.join(
		TEMPLATE_ROOT,
		"docs",
		"wiki",
		...relativeFromWiki.split("/"),
	);
	if (!pathExists(templatePath)) {
		return false;
	}
	try {
		return readText(filePath) === readText(templatePath);
	} catch {
		return false;
	}
}

function detectStaleDocs(projectRoot, thresholdDays = 180) {
	const now = Date.now();
	const thresholdMs = thresholdDays * 24 * 60 * 60 * 1000;
	const staleDocs = [];

	for (const filePath of listWikiMarkdownFiles(projectRoot)) {
		if (isUneditedWikiTemplate(projectRoot, filePath)) {
			continue;
		}
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

// Integrity drift: does the installed lock still match the rulePacks that ITS
// OWN installed version declares? Answers "has my install been tampered with or
// fallen out of sync with its version spec?" Compare with detectPackDrift, which
// instead measures the gap to the LATEST version.
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
			installCommand: `node scripts/amber.js team install --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --preset safe-bootstrap --dry-run --json`,
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
			nextCommand: `node scripts/amber.js team install --target ${JSON.stringify(targetRoot)} --version ${latestVersion} --preset safe-bootstrap --dry-run --json`,
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

// Shared core: count "Finding: <text>" occurrences in harness-evolution.md and
// return them sorted by count (desc) then text (asc). Both extractEvolutionFindings
// and rollupEvolutionFindings previously duplicated this read+match+count+sort;
// it lives here once. Returns [] when the file is absent. Does not filter by
// threshold — each caller applies its own cutoff.
// A finding is "significant" once it recurs. Both lineage adapters
// (extractEvolutionFindings, rollupEvolutionFindings) share this single cutoff
// so the threshold can never drift between them.
const EVOLUTION_FINDING_MIN_COUNT = 2;

function countEvolutionFindings(targetRoot) {
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
		.sort(
			(left, right) =>
				right.count - left.count || left.finding.localeCompare(right.finding),
		);
}

// Findings that recur at least minCount times. The single filtering point for
// both lineage adapters and the CLI rollup, so the cutoff lives in one place.
function significantEvolutionFindings(targetRoot, minCount) {
	return countEvolutionFindings(targetRoot).filter(
		(item) => item.count >= minCount,
	);
}

function extractEvolutionFindings(targetRoot) {
	return significantEvolutionFindings(targetRoot, EVOLUTION_FINDING_MIN_COUNT);
}

function rollupEvolutionFindings(
	projectRoot,
	minCount = EVOLUTION_FINDING_MIN_COUNT,
) {
	const findings = significantEvolutionFindings(projectRoot, minCount).map(
		({ finding, count }) => ({ text: finding, count }),
	);
	return { findings, threshold: minCount };
}

function readRegressionProposal(evidencePath, taskDir, targetRoot) {
	let data;
	try {
		data = readJson(evidencePath);
	} catch (error) {
		return null;
	}

	// The catch above only guards JSON *syntax* errors; a body of valid JSON
	// `null` (or any non-object) parses cleanly, then the data.regressionProposal
	// read below throws. Since extractRegressionProposals walks every evidence
	// file, one such file would crash the whole inspection — skip it like an
	// unparseable one instead.
	if (!data || typeof data !== "object") {
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
	const { detectScaffoldDrift } = require("./scaffold-version-drift");
	const scaffoldDriftResult = detectScaffoldDrift(targetRoot);
	const { detectArtifactDrift } = require("./artifact-drift");

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
		scaffoldDrift: scaffoldDriftResult,
		artifactDrift: detectArtifactDrift(targetRoot),
		errors: loaded.errors,
		warnings: loaded.warnings,
	};
}

function buildMaintenanceProposalContent(inspection) {
	const lines = [
		MESSAGES.maintenanceProposalTitle,
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

	// Apply priority filter if specified
	let filteredInspection = inspection;
	if (options.priority) {
		// Validate the requested priority up front. An unrecognized value used to
		// fall through every branch, leaving allowedCategories empty so each
		// section was zeroed and a blank proposal was written with no error — a
		// silent failure. Fail fast with a clear message instead.
		if (!['high', 'medium', 'low'].includes(options.priority)) {
			return {
				target: inspection.target,
				errors: [
					`Unknown priority "${options.priority}". Use high, medium, or low.`,
				],
				warnings: inspection.warnings,
			};
		}

		const priorityLevels = {
			high: ['staleDocs', 'rulePackDrift'],
			medium: ['upgradeAssistant', 'evolutionRollup'],
			low: ['regressionProposals'],
		};

		const allowedCategories = [];
		if (options.priority === 'high') {
			allowedCategories.push(...priorityLevels.high);
		} else if (options.priority === 'medium') {
			allowedCategories.push(...priorityLevels.high, ...priorityLevels.medium);
		} else if (options.priority === 'low') {
			allowedCategories.push(...priorityLevels.high, ...priorityLevels.medium, ...priorityLevels.low);
		}

		filteredInspection = { ...inspection };
		if (!allowedCategories.includes('staleDocs')) filteredInspection.staleDocs = [];
		if (!allowedCategories.includes('rulePackDrift')) filteredInspection.rulePackDrift = { drifted: false, expected: [], actual: [] };
		if (!allowedCategories.includes('upgradeAssistant')) filteredInspection.upgradeAssistant = { currentVersion: null, latestVersion: null };
		if (!allowedCategories.includes('evolutionRollup')) filteredInspection.evolutionRollup = [];
		if (!allowedCategories.includes('regressionProposals')) filteredInspection.regressionProposals = [];
	}

	const proposalRoot = path.join(
		resolveStateDirForCreate(filteredInspection.target),
		"maintenance",
		"proposals",
	);
	const proposalPath = path.join(
		proposalRoot,
		`${new Date().toISOString().replace(/[:.]/g, "-")}-maintenance-proposal.md`,
	);
	fs.mkdirSync(proposalRoot, { recursive: true });
	fs.writeFileSync(proposalPath, buildMaintenanceProposalContent(filteredInspection));

	return {
		target: filteredInspection.target,
		proposalPath: relativeSlash(filteredInspection.target, proposalPath),
		reviewable: true,
		sourceFilesChanged: false,
		inspection: filteredInspection,
		priority: options.priority || 'all',
		errors: [],
		warnings: filteredInspection.warnings,
	};
}

// Upgrade-gap drift: how do the installed rulePacks compare to the LATEST
// version's rulePacks? Answers "am I behind the newest release?" (`diff` lists
// packs the latest version adds). Distinct from detectRulePackDrift, which
// compares against the installed version's own spec, not the latest.
function detectPackDrift(projectRoot, registryPath) {
	const paths = teamStatePaths(projectRoot);
	if (!pathExists(paths.lockPath)) {
		return { drifted: false, installed: [], latest: [], diff: [] };
	}

	const { value: lock, error: lockError } = readJsonSafe(paths.lockPath);
	if (lockError) {
		throw new Error(lockError);
	}
	if (!lock || typeof lock !== "object" || Array.isArray(lock)) {
		throw new Error(`Team lock file is not a valid object: ${paths.lockPath}`);
	}

	const { value: registry, error: registryError } = readJsonSafe(registryPath);
	if (registryError) {
		throw new Error(registryError);
	}
	if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
		throw new Error(`Team registry is not a valid object: ${registryPath}`);
	}

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

function fixWikiMarkers(projectRoot) {
	const {
		WIKI_CONTEXT_STARTER_FILES,
	} = require("./constants");
	const {
		hasSectionWithBody,
	} = require("./text-utils");

	const fixed = [];
	for (const relativePath of WIKI_CONTEXT_STARTER_FILES) {
		const filePath = path.join(projectRoot, relativePath);
		if (!pathExists(filePath)) {
			continue;
		}
		const content = readText(filePath);
		if (hasSectionWithBody(content, "Unknowns / Needs Confirmation")) {
			continue;
		}
		const section = [
			"## Unknowns / Needs Confirmation",
			"",
			"- Confirm the facts on this page; mark anything unverified.",
			"",
		].join("\n");
		const trimmed = content.replace(/\s*$/, "");
		fs.writeFileSync(filePath, `${trimmed}\n\n${section}`);
		fixed.push(relativePath);
	}

	return { fixed, fixedCount: fixed.length };
}

function previewUpgrade(projectRoot, version, registryPath) {
	const paths = teamStatePaths(projectRoot);
	const lock = loadTeamLock(paths);
	const { value: registry, error: registryError } = readJsonSafe(registryPath);
	if (registryError) {
		throw new Error(registryError);
	}
	if (!registry || typeof registry !== "object" || Array.isArray(registry)) {
		throw new Error(`Team registry is not a valid object: ${registryPath}`);
	}
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
		MESSAGES.maintenanceProposalTitle,
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
	countEvolutionFindings,
	extractEvolutionFindings,
	rollupEvolutionFindings,
	readRegressionProposal,
	extractRegressionProposals,
	inspectMaintenance,
	buildMaintenanceProposalContent,
	proposeMaintenance,
	validateWikiStructure,
	fixWikiMarkers,
	detectPackDrift,
	previewUpgrade,
};
