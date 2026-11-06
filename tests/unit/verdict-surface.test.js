"use strict";

/**
 * ADR-0106: a verdict surface must declare where "did not run" is recorded.
 *
 * The factory's job is the obligation to choose, not a shared vocabulary. These
 * tests pin the three placements against the three shapes the codebase already
 * uses, and pin every definition-time refusal that makes the declaration
 * load-bearing rather than decorative.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
	defineVerdictSurface,
	NOT_RUN_PLACEMENTS,
	NOT_RUN_WORDS,
} = require("../../scripts/lib/core/verdict-surface");

test("the closed placement set is refusal, assurance, status", () => {
	assert.deepEqual([...NOT_RUN_PLACEMENTS], ["refusal", "assurance", "status"]);
});

test("a refusal surface keeps its recorded vocabulary and records no not-run value", () => {
	// Gate: a refused run appends nothing, so the vocabulary stays two-valued.
	const gate = defineVerdictSurface({
		name: "gate outcome",
		notRun: "refusal",
		outcomes: ["pass", "fail"],
	});
	assert.deepEqual([...gate.outcomes], ["pass", "fail"]);
	assert.equal(gate.notRunValue, null);
	assert.equal(gate.assurance, null);

	// Policy records `deny` rather than `fail` (CONTEXT.md) — unchanged.
	const policy = defineVerdictSurface({
		name: "policy outcome",
		notRun: "refusal",
		outcomes: ["pass", "deny"],
	});
	assert.deepEqual([...policy.outcomes], ["pass", "deny"]);
});

test("a status surface projects its not-run value into the vocabulary", () => {
	const check = defineVerdictSurface({
		name: "harness check",
		notRun: "status",
		outcomes: ["pass", "fail"],
		notRunValue: "not-run",
	});
	assert.deepEqual([...check.outcomes], ["pass", "fail", "not-run"]);
	assert.equal(check.notRunValue, "not-run");
});

test("an assurance surface keeps status two-valued and puts the absence on its axis", () => {
	const evidence = defineVerdictSurface({
		name: "evidence receipt",
		notRun: "assurance",
		outcomes: ["pass", "fail"],
		notRunValue: "unavailable",
		assurance: ["unavailable", "observed", "replayable"],
	});
	assert.deepEqual([...evidence.outcomes], ["pass", "fail"]);
	assert.deepEqual([...evidence.assurance], ["unavailable", "observed", "replayable"]);
	assert.equal(evidence.notRunValue, "unavailable");
});

test("the declaration is frozen so a caller cannot re-shape a surface", () => {
	const surface = defineVerdictSurface({
		name: "harness check",
		notRun: "status",
		outcomes: ["pass", "fail"],
		notRunValue: "not-run",
	});
	assert.ok(Object.isFrozen(surface));
	assert.ok(Object.isFrozen(surface.outcomes));
});

test("a surface that declares no placement is refused at definition time", () => {
	assert.throws(
		() => defineVerdictSurface({ name: "sloppy surface", outcomes: ["pass", "fail"] }),
		/a surface that declares none is a defect, not a default/,
	);
	assert.throws(
		() => defineVerdictSurface({ name: "sloppy surface", notRun: "sometimes", outcomes: ["pass"] }),
		/must declare notRun as one of refusal, assurance, status/,
	);
});

test("a refusal surface cannot smuggle a not-run value into its vocabulary", () => {
	assert.throws(
		() =>
			defineVerdictSurface({
				name: "gate outcome",
				notRun: "refusal",
				outcomes: ["pass", "fail", "not-run"],
			}),
		/declares refusal but records "not-run" as an outcome/,
	);
	assert.throws(
		() =>
			defineVerdictSurface({
				name: "gate outcome",
				notRun: "refusal",
				outcomes: ["pass", "fail"],
				notRunValue: "not-run",
			}),
		/places "did not run" at refusal, so it records no not-run value/,
	);
});

test("an assurance surface must name an axis value that means did-not-run", () => {
	assert.throws(
		() =>
			defineVerdictSurface({
				name: "evidence receipt",
				notRun: "assurance",
				outcomes: ["pass", "fail"],
				notRunValue: "unavailable",
			}),
		/must name the axis/,
	);
	assert.throws(
		() =>
			defineVerdictSurface({
				name: "evidence receipt",
				notRun: "assurance",
				outcomes: ["pass", "fail"],
				notRunValue: "not-run",
				assurance: ["unavailable", "observed"],
			}),
		/must name which assurance value means "did not run"/,
	);
	assert.throws(
		() =>
			defineVerdictSurface({
				name: "evidence receipt",
				notRun: "assurance",
				outcomes: ["pass", "unavailable"],
				notRunValue: "unavailable",
				assurance: ["unavailable", "observed"],
			}),
		/carries "unavailable" in both its outcome vocabulary and its assurance axis/,
	);
});

test("a status surface must name a not-run value that is not already an outcome", () => {
	assert.throws(
		() =>
			defineVerdictSurface({ name: "harness check", notRun: "status", outcomes: ["pass", "fail"] }),
		/must name its not-run value/,
	);
	assert.throws(
		() =>
			defineVerdictSurface({
				name: "harness check",
				notRun: "status",
				outcomes: ["pass", "not-run"],
				notRunValue: "not-run",
			}),
		/already lists "not-run" among its outcomes/,
	);
});

test("the vocabulary itself must be a closed, non-empty set of unique strings", () => {
	assert.throws(
		() => defineVerdictSurface({ name: "x", notRun: "refusal", outcomes: [] }),
		/outcomes must be a non-empty array/,
	);
	assert.throws(
		() => defineVerdictSurface({ name: "x", notRun: "refusal", outcomes: ["pass", "pass"] }),
		/outcomes must not repeat "pass"/,
	);
	assert.throws(
		() => defineVerdictSurface({ name: "x", notRun: "refusal", outcomes: ["pass", ""] }),
		/outcomes must contain non-empty strings/,
	);
	assert.throws(
		() => defineVerdictSurface({ name: "", notRun: "refusal", outcomes: ["pass"] }),
		/name must be a non-empty string/,
	);
});

test("the not-run word list is the closed set the seam guard scans for", () => {
	// Narrow on purpose: `unknown` and `unavailable` also appear in lifecycle
	// vocabularies (external DECLARED_STATUSES, retention SETTLEMENT_STATUSES,
	// adapter READ_STATUSES), which ADR-0106 defers.
	assert.deepEqual([...NOT_RUN_WORDS].sort(), [
		"incomparable",
		"not-evaluated",
		"not-run",
		"unevaluated",
		"unscanned",
	]);
});
