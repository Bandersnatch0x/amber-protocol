"use strict";

// ADR-0013: no-progress detector. A pure, artifact-only detector of stalled
// agent work, read from session timeline events + result evidence + the loop
// contract's budget ceiling. Never intercepts live tool calls (ADR-0001) and
// never dispatches anything (ADR-0005). Findings are governance-report risk
// items, not error-catalog codes.
//
// Three signals:
// - repeated tool calls: the same raw target observed at or above a threshold.
//   Dedupe by the raw target verbatim — never a normalized target, because
//   normalization folds digits and would collide `cat log1.txt` with
//   `cat log2.txt`.
// - empty evidence increment: result evidence diff/delta is empty.
// - budget exhausted: cumulative usage from timeline + result evidence exceeds
//   the loop contract's budgetCeiling (or a budget_exceeded event was emitted).

const DEFAULT_REPEAT_THRESHOLD = 3;

// Extract the raw tool-call target from a timeline event. Timeline events
// carry tool invocations as a dedicated tool_call/command_executed type with
// data.command | data.target | data.tool, or as stage_completed /
// verification_failed events whose data.command records the executed command
// (see governance.js isCommandLikeEvent / commandLabelFromEvent). The command
// string is preferred over the tool name for dedup: `cat log1.txt` and
// `cat log2.txt` are different invocations even though both use the Bash tool.
// Returns null when the event carries no tool target. The target is returned
// verbatim — no trimming or normalization.
function toolTargetFromEvent(event) {
	if (!event || typeof event !== "object") return null;
	const data = event.data && typeof event.data === "object" ? event.data : {};
	let target;
	if (event.type === "tool_call" || event.type === "command_executed") {
		target = data.command || data.target || data.tool;
	} else if (event.type === "stage_completed" || event.type === "verification_failed") {
		target = data.command || null;
	} else {
		target = data.command || data.target || data.tool || null;
	}
	return typeof target === "string" && target.length > 0 ? target : null;
}

// Signal 1: repeated tool calls. One finding per raw target observed at or
// above the threshold.
function detectRepeatedToolCalls(timelineEvents, threshold = DEFAULT_REPEAT_THRESHOLD) {
	const counts = new Map();
	for (const event of Array.isArray(timelineEvents) ? timelineEvents : []) {
		const target = toolTargetFromEvent(event);
		if (target === null) continue;
		counts.set(target, (counts.get(target) || 0) + 1);
	}
	const findings = [];
	for (const [target, count] of counts) {
		if (count >= threshold) {
			findings.push({
				id: "no-progress-repeated-tool-call",
				severity: "warning",
				title: `Repeated tool call: ${target}`,
				detail: `Tool target "${target}" was invoked ${count} times (threshold ${threshold}); the session may be looping without making progress.`,
			});
		}
	}
	return findings;
}

// True when a diff/delta value records no change. Tolerant of the plausible
// shapes: null/undefined, "", [], {}, booleans, numbers, and objects carrying
// change counts.
function isDeltaEmpty(delta) {
	if (delta === null || delta === undefined) return true;
	if (typeof delta === "string") return delta.trim().length === 0;
	if (typeof delta === "boolean") return delta === false;
	if (typeof delta === "number") return delta === 0;
	if (Array.isArray(delta)) return delta.length === 0;
	if (typeof delta === "object") {
		if (Object.keys(delta).length === 0) return true;
		if ("changed" in delta) return delta.changed !== true;
		if ("changes" in delta) return (delta.changes ?? 0) === 0;
		if ("count" in delta) return (delta.count ?? 0) === 0;
		if ("added" in delta || "removed" in delta || "modified" in delta) {
			return (delta.added ?? 0) === 0 && (delta.removed ?? 0) === 0 && (delta.modified ?? 0) === 0;
		}
		// Unknown object shape: do not fabricate an emptiness claim.
		return false;
	}
	return false;
}

// First field explicitly named as a diff/delta/changes, even when its value is
// null — a present-but-empty diff is the signal we look for. The `in` check
// distinguishes `{ diff: null }` (present, empty) from `{ evidence: [...] }`
// (no diff field at all).
function firstDeltaField(obj) {
	for (const key of ["diff", "delta", "changes", "evidenceDelta"]) {
		if (key in obj) return obj[key];
	}
	return undefined;
}

