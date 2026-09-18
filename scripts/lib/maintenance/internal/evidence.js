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
	EVOLUTION_FINDING_MIN_COUNT,
	countEvolutionFindings,
	extractEvolutionFindings,
	extractStructuredFindings,
	parseEvolutionLog,
} = require("../../core/evolution-findings");
const { canonicalHashOf } = require("../../core/registry-ledger");
const { deriveRecurrence } = require("../../core/recurrence");
const { resolveStateDirForRead } = require("../../state-dir-resolver");

const MAX_REGRESSION_PROPOSALS = 50;

// The declared evolution-log window (contract §9): the log is one file, so the
// exposure denominator is that file's own recurrence-bearing observations —
// every `Finding:` line plus every structured `amber-finding` block. It is a
// denominator the reader can actually establish; when the log is absent the
// denominator is unavailable and the report says `unknown` rather than
// inventing one.
function evolutionLogWindow(targetRoot) {
	const parsed = parseEvolutionLog(targetRoot);
	if (parsed === null) {
		return { parsed: null, transcriptsScanned: null, window: "docs/wiki/engineering/harness-evolution.md (absent)" };
	}
	const legacy = parsed.outsideLines.filter((line) => /Finding:\s*(.+?)\s*$/.test(line)).length;
	return {
		parsed,
		transcriptsScanned: legacy + parsed.blocks.length,
		window: "docs/wiki/engineering/harness-evolution.md",
	};
}

// Occurrences over the SAME window the denominator counts (contract §9/E8):
// every legacy `Finding:` line plus every structured block whose JSON yields
// a failure-mode text. The legacy-only counter would undercount — a block is
// a denominator observation, so its occurrence must count too (a
// structured-only log would otherwise read a rate of 0 over a positive
// window). A block that fails to parse, or names no failure mode, remains a
// denominator observation but adds no occurrence — the rate then honestly
// reads below 1 rather than fabricating a count.
function evolutionLogOccurrences(parsed) {
	const counts = new Map();
	for (const line of parsed.outsideLines) {
		const match = line.match(/Finding:\s*(.+?)\s*$/);
		if (match) {
			const text = match[1].trim();
			counts.set(text, (counts.get(text) || 0) + 1);
		}
	}
	for (const block of parsed.blocks) {
		let text = null;
		try {
			const body = JSON.parse(block.body);
			const mode =
				body !== null && typeof body === "object" && !Array.isArray(body)
					? body.findingAttribution?.failureMode
					: null;
			if (typeof mode === "string" && mode.trim() !== "") {
				text = mode.trim();
			}
		} catch {
			// Unparseable block: denominator-only, names no occurrence text.
		}
		if (text !== null) {
			counts.set(text, (counts.get(text) || 0) + 1);
		}
	}
	return [...counts.values()].reduce((total, count) => total + count, 0);
}

// Carrier selection (trusted-control evolution contract §3/§5 stage 2): the
// inspection-level attribution carrier is supplied only when the significant
// structured findings share exactly ONE distinct attribution block. Multiple
// distinct attributions are not collapsed into an invented single claim —
// the structured findings stay visible on the envelope and a warning names
// the ambiguity. Unstructured legacy observations never reach the carrier.
function selectAttributionCarrier(structuredFindings) {
	const significant = structuredFindings.filter((finding) => finding.count >= EVOLUTION_FINDING_MIN_COUNT);
	if (significant.length === 0) {
		return { carrier: null, warning: null };
	}
	const distinct = new Set(significant.map((finding) => canonicalHashOf(finding.findingAttribution)));
	if (distinct.size > 1) {
		return {
			carrier: null,
			warning:
				`Evolution log carries ${distinct.size} distinct attributed recurring findings; ` +
				"no single attribution is invented to collapse them, so this inspection stays unattributed. " +
				"Propose one attributed finding at a time to carry a structured block.",
		};
	}
	const top = significant[0];
	const carrier = {
		findingAttribution: top.findingAttribution,
		evidenceReferences: top.evidenceReferences,
		expectedEffect: top.expectedEffect,
	};
	if (top.operations !== undefined) {
		carrier.operations = top.operations;
	}
	return { carrier, warning: null };
}

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
 *
 * Structured evolution findings (contract §3/§5) ride `evolution.structured`;
 * malformed or secret-bearing blocks are ERRORS (a refusal at the
 * pre-admission boundary — never laundered as legacy), unlike regression
 * record corruption, which stays warning-only. `evolution.carrier` is the
 * single-attribution carrier for the inspection when one exists.
 */
function collectEvidence(target) {
	const targetRoot = resolveTarget(target);
	const findings = countEvolutionFindings(targetRoot);
	const significant = extractEvolutionFindings(targetRoot);
	const structuredOutcome = extractStructuredFindings(targetRoot);
	const { carrier, warning } = selectAttributionCarrier(structuredOutcome.findings);
	const { proposals, corruptPaths } = collectRegressionEvidence(targetRoot);

	// Recurrence evidence (contract §9, E8): the occurrence count over the
	// exposure denominator of the SAME declared window, derived once here so
	// every inspection consumer reads one number. Report-only — no before/after
	// improvement claim is computed; when the denominator is unavailable the
	// derivation reports `unknown` instead of fabricating a rate.
	const logWindow = evolutionLogWindow(targetRoot);
	const recurrence = deriveRecurrence({
		occurrences: logWindow.parsed === null ? 0 : evolutionLogOccurrences(logWindow.parsed),
		transcriptsScanned: logWindow.transcriptsScanned,
		window: logWindow.window,
	});

	const warnings = corruptPaths.map(
		(filePath) =>
			`Regression evidence unreadable or invalid at ${filePath}; skipped. ` +
			"Valid records retained; repair or remove the file to clear this warning.",
	);
	if (warning !== null) {
		warnings.push(warning);
	}

	return {
		target: targetRoot,
		availability: corruptPaths.length > 0 ? "partial" : "complete",
		evolution: {
			findings,
			significant,
			structured: structuredOutcome.findings,
			carrier,
			recurrence,
		},
		regressionProposals: proposals,
		warnings,
		errors: structuredOutcome.problems,
	};
}

module.exports = {
	collectEvidence,
	classifyEvidenceFile,
	collectRegressionEvidence,
};
