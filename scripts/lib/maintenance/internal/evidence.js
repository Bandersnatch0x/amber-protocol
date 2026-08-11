"use strict";

// Maintenance evidence collection (F014-M1).
//
// Focused read-only evidence: Amber Evolution findings + Regression Proposals.
// The reader distinguishes three outcomes per executions/*/evidence.json:
//   - a valid proposed regression (retained),
//   - a valid file with no proposed regression (skipped silently — normal),
//   - a corrupt or unreadable file (skipped with a redacted warning; the
//     outcome is marked partial).
//
// Deduplication, deterministic ordering, the 50-proposal bound, and Amber
// Evolution significance semantics match the legacy collectors
// (core/maintenance.js) so valid-record behavior is unchanged.

const fs = require("node:fs");
const path = require("node:path");

const { readJson, relativeSlash, resolveTarget } = require("../../core/fs-utils");
const {
	countEvolutionFindings,
	extractEvolutionFindings,
} = require("../../core/evolution-findings");
const { resolveStateDirForRead } = require("../../state-dir-resolver");

const MAX_REGRESSION_PROPOSALS = 50;

function isUsableProposalData(data) {
	return (
		data &&
		typeof data === "object" &&
		data.regressionProposal &&
		data.regressionProposal.status === "proposed" &&
		typeof data.regressionProposal.assertion === "string" &&
		data.regressionProposal.assertion.length > 0
	);
}

/**
 * Read one evidence file. Returns:
 *   { kind: "proposal", proposal }  — valid proposed regression
 *   { kind: "none" }                — valid object, no proposed regression
 *   { kind: "corrupt", reason }     — unparseable/unreadable/non-object body
 */
function classifyEvidenceFile(evidencePath) {
	let data;
	try {
		data = readJson(evidencePath);
	} catch (error) {
		return { kind: "corrupt", reason: error && error.message ? error.message : "unreadable" };
	}
	// A JSON body that is not an object (null, scalar) is a corrupt evidence
	// file, not a normal record without a proposal.
	if (!data || typeof data !== "object") {
		return { kind: "corrupt", reason: "evidence body is not an object" };
	}
	if (!isUsableProposalData(data)) {
		// Valid object without a proposed regression is a normal evidence record
		// (e.g. command-only evidence) — not corruption.
		return { kind: "none" };
	}
	return {
		kind: "proposal",
		proposal: {
			taskId: data.taskId || path.basename(path.dirname(evidencePath)),
			plan: data.plan || "",
			assertion: data.regressionProposal.assertion,
			traceInput: data.traceReplay ? data.traceReplay.traceInput || "" : "",
			agentConfig: data.traceReplay ? data.traceReplay.agentConfig || "" : "",
			modifiesTests: false,
			approvalRequired: true,
		},
	};
}

/**
 * Collect Regression Proposals from execution evidence files.
 * Mirrors legacy extractRegressionProposals ordering/dedup/bounds exactly,
 * plus a corrupt-record classification for partial reporting.
 */
function collectRegressionEvidence(targetRoot) {
	const executionsRoot = path.join(resolveStateDirForRead(targetRoot), "executions");
	if (!fs.existsSync(executionsRoot)) {
		return { proposals: [], corruptPaths: [] };
	}

	const seen = new Set();
	const proposals = [];
	const corruptPaths = [];
	for (const taskDir of fs.readdirSync(executionsRoot)) {
		const evidencePath = path.join(executionsRoot, taskDir, "evidence.json");
		if (!fs.existsSync(evidencePath)) {
			continue;
		}
		const classified = classifyEvidenceFile(evidencePath);
		if (classified.kind === "corrupt") {
			corruptPaths.push(relativeSlash(targetRoot, evidencePath));
			continue;
		}
		if (classified.kind === "none") {
			continue;
		}
		const proposal = {
			...classified.proposal,
			source: relativeSlash(targetRoot, evidencePath),
		};
		const key = `${proposal.taskId}\n${proposal.assertion}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		proposals.push(proposal);
	}

	return {
		proposals: proposals
			.sort((left, right) => left.taskId.localeCompare(right.taskId))
			.slice(0, MAX_REGRESSION_PROPOSALS),
		corruptPaths,
	};
}

/**
 * Assemble the focused evidence outcome. Pure: filesystem-in, plain-object-out.
 */
function collectEvidence(target) {
	const targetRoot = resolveTarget(target);
	const findings = countEvolutionFindings(targetRoot);
	const significant = extractEvolutionFindings(targetRoot);
	const { proposals, corruptPaths } = collectRegressionEvidence(targetRoot);

	const warnings = corruptPaths.map(
		(filePath) =>
			`Regression evidence unreadable or invalid at ${filePath}; skipped. ` +
			"Valid records retained; repair or remove the file to clear this warning.",
	);

	return {
		target: targetRoot,
		availability: corruptPaths.length > 0 ? "partial" : "complete",
		evolution: { findings, significant },
		regressionProposals: proposals,
		warnings,
		errors: [],
	};
}

module.exports = {
	collectEvidence,
	classifyEvidenceFile,
	collectRegressionEvidence,
};
