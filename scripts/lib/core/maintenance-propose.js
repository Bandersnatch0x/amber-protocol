"use strict";

// Maintenance proposal authoring — extracted from maintenance.js so the
// proposal-rendering + priority-filter logic (buildMaintenanceProposalContent +
// proposeMaintenance) lives behind its own seam. inspectMaintenance is NOT
// moved: it is a shared core interface (governance-report, adoption-reports)
// and stays in maintenance.js. proposeMaintenance receives it by injection to
// avoid a circular require and to keep the inspect stub seam intact.
//
// Evolution Slice 2 (trusted-control evolution contract §5/§6/§8.5): a
// structured carrier (valid findingAttribution + evidenceReferences +
// expectedEffect + optional operations) passes through the shared V1–V3
// admission invariant (evolution-validity.js) before anything is written.
// A validity failure is NOT "write nothing": the owning proposal record is
// written with a durable ## Rejection section (closed reason code, timestamp,
// redacted non-echoing summary, canonical attribution-hash correlation), so
// the file carries its own rejection history; a retry finds prior rejections
// by that correlation and preserves them. Pre-admission refusals (malformed
// or secret-bearing external attribution) still write NOTHING. Proposals are
// propose-only: no target source file is ever changed.

const fs = require("node:fs");
const path = require("node:path");
const { resolveStateDirForCreate, resolveStateDirForRead } = require("../state-dir-resolver");
const { pathExists, relativeSlash } = require("./fs-utils");
const { MESSAGES } = require("./terminology");
const { attributionProblem } = require("./finding-attribution");
const { validateEvolutionAdmission } = require("./evolution-validity");
const { canonicalHashOf, credentialLeakProblem } = require("./registry-ledger");

// Trusted-control evolution contract §3: the structured finding-attribution
// block rides the inspection carrier (supplied by upstream producers).
// Semantics at this boundary:
//   - field ABSENT (no own key)  → legacy inspection, explicitly unattributed;
//   - field present (any value, including explicit null) → must validate;
//     malformed, inherited-only, or null blocks are explicit errors BEFORE any
//     proposal is written — never a silent legacy downgrade;
//   - a failureMode that looks like credential material is refused with a
//     non-leaking reason: the value is neither echoed nor silently redacted
//     into the trusted input (the caller supplies an already-redacted mode).
function attributionOf(inspection) {
	if (!Object.hasOwn(inspection, "findingAttribution")) {
		return { status: "legacy-unattributed", block: null, problem: null };
	}
	const block = inspection.findingAttribution;
	const problem = attributionProblem(block);
	if (problem !== null) {
		return { status: "invalid", block: null, problem };
	}
	const leak = credentialLeakProblem(block.failureMode, "findingAttribution.failureMode");
	if (leak !== null) {
		return { status: "invalid", block: null, problem: leak };
	}
	return { status: "validated", block, problem: null };
}

// Untrusted free text renders as a Markdown blockquote — every line prefixed —
// so multiline failure text can never break out into a new heading/section and
// becomes an instruction only by being visibly quoted data. CommonMark treats
// LF, CRLF, AND a lone CR as line breaks, so all three forms are split and
// every resulting source line is prefixed.
function quoteLines(text) {
	return text
		.split(/\r\n|\r|\n/)
		.map((line) => `  > ${line}`)
		.join("\n");
}

function priorRejectionNoteLines(priorRejections) {
	if (!priorRejections || priorRejections.unknown) {
		return [
			"- Prior rejection history: unknown (one or more proposal records could not be read) — informative only.",
		];
	}
	if (priorRejections.count === 0) {
		return [];
	}
	return [
		`- Prior rejections with this attribution: ${priorRejections.count} (last: ${priorRejections.lastAt || "unknown time"}) — informative history; admission was not blocked.`,
	];
}