// Collect the progress deltas recorded in result evidence. Tolerant of two
// plausible shapes: an array of result entries, or a single result object.
function resultDeltasFrom(resultEvidence) {
	const deltas = [];
	if (Array.isArray(resultEvidence)) {
		for (const entry of resultEvidence) {
			if (entry && typeof entry === "object") {
				const delta = firstDeltaField(entry);
				if (delta !== undefined) deltas.push(delta);
			}
		}
	} else if (resultEvidence && typeof resultEvidence === "object") {
		const delta = firstDeltaField(resultEvidence);
		if (delta !== undefined) deltas.push(delta);
	}
	return deltas;
}

// Signal 2: empty evidence increment. Reported only when result evidence is
// present AND every recognizable diff/delta is empty.
function detectEmptyEvidenceIncrement(resultEvidence) {
	if (resultEvidence === null || resultEvidence === undefined) return [];
	const deltas = resultDeltasFrom(resultEvidence);
	if (deltas.length === 0) return [];
	if (deltas.every(isDeltaEmpty)) {
		return [{
			id: "no-progress-empty-evidence-increment",
			severity: "warning",
			title: "Empty evidence increment",
			detail: "Result evidence records no change (diff/delta is empty); the step produced no new evidence.",
		}];
	}
	return [];
}

// Extract a single usage figure from a timeline event or result entry,
// preferring tokens, then duration. Only one unit is counted per item to
// avoid double-counting across units.
function usageFromItem(item) {
	if (!item || typeof item !== "object") return 0;
	const data = item.data && typeof item.data === "object" ? item.data : item;
	const usage = data.usage && typeof data.usage === "object" ? data.usage : {};
	const value =
		typeof data.tokens === "number"
			? data.tokens
			: typeof usage.totalTokens === "number"
				? usage.totalTokens
				: typeof usage.tokens === "number"
					? usage.tokens
					: typeof data.durationMs === "number"
						? data.durationMs
						: 0;
	return value > 0 ? value : 0;
}

// Read the numeric budgetCeiling from a loop contract. Accepts the top-level
// budgetCeiling field (ADR-0013 vocabulary) or budget.ceiling; anything else
// returns null so budget detection is skipped rather than guessed.
function budgetCeilingFrom(loopContract) {
	if (!loopContract || typeof loopContract !== "object") return null;
	const ceiling = loopContract.budgetCeiling ?? loopContract.budget?.ceiling;
	return typeof ceiling === "number" && Number.isFinite(ceiling) && ceiling > 0 ? ceiling : null;
}

// Signal 3: budget exhaustion. Requires a declared budgetCeiling; skipped
// otherwise. A budget_exceeded timeline event is direct evidence regardless
// of the arithmetic.
function detectBudgetExhausted(timelineEvents, resultEvidence, loopContract) {
	const ceiling = budgetCeilingFrom(loopContract);
	if (ceiling === null) return [];
	const events = Array.isArray(timelineEvents) ? timelineEvents : [];
	const exceededEvent = events.some((event) => event && event.type === "budget_exceeded");
	let usage = 0;
	for (const event of events) {
		usage += usageFromItem(event);
	}
	if (Array.isArray(resultEvidence)) {
		for (const entry of resultEvidence) {
			usage += usageFromItem(entry);
		}
	} else {
		usage += usageFromItem(resultEvidence);
	}
	if (usage > ceiling || exceededEvent) {
		return [{
			id: "no-progress-budget-exhausted",
			severity: "error",
			title: "Budget ceiling exhausted",
			detail: `Observed usage ${usage} exceeds loop-contract budgetCeiling ${ceiling}; the loop should have stopped.`,
		}];
	}
	return [];
}

// Main entry point. No input (or undefined/null fields) returns an empty
// findings array — the detector never fabricates a claim from missing data.
function detectNoProgress({
	timelineEvents = [],
	resultEvidence = null,
	loopContract = null,
	repeatThreshold = DEFAULT_REPEAT_THRESHOLD,
} = {}) {
	return [
		...detectRepeatedToolCalls(timelineEvents, repeatThreshold),
		...detectEmptyEvidenceIncrement(resultEvidence),
		...detectBudgetExhausted(timelineEvents, resultEvidence, loopContract),
	];
}

module.exports = {
	DEFAULT_REPEAT_THRESHOLD,
	detectNoProgress,
	detectRepeatedToolCalls,
	detectEmptyEvidenceIncrement,
	detectBudgetExhausted,
	toolTargetFromEvent,
};
