"use strict";

// Behavior-surface deriver units (trusted-control evolution contract §5/§7;
// plan Slice 5). Cover: per-destination determinism (same findings → same
// drafts), draft-only (the deriver never mutates a target), admission
// refusals (closed reason codes, non-echoing summaries, correlation fields),
// the matching-attribution/cluster filter, and the visible blocked rules
// dependency plus the named §8.5 rejection-record open dependencies.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	DERIVER_DESTINATIONS,
	DRAFT_KINDS,
	RULES_DERIVER_BLOCK,
	REJECTION_RECORD_FIELDS,
	REJECTION_RECORD_DEPENDENCIES,
	attributionFingerprintOf,
	deriveEvolutionDrafts,
} = require("../../scripts/lib/core/evolution-derivers");
const { EVOLUTION_FINDING_MIN_COUNT } = require("../../scripts/lib/core/evolution-findings");

function makeTarget(label) {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), `evo-deriver-${label}-`));
	const evidenceFile = path.join(target, "docs", "wiki", "runbook.md");
	fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
	fs.writeFileSync(evidenceFile, "# Runbook\nline two\n");
	return target;
}

function finding(overrides = {}) {
	return {
		finding: "route gate skips evidence check",
		count: 3,
		findingAttribution: {
			entrySurface: "tool-output",
			impactSurface: "governance-state",
			failureMode: "route gate skips evidence check",
			responsibleArtifact: "route",
		},
		evidenceReferences: [{ kind: "path", path: "docs/wiki/runbook.md" }],
		expectedEffect: {
			readiness: "the gate checklist names the evidence step",
			effectiveness: "routes run with the evidence gate verified",
		},
		...overrides,
	};
}

// ── rules: v2 rule skeletons (unblocked by governance G-5) ──

test("the rules deriver emits a require_approval v2 rule skeleton the owner completes", () => {
	const target = makeTarget("rules-unblocked");
	const rulesFinding = {
		...finding(),
		finding: "rules surface lacks a classification ceiling",
		findingAttribution: {
			entrySurface: "tool-output",
			impactSurface: "governance-state",
			failureMode: "rules surface lacks a classification ceiling",
			responsibleArtifact: "rules",
		},
	};
	const outcome = deriveEvolutionDrafts("rules", [rulesFinding], { targetRoot: target });
	assert.equal(outcome.blocked, null);
	assert.equal(outcome.drafts.length, 1);
	const draft = outcome.drafts[0];
	assert.equal(draft.kind, "rules-v2-rule-draft");
	assert.equal(draft.draft.decision, "require_approval", "a draft never auto-allows");
	assert.equal(draft.draft.schemaVersion, 2);
	assert.ok(draft.draft.ruleId.length > 0);
	assert.deepEqual(draft.draft.ownerCompletes, [
		"match.capability",
		"match.target.pathPrefix",
		"match.effect",
		"match.constraints",
	]);
	// Deterministic: the same finding derives the identical skeleton.
	const again = deriveEvolutionDrafts("rules", [rulesFinding], { targetRoot: target });
	assert.deepEqual(again.drafts, outcome.drafts);
});

test("rules is listed as a destination while its rejection-record shape stays 0051-gated", () => {
	assert.ok(DERIVER_DESTINATIONS.includes("rules"));
	assert.equal(REJECTION_RECORD_DEPENDENCIES.rules.hasRecordPath, false);
	assert.ok(REJECTION_RECORD_DEPENDENCIES.rules.missing.includes("0051"));
});

// ── filtering: cluster ≥ N + matching responsibleArtifact ──

test("only findings with cluster >= N and the matching responsibleArtifact are derived", () => {
	const target = makeTarget("filter");
	const findings = [
		finding(), // route, count 3 → drafted
		finding({ count: 1 }), // route, below the default threshold
		finding({
			findingAttribution: {
				entrySurface: "tool-output",
				impactSurface: "governance-state",
				failureMode: "route gate skips evidence check",
				responsibleArtifact: "loop-contract",
			},
		}), // wrong artifact for the route deriver
	];
	const outcome = deriveEvolutionDrafts("route", findings, { targetRoot: target });
	assert.equal(outcome.drafts.length, 1);
	assert.equal(outcome.refusals.length, 0);
});

test("the cluster threshold defaults to the shared evolution finding minimum", () => {
	const target = makeTarget("threshold");
	const outcome = deriveEvolutionDrafts(
		"route",
		[finding({ count: EVOLUTION_FINDING_MIN_COUNT })],
		{ targetRoot: target },
	);
	assert.equal(outcome.drafts.length, 1);
});