function renderAttributionSection(block, priorRejections) {
	return [
		"",
		"## Attribution",
		"",
		`- Entry surface: ${block.entrySurface}`,
		`- Impact surface: ${block.impactSurface}`,
		"- Failure mode:",
		quoteLines(block.failureMode),
		`- Responsible artifact: ${block.responsibleArtifact}`,
		...priorRejectionNoteLines(priorRejections),
		"",
		"Attribution is a claim about where this friction is attributed; it is not a permission and does not select an apply path.",
	];
}

// Evidence references render only on a proposal that PASSED V1: every line is
// blockquoted untrusted-adjacent text (validated bounded paths and receipt
// ids, quoted so they can never become structure).
function renderEvidenceSection(evidenceReferences) {
	if (!Array.isArray(evidenceReferences) || evidenceReferences.length === 0) {
		return [];
	}
	const lines = [
		"",
		"## Evidence",
		"",
		"- Evidence references, resolved at admission (resolution proves the citation points at recorded material, never that it is true):",
	];
	for (const reference of evidenceReferences) {
		if (reference && typeof reference === "object" && reference.kind === "receipt") {
			lines.push(quoteLines(`receipt: ${reference.id}`));
		} else if (reference && typeof reference === "object") {
			lines.push(
				quoteLines(
					typeof reference.line === "number"
						? `${reference.path} (line ${reference.line})`
						: `${reference.path}`,
				),
			);
		}
	}
	return lines;
}

function renderExpectedEffectSection(expectedEffect) {
	if (
		!expectedEffect ||
		typeof expectedEffect !== "object" ||
		Array.isArray(expectedEffect) ||
		typeof expectedEffect.readiness !== "string" ||
		typeof expectedEffect.effectiveness !== "string"
	) {
		return [];
	}
	return [
		"",
		"## Expected Effect",
		"",
		"Dual-axis effect statement (mechanical validation proves presence, never soundness — the human reviewer is the semantic judge):",
		"",
		"- Readiness:",
		quoteLines(expectedEffect.readiness),
		"- Effectiveness:",
		quoteLines(expectedEffect.effectiveness),
	];
}

function renderLegacySections(inspection) {
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
	lines.push(`- Current: ${inspection.upgradeAssistant.currentVersion || "not installed"}`);
	lines.push(`- Latest: ${inspection.upgradeAssistant.latestVersion}`);
	if (inspection.upgradeAssistant.previewCommand) {
		lines.push(`- Preview: \`${inspection.upgradeAssistant.previewCommand}\``);
	}

	lines.push("", "## Rule-Pack Drift", "");
	lines.push(`- Drifted: ${inspection.rulePackDrift.drifted}`);
	lines.push(`- Expected: ${(inspection.rulePackDrift.expected || []).join(", ") || "none"}`);
	lines.push(`- Actual: ${(inspection.rulePackDrift.actual || []).join(", ") || "none"}`);

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
	lines.push("```");
	return lines;
}

function renderAttribution(inspection, options) {
	// Structured attribution: an invalid or secret-bearing block is an explicit
	// renderer error (never a silent omission); a legacy inspection (field
	// absent) keeps its exact historical output — nothing is fabricated.
	const attribution = attributionOf(inspection);
	if (attribution.status === "invalid") {
		throw new Error(`findingAttribution is invalid: ${attribution.problem}`);
	}
	if (attribution.status !== "validated") {
		return [];
	}
	return renderAttributionSection(attribution.block, options && options.priorRejections);
}

function buildMaintenanceProposalContent(inspection, options) {
	const lines = [
		...renderLegacySections(inspection),
		...renderAttribution(inspection, options),
		// V1–V3 inputs render only on a proposal that passed admission — the
		// caller (proposeMaintenance) never reaches here with a failing carrier,
		// and a direct renderer invocation without admission renders the claim
		// (Attribution) but never unadmitted evidence or effect text as such.
		...renderEvidenceSection(inspection.evidenceReferences),
		...renderExpectedEffectSection(inspection.expectedEffect),
		"",
		"No source docs or standards were changed by this proposal.",
		"",
	];

	return lines.join("\n");
}

