"use strict";

// ADR-0106 — a verdict surface must declare where "did not run" is recorded.
//
// Four incidents (`688e9df0`, `cb7bb8a1`, `88632c52`, `issues/357`) shared one
// root cause: a surface answered "did this pass?" with a two-valued vocabulary
// and never said what happens when the check never ran, so an absent result
// read as a pass. Each was repaired in place; nothing established the rule, so
// each new surface re-derived it.
//
// The codebase already answers the question three different ways and all three
// are correct for the surface that uses them:
//
//   refusal   — no record exists; the surface refuses before producing a
//               verdict (Gate, Policy). A recorded "we did not evaluate" cannot
//               exist for a revision-bound Decision.
//   assurance — `status` stays two-valued and a separate axis carries the
//               absence (Evidence). "The check failed" and "the observation is
//               unavailable" are two axes, not three values.
//   status    — a third value in the same vocabulary (harness checks, security
//               audit). Neither a refusal path nor an assurance axis exists.
//
// This module makes the choice a declaration instead of a convention. It does
// NOT unify the recorded vocabularies: Gate stays `pass|fail`, Policy stays
// `pass|deny` (CONTEXT.md), Evidence stays two-valued, and no ledger or schema
// version moves (ADR-0012). The vocabulary is a projection of the declaration,
// the same way `COMMAND_TIERS` is a projection of `COMMAND_RECORDS`
// (ADR-0016 decision 2).
//
// The factory's leverage is the definition-time refusal, not a runtime helper:
// a surface cannot declare one placement and record another. What it buys is
// that the next surface cannot skip the question the way all four incidents
// did.

const NOT_RUN_PLACEMENTS = Object.freeze(["refusal", "assurance", "status"]);

// The words that can only mean "the check did not run". Deliberately narrow:
// `unknown` and `unavailable` are also used by lifecycle vocabularies
// (`external DECLARED_STATUSES`, `retention SETTLEMENT_STATUSES`, `adapter
// READ_STATUSES`), which ADR-0106 decision 5 leaves out of scope. The seam
// guard scans for exactly this list.
//
// ponytail: closed list. A surface that invents a sixth not-run word still has
// to declare it here, so the guard keeps working; it just does not know the
// word until then.
const NOT_RUN_WORDS = Object.freeze([
	"incomparable",
	"not-evaluated",
	"not-run",
	"unevaluated",
	"unscanned",
]);

function refuse(message) {
	return new Error(`defineVerdictSurface: ${message}`);
}

function quotedList(values) {
	return values.map((value) => JSON.stringify(value)).join(", ");
}

function vocabularyProblem(outcomes) {
	if (!Array.isArray(outcomes) || outcomes.length === 0) {
		return "outcomes must be a non-empty array";
	}
	const seen = new Set();
	for (const value of outcomes) {
		if (typeof value !== "string" || value === "") {
			return `outcomes must contain non-empty strings; got ${JSON.stringify(value)}`;
		}
		if (seen.has(value)) return `outcomes must not repeat ${JSON.stringify(value)}`;
		seen.add(value);
	}
	return null;
}

function refusalPlacementProblem(name, outcomes, notRunValue) {
	if (notRunValue !== null) {
		return `${name} places "did not run" at refusal, so it records no not-run value; got ${JSON.stringify(notRunValue)}`;
	}
	const smuggled = outcomes.filter((value) => NOT_RUN_WORDS.includes(value));
	if (smuggled.length > 0) {
		return `${name} declares refusal but records ${quotedList(smuggled)} as an outcome — a refused run leaves no record`;
	}
	return null;
}

function assurancePlacementProblem(name, outcomes, notRunValue, assurance) {
	if (!Array.isArray(assurance) || assurance.length === 0) {
		return `${name} declares assurance placement and must name the axis`;
	}
	if (typeof notRunValue !== "string" || !assurance.includes(notRunValue)) {
		return `${name} must name which assurance value means "did not run"; got ${JSON.stringify(notRunValue)}`;
	}
	if (outcomes.includes(notRunValue)) {
		return `${name} carries ${JSON.stringify(notRunValue)} in both its outcome vocabulary and its assurance axis`;
	}
	return null;
}

function statusPlacementProblem(name, outcomes, notRunValue) {
	if (typeof notRunValue !== "string" || notRunValue === "") {
		return `${name} declares status placement and must name its not-run value`;
	}
	if (outcomes.includes(notRunValue)) {
		return `${name} already lists ${JSON.stringify(notRunValue)} among its outcomes; pass only the ran-outcomes`;
	}
	return null;
}

/**
 * Declare a verdict surface: what it records when the check ran, and where
 * "did not run" is recorded when it did not.
 *
 * @param {{
 *   name: string,
 *   notRun: "refusal" | "assurance" | "status",
 *   outcomes: string[],
 *   notRunValue?: string | null,
 *   assurance?: string[] | null,
 * }} declaration
 * @returns {{name: string, notRun: string, notRunValue: string|null,
 *            outcomes: readonly string[], assurance: readonly string[]|null}}
 */
function defineVerdictSurface({
	name,
	notRun,
	outcomes,
	notRunValue = null,
	assurance = null,
} = {}) {
	if (typeof name !== "string" || name === "") {
		throw refuse("name must be a non-empty string");
	}
	if (!NOT_RUN_PLACEMENTS.includes(notRun)) {
		throw refuse(
			`${name} must declare notRun as one of ${NOT_RUN_PLACEMENTS.join(", ")}; got ${JSON.stringify(notRun)} — a surface that declares none is a defect, not a default`,
		);
	}
	const vocabulary = vocabularyProblem(outcomes);
	if (vocabulary !== null) throw refuse(`${name}: ${vocabulary}`);

	const problem =
		notRun === "refusal"
			? refusalPlacementProblem(name, outcomes, notRunValue)
			: notRun === "assurance"
				? assurancePlacementProblem(name, outcomes, notRunValue, assurance)
				: statusPlacementProblem(name, outcomes, notRunValue);
	if (problem !== null) throw refuse(problem);

	// `status` placement projects the not-run value into the vocabulary; the
	// other two leave it where it already lives.
	const recorded = notRun === "status" ? [...outcomes, notRunValue] : [...outcomes];

	return Object.freeze({
		name,
		notRun,
		notRunValue: notRunValue === null ? null : notRunValue,
		outcomes: Object.freeze(recorded),
		assurance: notRun === "assurance" ? Object.freeze([...assurance]) : null,
	});
}

module.exports = {
	defineVerdictSurface,
	NOT_RUN_PLACEMENTS,
	NOT_RUN_WORDS,
};
