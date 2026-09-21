"use strict";

// Maintenance root facade (F014).
//
// Exposes stable read-only outcomes for production consumers. M1 introduces
// the focused evidence outcome; the full inspection outcome and Governance
// Console command adapter land in later slices. Raw collectors, Team
// Distribution mechanics, and drift checks stay internal to this module.
//
// Workflow Effectiveness consumes evidence only, so evidence collection must
// NOT depend on Team Distribution registry availability.

const { collectEvidence } = require("./internal/evidence");
const { inspectMaintenance, detectStaleDocs } = require("../core/maintenance");
const { resolveTarget } = require("../core/fs-utils");

/**
 * Focused read-only Maintenance evidence: Amber Evolution findings and
 * Regression Proposals, with an explicit completeness state.
 *
 * Does not load or require Team Distribution registry state. Absent optional
 * evidence sources produce a complete empty result. Corrupt or unreadable
 * REGRESSION records are skipped, retained valid records are preserved, the
 * outcome is marked partial, and redacted warnings are emitted — regression
 * partiality is warning-only. Structured `amber-finding` blocks are a different
 * class: a malformed or secret-bearing block is an ERROR (a refusal at the
 * pre-admission boundary, trusted-control evolution contract §5), never
 * laundered as legacy findings.
 *
 * Recurrence evidence (contract §9, E8) rides `evolution.recurrence`: the
 * log's occurrence count over its declared window's exposure denominator.
 * Report-only — the rate is `unknown` when the denominator is zero or
 * unavailable, and no before/after improvement claim is computed.
 *
 * @param {string} target
 * @returns {{
 *   target: string,
 *   availability: "complete"|"partial",
 *   evolution: {
 *     findings: object[],
 *     significant: object[],
 *     structured: object[],
 *     carrier: object | null,
 *     recurrence: {
 *       occurrences: number,
 *       transcriptsScanned: number | null,
 *       recurrenceRate: number | null,
 *       denominator: "measured" | "unknown",
 *       window: string,
 *     },
 *   },
 *   regressionProposals: object[],
 *   warnings: string[],
 *   errors: string[],
 * }}
 */
function evidence(target) {
	return collectEvidence(target);
}

/**
 * Complete Maintenance inspection: stale Wiki, Wiki lint, Team Distribution
 * guidance, Rule Pack drift, scaffold drift, artifact drift, Amber Evolution,
 * Regression Proposals, and redacted partial-evidence warnings.
 *
 * Full inspection composes the focused evidence outcome (F014-M2), so
 * consumers reading both get one consistent evidence truth.
 *
 * @param {string} target
 * @param {string} [registryPath]
 * @returns {object} structured inspection outcome
 */
function inspect(target, registryPath) {
	return inspectMaintenance(target, registryPath);
}

/**
 * Stale Wiki document detection: files whose Last Reviewed marker is missing
 * or older than the threshold. Exposed as a narrow facade use case so
 * consumers do not import raw Maintenance helpers directly (F014-M4).
 *
 * @param {string} target
 * @param {number} [thresholdDays]
 * @returns {{ staleDocs: object[], thresholdDays: number }}
 */
function staleDocs(target, thresholdDays) {
	return detectStaleDocs(resolveTarget(target), thresholdDays);
}

module.exports = {
	evidence,
	inspect,
	staleDocs,
};