// The durable rejection record (spec §8.5): the owning proposal file carries
// its own rejection history. The redacted summary is the admission invariant's
// deterministic, non-echoing detail — rejected free text is never reproduced.
function renderRejectionSection(rejection) {
	const priorLine = rejection.priorRejections.unknown
		? "- Prior rejection history: unknown (one or more proposal records could not be read)."
		: rejection.priorRejections.count === 0
			? "- Prior rejections with this correlation: 0."
			: `- Prior rejections with this correlation: ${rejection.priorRejections.count} (first: ${rejection.priorRejections.firstAt || "unknown time"}, last: ${rejection.priorRejections.lastAt || "unknown time"}).`;
	return [
		"",
		"## Rejection",
		"",
		`- Reason code: \`${rejection.code}\``,
		`- Rejected at: ${rejection.rejectedAt}`,
		`- Correlation: \`${rejection.correlation}\``,
		`- Redacted summary: ${rejection.detail} No untrusted proposal text is reproduced in this record.`,
		priorLine,
		"",
		"This record was refused at validity admission and never entered review. Retry with a new proposal; this history is informative and does not block it.",
	];
}

function buildMaintenanceRejectionContent(inspection, rejection) {
	const attribution = attributionOf(inspection);
	if (attribution.status !== "validated") {
		// The rejection path is only reachable with a validated block; a direct
		// call with anything else is a programmer error, surfaced loudly.
		throw new Error(
			`buildMaintenanceRejectionContent requires a validated attribution block (got ${attribution.status})`,
		);
	}
	const lines = [
		...renderLegacySections(inspection),
		...renderAttributionSection(attribution.block, rejection.priorRejections),
		// The rejected claim stays identified, but unadmitted evidence and
		// effect text are never rendered as evidence — only the redacted
		// rejection facts above describe them.
		...renderRejectionSection(rejection),
		"",
		"No source docs or standards were changed by this proposal.",
		"",
	];
	return lines.join("\n");
}

// Deep credential scan over the carrier's other free-text fields: any string
// riding evidenceReferences, expectedEffect, or operations is external input
// that must never reach a record, a render, or an echo.
function carrierLeakProblem(inspection) {
	const scan = (value, label) => {
		if (typeof value === "string") {
			return credentialLeakProblem(value, label);
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				const problem = scan(item, label);
				if (problem !== null) return problem;
			}
			return null;
		}
		if (value !== null && typeof value === "object") {
			for (const key of Object.keys(value)) {
				const problem = scan(value[key], label);
				if (problem !== null) return problem;
			}
			return null;
		}
		return null;
	};
	for (const [field, label] of [
		["evidenceReferences", "evidenceReferences"],
		["expectedEffect", "expectedEffect"],
		["operations", "operations"],
	]) {
		if (!Object.hasOwn(inspection, field)) continue;
		const problem = scan(inspection[field], `${label} carries`);
		if (problem !== null) return problem;
	}
	return null;
}

