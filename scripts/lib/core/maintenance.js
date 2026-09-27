"use strict";

/**
 * Maintenance legacy CommonJS surface (F014).
 *
 * Production consumers now use the root facade (`scripts/lib/maintenance`,
 * exposing inspect / evidence / staleDocs outcomes) or the Governance Console
 * command adapter (`scripts/lib/maintenance/adapters/command`). This file
 * remains the documented require path for package consumers during the
 * deprecation cycle and forwards retained helper exports without runtime
 * deprecation noise. Removal is deferred to a declared major release.
 */

const fs = require("node:fs");
const path = require("node:path");
// resolveStateDirForCreate moved with proposeMaintenance into
// maintenance-propose.js; only the read path remains here.
const { resolveStateDirForRead } = require("../state-dir-resolver");

const {
	pathExists,
	readJson,
	readText,
	relativeSlash,
	resolveTarget,
	walkFiles,
} = require("./fs-utils");

// Amber Evolution finding collectors moved to evolution-findings.js (F014-M2)
// so the Maintenance evidence facade can share them without a circular require.
const {
	EVOLUTION_FINDING_MIN_COUNT,
	countEvolutionFindings,
	extractEvolutionFindings,
	significantEvolutionFindings,
} = require("./evolution-findings");

const { TEMPLATE_ROOT } = require("./constants");

// MESSAGES moved with buildMaintenanceProposalContent into maintenance-propose.js.

const { validateWiki } = require("./validators");

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
	const relativeFromWiki = relativeSlash(path.join(targetRoot, "docs", "wiki"), filePath);
	const templatePath = path.join(TEMPLATE_ROOT, "docs", "wiki", ...relativeFromWiki.split("/"));
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

