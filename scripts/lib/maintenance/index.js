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

/**
 * Focused read-only Maintenance evidence: Amber Evolution findings and
 * Regression Proposals, with an explicit completeness state.
 *
 * Does not load or require Team Distribution registry state. Absent optional
 * evidence sources produce a complete empty result. Corrupt or unreadable
 * individual records are skipped, retained valid records are preserved, the
 * outcome is marked partial, and redacted warnings are emitted. Partial
 * evidence is warning-only and never becomes an error.
 *
 * @param {string} target
 * @returns {{
 *   target: string,
 *   availability: "complete"|"partial",
 *   evolution: { findings: object[], significant: object[] },
 *   regressionProposals: object[],
 *   warnings: string[],
 *   errors: string[],
 * }}
 */
function evidence(target) {
	return collectEvidence(target);
}

module.exports = {
	evidence,
};