// Fold the owning record surface for prior rejections of the same attribution
// (spec §8.5: correlation = canonical hash of the §3 block; lookup = the
// proposal files). Read-side degradation is explicit: an unreadable record
// makes the history UNKNOWN, never "no prior rejection" (F055 discipline,
// contract E7).
function scanPriorRejections(targetRoot, correlation) {
	const unknown = { count: null, firstAt: null, lastAt: null, unknown: true };
	const proposalsRoot = path.join(resolveStateDirForRead(targetRoot), "maintenance", "proposals");
	if (!pathExists(proposalsRoot)) {
		return { count: 0, firstAt: null, lastAt: null, unknown: false };
	}
	let names;
	try {
		names = fs
			.readdirSync(proposalsRoot)
			.filter((name) => name.endsWith(".md"))
			.sort();
	} catch {
		return unknown;
	}
	const stamps = [];
	let matches = 0;
	for (const name of names) {
		let content;
		try {
			content = fs.readFileSync(path.join(proposalsRoot, name), "utf8");
		} catch {
			return unknown;
		}
		if (!content.includes("## Rejection")) continue;
		const correlationMatch = content.match(/^- Correlation: `([^`]+)`$/m);
		if (!correlationMatch || correlationMatch[1] !== correlation) continue;
		// A matching record counts even when its timestamp is missing or
		// unparseable — the count is records, the stamps only order them.
		matches += 1;
		const rejectedAt = content.match(/^- Rejected at: (\S+)$/m);
		if (rejectedAt) stamps.push(rejectedAt[1]);
	}
	stamps.sort();
	return {
		count: matches,
		firstAt: stamps[0] ?? null,
		lastAt: stamps[stamps.length - 1] ?? null,
		unknown: false,
	};
}

// A failed record write is an explicit refusal, never a silent success — the
// proposal (and its audit trail) either persists or the call reports errors.
function persistProposalRecord(proposalRoot, proposalPath, content) {
	try {
		fs.mkdirSync(proposalRoot, { recursive: true });
		fs.writeFileSync(proposalPath, content);
		return null;
	} catch (error) {
		const reason = error && error.code ? error.code : "write error";
		return `failed to persist the maintenance proposal record at ${proposalPath}: ${reason}`;
	}
}

// inspectMaintenance is injected (not required) so this module does not depend
// back on maintenance.js. The dispatch caller passes maintenance's exported
// inspect binding, preserving the test stub seam.
function proposeMaintenance(target, registryPath, priority, inspectMaintenance) {
	const inspection = inspectMaintenance(target, registryPath);
	if (inspection.errors.length > 0) {
		return {
			target: inspection.target,
			errors: inspection.errors,
			warnings: inspection.warnings,
		};
	}

	// A supplied attribution block must be valid before anything is written —
	// a malformed, inherited-only, explicit-null, or secret-bearing block never
	// produces a normal (unattributed) proposal file.
	const attribution = attributionOf(inspection);
	if (attribution.status === "invalid") {
		return {
			target: inspection.target,
			errors: [`findingAttribution is invalid: ${attribution.problem}`],
			warnings: inspection.warnings,
		};
	}

	// Same pre-admission boundary for the carrier's other external fields:
	// secret-bearing evidence/effect/operation text refuses with nothing
	// written and nothing echoed (never laundered as legacy).
	const carrierLeak = carrierLeakProblem(inspection);
	if (carrierLeak !== null) {
		return {
			target: inspection.target,
			errors: [carrierLeak],
			warnings: inspection.warnings,
		};
	}

	// Apply priority filter if specified
	let filteredInspection = inspection;
	if (priority) {
		// Validate the requested priority up front. An unrecognized value used to
		// fall through every branch, leaving allowedCategories empty so each
		// section was zeroed and a blank proposal was written with no error — a
		// silent failure. Fail fast with a clear message instead.
		if (!["high", "medium", "low"].includes(priority)) {
			return {
				target: inspection.target,
				errors: [`Unknown priority "${priority}". Use high, medium, or low.`],
				warnings: inspection.warnings,
			};
		}

		const priorityLevels = {
			high: ["staleDocs", "rulePackDrift"],
			medium: ["upgradeAssistant", "evolutionRollup"],
			low: ["regressionProposals"],
		};

		const allowedCategories = [];
		if (priority === "high") {
			allowedCategories.push(...priorityLevels.high);
		} else if (priority === "medium") {
			allowedCategories.push(...priorityLevels.high, ...priorityLevels.medium);
		} else if (priority === "low") {
			allowedCategories.push(
				...priorityLevels.high,
				...priorityLevels.medium,
				...priorityLevels.low,
			);
		}

		filteredInspection = { ...inspection };
		if (!allowedCategories.includes("staleDocs")) filteredInspection.staleDocs = [];
		if (!allowedCategories.includes("rulePackDrift"))
			filteredInspection.rulePackDrift = { drifted: false, expected: [], actual: [] };
		if (!allowedCategories.includes("upgradeAssistant"))
			filteredInspection.upgradeAssistant = { currentVersion: null, latestVersion: null };
		if (!allowedCategories.includes("evolutionRollup")) filteredInspection.evolutionRollup = [];
		if (!allowedCategories.includes("regressionProposals"))
			filteredInspection.regressionProposals = [];
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
	const relativeProposalPath = relativeSlash(filteredInspection.target, proposalPath);
	const refusal = (message) => ({
		target: filteredInspection.target,
		errors: [message],
		warnings: filteredInspection.warnings,
	});

	// Structured carriers pass the shared V1–V3 admission invariant
	// (evolution-validity.js) before anything is written. A failure writes the
	// durable ## Rejection record; a pass writes the normal proposal with its
	// Evidence and Expected Effect sections. Legacy inspections skip admission
	// entirely — unstructured observations stay legacy (never promoted).
	if (attribution.status === "validated") {
		const validity = validateEvolutionAdmission({
			targetRoot: inspection.target,
			evidenceReferences: filteredInspection.evidenceReferences,
			operations: filteredInspection.operations,
			expectedEffect: filteredInspection.expectedEffect,
		});
		const correlation = canonicalHashOf(attribution.block);
		const priorRejections = scanPriorRejections(inspection.target, correlation);

		if (!validity.ok) {
			const rejectedAt = new Date().toISOString();
			const writeError = persistProposalRecord(
				proposalRoot,
				proposalPath,
				buildMaintenanceRejectionContent(filteredInspection, {
					code: validity.code,
					detail: validity.detail,
					correlation,
					rejectedAt,
					priorRejections,
				}),
			);
			if (writeError !== null) {
				return refusal(writeError);
			}
			return {
				target: filteredInspection.target,
				proposalPath: relativeProposalPath,
				reviewable: false,
				sourceFilesChanged: false,
				inspection: filteredInspection,
				priority: priority || "all",
				// Structured attribution (evolution contract §3): the validated block, or
				// an explicit legacy marker — never a fabricated attribution.
				findingAttribution: attribution.block,
				attributionStatus: attribution.status,
				attributionCorrelation: correlation,
				validity: { ok: false, code: validity.code, detail: validity.detail },
				rejection: { code: validity.code, correlation, rejectedAt },
				priorRejections,
				errors: [],
				warnings: filteredInspection.warnings,
			};
		}

		const writeError = persistProposalRecord(
			proposalRoot,
			proposalPath,
			buildMaintenanceProposalContent(filteredInspection, { priorRejections }),
		);
		if (writeError !== null) {
			return refusal(writeError);
		}
		return {
			target: filteredInspection.target,
			proposalPath: relativeProposalPath,
			reviewable: true,
			sourceFilesChanged: false,
			inspection: filteredInspection,
			priority: priority || "all",
			findingAttribution: attribution.block,
			attributionStatus: attribution.status,
			attributionCorrelation: correlation,
			validity: { ok: true },
			priorRejections,
			errors: [],
			warnings: filteredInspection.warnings,
		};
	}

	const writeError = persistProposalRecord(
		proposalRoot,
		proposalPath,
		buildMaintenanceProposalContent(filteredInspection),
	);
	if (writeError !== null) {
		return refusal(writeError);
	}

	return {
		target: filteredInspection.target,
		proposalPath: relativeProposalPath,
		reviewable: true,
		sourceFilesChanged: false,
		inspection: filteredInspection,
		priority: priority || "all",
		// Structured attribution (evolution contract §3): the validated block, or
		// an explicit legacy marker — never a fabricated attribution.
		findingAttribution: attribution.block,
		attributionStatus: attribution.status,
		validity: null,
		errors: [],
		warnings: filteredInspection.warnings,
	};
}

module.exports = {
	buildMaintenanceProposalContent,
	buildMaintenanceRejectionContent,
	proposeMaintenance,
};