function rollupEvolutionFindings(projectRoot, minCount = EVOLUTION_FINDING_MIN_COUNT) {
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

	if (!data.regressionProposal || data.regressionProposal.status !== "proposed") {
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

	return proposals.sort((left, right) => left.taskId.localeCompare(right.taskId)).slice(0, 50);
}

function inspectMaintenance(target) {
	const targetRoot = resolveTarget(target);
	const wikiValidation = validateWiki(targetRoot);
	const staleDocsResult = detectStaleDocs(targetRoot);
	const { detectScaffoldDrift } = require("./scaffold-version-drift");
	const scaffoldDriftResult = detectScaffoldDrift(targetRoot);
	const { detectArtifactDrift } = require("./artifact-drift");
	// F014-M2: full inspection composes the focused evidence outcome (evolution
	// findings + regression proposals) so raw collectors are not duplicated here.
	const { collectEvidence } = require("../maintenance/internal/evidence");
	const evidenceOutcome = collectEvidence(targetRoot);

	// Evolution Slice 2 (trusted-control evolution contract §3/§5): the
	// structured attribution carrier rides the inspection ONLY when the
	// producer has sufficient structured evidence (one distinct significant
	// attributed finding). Field ABSENT = legacy inspection (B1 semantics);
	// field PRESENT = the V1–V3 admission inputs flow to proposeMaintenance.
	const attributionCarrier = evidenceOutcome.evolution.carrier;
	const inspection = {
		target: targetRoot,
		readOnly: true,
		staleDocs: staleDocsResult.staleDocs,
		wikiLint: {
			...buildWikiLintCi(targetRoot),
			errors: wikiValidation.errors,
			warnings: wikiValidation.warnings,
		},
		evolutionRollup: evidenceOutcome.evolution.significant,
		structuredFindings: evidenceOutcome.evolution.structured,
		// Recurrence evidence (trusted-control evolution contract §9, E8; plan
		// Slice 4): the log's occurrence count over its declared window's
		// exposure denominator. Report-only — `recurrenceRate` is null when the
		// denominator is unavailable, and no improvement claim is computed.
		recurrence: evidenceOutcome.evolution.recurrence,
		regressionProposals: evidenceOutcome.regressionProposals,
		evidenceAvailability: evidenceOutcome.availability,
		scaffoldDrift: scaffoldDriftResult,
		artifactDrift: detectArtifactDrift(targetRoot),
		errors: [...(evidenceOutcome.errors || [])],
		warnings: [...(evidenceOutcome.warnings || [])],
	};
	if (attributionCarrier !== null) {
		inspection.findingAttribution = attributionCarrier.findingAttribution;
		if (attributionCarrier.evidenceReferences !== undefined) {
			inspection.evidenceReferences = attributionCarrier.evidenceReferences;
		}
		if (attributionCarrier.expectedEffect !== undefined) {
			inspection.expectedEffect = attributionCarrier.expectedEffect;
		}
		if (attributionCarrier.operations !== undefined) {
			inspection.operations = attributionCarrier.operations;
		}
	}
	return inspection;
}

// buildMaintenanceProposalContent + proposeMaintenance were extracted to
// maintenance-propose.js (architecture review #5). inspectMaintenance is NOT
// moved (shared core seam for governance-report/adoption-reports), so propose
// receives it by injection. proposeMaintenance stays HANDLER-ONLY (not on
// module.exports) — dispatch uses `module.exports.proposeMaintenance ||
// proposeMaintenance` so a test can stub the export and fall back to this
// lexical wrapper, which late-binds inspect via module.exports so the inspect
// stub seam also stays intact.
const {
	buildMaintenanceProposalContent,
	proposeMaintenance: proposeMaintenanceImpl,
} = require("./maintenance-propose");

function proposeMaintenance(target, priority) {
	// Reach inspect through module.exports so a test stub on
	// maintenance.inspectMaintenance is still observed by propose.
	return proposeMaintenanceImpl(target, priority, module.exports.inspectMaintenance);
}

function validateWikiStructure(projectRoot) {
	return validateWiki(projectRoot);
}

function fixWikiMarkers(projectRoot) {
	const { WIKI_CONTEXT_STARTER_FILES } = require("./constants");
	const { hasSectionWithBody } = require("./text-utils");

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

// The maintenance actions this dispatch chokepoint owns. handleMaintenance
// routes its two sibling actions (scaffold-drift, distill) itself; every other
// maintenance action flows through runMaintenanceAction so the per-branch arg
// shaping (thresholdDays/threshold parse, fixMarkers conditional) lives in
// exactly one place.
const MAINTENANCE_ACTIONS = [
	"inspect",
	"propose",
	"stale-docs",
	"wiki-lint",
	"evolution-rollup",
	"regression-proposals",
];

// The full maintenance command surface, for the unknown-action guidance message.
// scaffold-drift and distill stay handler-routed (separate modules) so they are
// NOT in MAINTENANCE_ACTIONS (which the dispatch switch owns), but a user who
// mistypes one of them still deserves to see it in the help list.
const ALL_MAINTENANCE_ACTIONS = [...MAINTENANCE_ACTIONS, "scaffold-drift", "distill"];

function unknownMaintenanceAction() {
	return {
		errors: [`maintenance requires one of: ${ALL_MAINTENANCE_ACTIONS.join(", ")}.`],
		warnings: [],
	};
}

function runMaintenanceAction(action, targetRoot, options = {}) {
	// Accept either the handler's (action, resolvedPath, args) shape or a direct
	// (action, argsObject) call (tests / programmatic use). When targetRoot is an
	// args-like object it carries .target/.registry/.fixMarkers/etc. itself; the
	// third `options` arg is the CLI args when targetRoot is a resolved string.
	const args =
		targetRoot && typeof targetRoot === "object" && !Array.isArray(targetRoot)
			? targetRoot
			: options;
	const resolvedTarget = resolveTarget(typeof targetRoot === "string" ? targetRoot : args.target);

	// "proposal" is a long-standing alias for "propose".
	const normalized = action === "proposal" ? "propose" : action;

	switch (normalized) {
		case "inspect":
			// inspectMaintenance is a shared core interface (governance-report,
			// adoption-reports) and stays exported; reach it through the exports
			// object so tests can stub the delegation seam and observe the args.
			return module.exports.inspectMaintenance(resolvedTarget);
		case "propose": {
			// proposeMaintenance is handler-only (not exported), but tests stub it
			// on the exports object, so prefer the exported binding when present and
			// fall back to the lexical definition otherwise.
			const propose = module.exports.proposeMaintenance || proposeMaintenance;
			return propose(resolvedTarget, args.priority);
		}
		case "stale-docs": {
			const parsed = args.thresholdDays ? Number.parseInt(args.thresholdDays, 10) : undefined;
			const thresholdDays = Number.isInteger(parsed) ? parsed : undefined;
			const stale = detectStaleDocs(resolvedTarget, thresholdDays);
			return {
				target: resolvedTarget,
				staleDocs: stale.staleDocs,
				thresholdDays: stale.thresholdDays,
				errors: [],
				warnings: [],
			};
		}
		case "wiki-lint": {
			let fixResult = null;
			if (args.fixMarkers) fixResult = fixWikiMarkers(resolvedTarget);
			const result = validateWikiStructure(resolvedTarget);
			return fixResult
				? {
						...result,
						fixedMarkers: fixResult.fixed,
						fixedMarkerCount: fixResult.fixedCount,
					}
				: result;
		}
		case "evolution-rollup": {
			const parsed = args.threshold ? Number.parseInt(args.threshold, 10) : undefined;
			const rollup = rollupEvolutionFindings(
				resolvedTarget,
				Number.isInteger(parsed) ? parsed : undefined,
			);
			return {
				target: resolvedTarget,
				findings: rollup.findings,
				threshold: rollup.threshold,
				errors: [],
				warnings: [],
			};
		}
		case "regression-proposals": {
			return {
				target: resolvedTarget,
				proposals: extractRegressionProposals(resolvedTarget),
				errors: [],
				warnings: [],
			};
		}
		default:
			return unknownMaintenanceAction();
	}
}

module.exports = {
	listWikiMarkdownFiles,
	detectStaleDocs,
	buildWikiLintCi,
	countEvolutionFindings,
	extractEvolutionFindings,
	extractRegressionProposals,
	readRegressionProposal,
	inspectMaintenance,
	buildMaintenanceProposalContent,
	runMaintenanceAction,
};