// ── determinism: same findings → same drafts ──

test("derivation is deterministic for the same findings, independent of input order", () => {
	const target = makeTarget("determinism");
	const first = finding();
	const second = finding({
		finding: "loop budget exhausts early",
		count: 2,
		findingAttribution: {
			entrySurface: "tool-output",
			impactSurface: "governance-state",
			failureMode: "loop budget exhausts early",
			responsibleArtifact: "loop-contract",
		},
		expectedEffect: {
			readiness: "the contract declares its budget floor",
			effectiveness: "loops stop before the budget is exhausted",
		},
	});
	const routeOutcomeA = deriveEvolutionDrafts("route", [first, second], { targetRoot: target });
	const routeOutcomeB = deriveEvolutionDrafts("route", [second, first], { targetRoot: target });
	assert.deepEqual(routeOutcomeA.drafts, routeOutcomeB.drafts);
	assert.deepEqual(routeOutcomeA.refusals, routeOutcomeB.refusals);
	assert.deepEqual(routeOutcomeA.drafts, routeOutcomeA.drafts);
});

// ── draft-only: the deriver never mutates a target ──

test("derivation is draft-only: the target gains no file and no artifact changes", () => {
	const target = makeTarget("draft-only");
	fs.mkdirSync(path.join(target, "routes"), { recursive: true });
	fs.writeFileSync(
		path.join(target, "routes", "feature-standard.route.json"),
		'{"routeId":"feature-standard","schemaVersion":"1.0.0","stages":[]}',
	);
	const before = fs.readdirSync(target, { recursive: true, withFileTypes: false }).sort();

	const outcome = deriveEvolutionDrafts("route", [finding()], { targetRoot: target });
	assert.equal(outcome.drafts.length, 1);

	const after = fs.readdirSync(target, { recursive: true, withFileTypes: false }).sort();
	assert.deepEqual(after, before);
});

// ── admission refusals: closed codes, correlation fields, non-echoing ──

test("an unresolvable evidence reference refuses the draft with validity:no-evidence", () => {
	const target = makeTarget("no-evidence");
	const outcome = deriveEvolutionDrafts(
		"route",
		[
			finding({
				evidenceReferences: [{ kind: "path", path: "docs/wiki/invented.md" }],
			}),
		],
		{ targetRoot: target },
	);
	assert.deepEqual(outcome.drafts, []);
	assert.equal(outcome.refusals.length, 1);
	assert.equal(outcome.refusals[0].reasonCode, "validity:no-evidence");
	assert.equal(
		outcome.refusals[0].attributionFingerprint,
		attributionFingerprintOf(
			finding({ evidenceReferences: [{ kind: "path", path: "docs/wiki/invented.md" }] }),
		),
	);
	assert.equal(Object.hasOwn(outcome.refusals[0], "summary"), true);
});

test("a capability-reducing operation refuses the draft with validity:capability-reduction and never echoes the path", () => {
	const target = makeTarget("capability-reduction");
	const reducing = finding({
		findingAttribution: {
			entrySurface: "tool-output",
			impactSurface: "governance-state",
			failureMode: "route gate skips evidence check",
			responsibleArtifact: "capability-registry",
		},
		operations: [{ verb: "remove", path: ".amber/runner/registry.jsonl" }],
	});
	const outcome = deriveEvolutionDrafts("capability-registry", [reducing], { targetRoot: target });
	assert.deepEqual(outcome.drafts, []);
	assert.equal(outcome.refusals.length, 1);
	assert.equal(outcome.refusals[0].reasonCode, "validity:capability-reduction");
	assert.ok(!outcome.refusals[0].summary.includes("registry.jsonl"));
});

test("an eval-only effect statement refuses the draft with validity:eval-only-claim", () => {
	const target = makeTarget("eval-only");
	const outcome = deriveEvolutionDrafts(
		"route",
		[
			finding({
				expectedEffect: {
					readiness: "eval run report shows green",
					effectiveness: "see eval results above",
				},
			}),
		],
		{ targetRoot: target },
	);
	assert.deepEqual(outcome.drafts, []);
	assert.equal(outcome.refusals.length, 1);
	assert.equal(outcome.refusals[0].reasonCode, "validity:eval-only-claim");
});

test("refusal entries carry exactly the in-memory correlation set — no fabricated timestamp or record", () => {
	const target = makeTarget("refusal-shape");
	const outcome = deriveEvolutionDrafts("route", [finding({ evidenceReferences: [] })], {
		targetRoot: target,
	});
	assert.equal(outcome.refusals.length, 1);
	assert.deepEqual(Object.keys(outcome.refusals[0]).sort(), [
		"attributionFingerprint",
		"clusterCount",
		"reasonCode",
		"summary",
	]);
});

// ── destination draft shapes ──

test("the capability-registry draft is an additive F052 registration request skeleton", () => {
	const target = makeTarget("capability-draft");
	const attributed = finding({
		findingAttribution: {
			entrySurface: "tool-output",
			impactSurface: "governance-state",
			failureMode: "route gate skips evidence check",
			responsibleArtifact: "capability-registry",
		},
	});
	const outcome = deriveEvolutionDrafts("capability-registry", [attributed], {
		targetRoot: target,
	});
	assert.equal(outcome.drafts.length, 1);
	const draft = outcome.drafts[0];
	assert.equal(draft.kind, "registration-request-draft");
	assert.equal(draft.draft.runner.decision, null);
	assert.equal(draft.draft.capability.decision, null);
	assert.deepEqual(draft.draft.capability.effects, []);
	assert.equal(draft.draft.capability.name, null);
	assert.equal(draft.attributionFingerprint, attributionFingerprintOf(attributed));
});

test("the route draft is a schema-shaped route-definition skeleton with a deterministic id", () => {
	const target = makeTarget("route-draft");
	const outcome = deriveEvolutionDrafts("route", [finding()], { targetRoot: target });
	const draft = outcome.drafts[0];
	assert.equal(draft.kind, DRAFT_KINDS.route);
	assert.match(draft.draft.routeId, /^[a-z0-9-]+$/);
	assert.equal(draft.draft.schemaVersion, "1.0.0");
	assert.deepEqual(draft.draft.stages, []);
	assert.deepEqual(draft.draft.gates, []);
	// Deriving the skeleton twice yields the identical route id.
	const again = deriveEvolutionDrafts("route", [finding()], { targetRoot: target });
	assert.equal(draft.draft.routeId, again.drafts[0].draft.routeId);
});

test("the loop-contract draft is manual, disabled, and never schedules", () => {
	const target = makeTarget("loop-draft");
	const attributed = finding({
		finding: "loop budget exhausts early",
		findingAttribution: {
			entrySurface: "tool-output",
			impactSurface: "governance-state",
			failureMode: "loop budget exhausts early",
			responsibleArtifact: "loop-contract",
		},
		expectedEffect: {
			readiness: "the contract declares its budget floor",
			effectiveness: "loops stop before the budget is exhausted",
		},
	});
	const outcome = deriveEvolutionDrafts("loop-contract", [attributed], { targetRoot: target });
	const draft = outcome.drafts[0];
	assert.equal(draft.kind, DRAFT_KINDS["loop-contract"]);
	assert.equal(draft.draft.trigger.type, "manual");
	assert.equal(draft.draft.trigger.enabled, false);
	assert.equal(draft.draft.stateSpine, null);
	assert.equal(draft.draft.hardStops.maxIterations, null);
});

// ── §8.5 rejection-record open dependencies ──

test("every unblocked destination names the exact missing rejection-record shape", () => {
	for (const destination of ["capability-registry", "route", "loop-contract"]) {
		const entry = REJECTION_RECORD_DEPENDENCIES[destination];
		assert.equal(entry.hasRecordPath, false, destination);
		for (const field of REJECTION_RECORD_FIELDS) {
			assert.ok(
				entry.missing.includes(field),
				`${destination} names the required correlation field ${field}`,
			);
		}
		assert.ok(entry.missing.toLowerCase().includes("open dependency"));
	}
});

test("the required correlation field set matches the contract §8.5 four fields", () => {
	assert.deepEqual([...REJECTION_RECORD_FIELDS].sort(), [
		"attributionFingerprint",
		"reasonCode",
		"recordedAt",
		"summary",
	]);
});

// ── input hygiene ──

test("an unknown destination is a programmer error, not a silent refusal", () => {
	assert.throws(
		() => deriveEvolutionDrafts("wiki", [], { targetRoot: "t" }),
		/unknown deriver destination/,
	);
});

test("a missing targetRoot is refused: admission cannot run without the owning target", () => {
	assert.throws(() => deriveEvolutionDrafts("route", [finding()], {}), /targetRoot/);
});

test("malformed finding entries are skipped, never classified as drafts or refusals", () => {
	const target = makeTarget("malformed");
	const outcome = deriveEvolutionDrafts(
		"route",
		[null, "text", 42, { count: 5 }, { findingAttribution: { responsibleArtifact: "route" } }],
		{ targetRoot: target },
	);
	assert.deepEqual(outcome.drafts, []);
	assert.deepEqual(outcome.refusals, []);
});
