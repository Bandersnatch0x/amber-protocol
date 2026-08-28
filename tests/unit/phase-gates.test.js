"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	PHASES,
	gatherPhaseEvidence,
	validatePhaseEvidence,
	promotePhase,
	rollbackPhase,
	listTransitions,
	checkInvariantNonRegression,
} = require("../../scripts/lib/core/phase-gates");
const { mkTarget } = require("../helpers/harness");

// ── Phase definitions ─────────────────────────────────────────

test("PHASES enumerates Phase 0 through Phase 4", () => {
	assert.deepEqual([...PHASES].sort(), ["phase-0", "phase-1", "phase-2", "phase-3", "phase-4"]);
});

// ── Gate evidence ─────────────────────────────────────────────

test("gatherPhaseEvidence collects deterministic evidence for a phase", () => {
	const dir = mkTarget("gather");
	const evidence = gatherPhaseEvidence(dir, "phase-0");
	assert.ok(Array.isArray(evidence));
	assert.ok(evidence.length > 0, "phase-0 requires evidence");
	for (const item of evidence) {
		assert.ok(item.id, "evidence has stable id");
		assert.ok(item.requirement, "evidence has requirement text");
		assert.equal(typeof item.satisfied, "boolean");
	}
});

test("validatePhaseEvidence reports complete when all evidence present", () => {
	const dir = mkTarget("valid");
	// phase-0 needs canonical artifacts — provide a context page
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({
			pageId: "p1",
			title: "Page 1",
			sources: { s1: { kind: "repo", ref: "a.md" } },
			blocks: [],
		}),
	);
	const result = validatePhaseEvidence(dir, "phase-0");
	assert.equal(result.complete, true, JSON.stringify(result.missing));
	assert.deepEqual(result.missing, []);
});

test("validatePhaseEvidence reports incomplete when evidence missing", () => {
	const dir = mkTarget("incomplete");
	const result = validatePhaseEvidence(dir, "phase-1");
	assert.equal(result.complete, false);
	assert.ok(result.missing.length > 0, "missing evidence listed");
});

// ── Promotion ─────────────────────────────────────────────────

test("promotePhase requires explicit authorization", () => {
	const dir = mkTarget("promote-noauth");
	const result = promotePhase(dir, "phase-0", { authorization: null });
	assert.equal(result.ok, false);
	assert.ok(result.errors.some((e) => e.includes("authorization")));
});

test("promotePhase records the promotion when evidence complete", () => {
	const dir = mkTarget("promote");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({
			pageId: "p1",
			title: "Page 1",
			sources: { s1: { kind: "repo", ref: "a.md" } },
			blocks: [],
		}),
	);
	const result = promotePhase(dir, "phase-0", { authorization: "human-approve" });
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.ok(result.transition);
	assert.equal(result.transition.phase, "phase-0");
	assert.equal(result.transition.status, "promoted");

	const transitions = listTransitions(dir);
	assert.equal(transitions.length, 1);
	assert.equal(transitions[0].authorization, "human-approve");
});

test("promotePhase refuses when evidence is incomplete (no silent promotion)", () => {
	const dir = mkTarget("promote-blocked");
	const result = promotePhase(dir, "phase-1", { authorization: "human-approve" });
	assert.equal(result.ok, false);
	assert.ok(
		result.errors.some((e) => e.includes("evidence")),
		"incomplete evidence blocks promotion",
	);
});

// ── Rollback ─────────────────────────────────────────────────

test("rollbackPhase records an append-only lineage entry", () => {
	const dir = mkTarget("rollback");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({
			pageId: "p1",
			title: "Page 1",
			sources: { s1: { kind: "repo", ref: "a.md" } },
			blocks: [],
		}),
	);
	promotePhase(dir, "phase-0", { authorization: "human-approve" });
	const result = rollbackPhase(dir, "phase-0", {
		checkpoint: "abc123",
		reason: "evidence regression",
	});
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.equal(result.transition.status, "rolled-back");
	assert.ok(result.transition.rollbackTo, "checkpoint recorded");

	const transitions = listTransitions(dir);
	// promote + rollback both recorded (append-only lineage)
	assert.equal(transitions.length, 2);
	assert.equal(transitions[1].status, "rolled-back");
});

test("rollbackPhase refuses a destructive rollback (no checkpoint)", () => {
	const dir = mkTarget("destructive");
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", "p1.json"),
		JSON.stringify({
			pageId: "p1",
			title: "Page 1",
			sources: { s1: { kind: "repo", ref: "a.md" } },
			blocks: [],
		}),
	);
	promotePhase(dir, "phase-0", { authorization: "human-approve" });
	const result = rollbackPhase(dir, "phase-0", { checkpoint: null, reason: "destroy" });
	assert.equal(result.ok, false, "destructive rollback without checkpoint is impossible");
	assert.ok(result.errors.some((e) => e.includes("checkpoint")));
});

// ── Invariant non-regression ──────────────────────────────────

test("checkInvariantNonRegression verifies core invariants", () => {
	const dir = mkTarget("invariants");
	const result = checkInvariantNonRegression(dir);
	assert.ok(result);
	assert.equal(typeof result.ok, "boolean");
	assert.ok(Array.isArray(result.invariants));
	assert.ok(result.invariants.length > 0, "invariants enumerated");
});

test("invariant check fails closed on missing canonical state", () => {
	const dir = mkTarget("invariants-fail");
	// empty target → every invariant fails (no silent `|| true`)
	const result = checkInvariantNonRegression(dir);
	assert.equal(result.ok, false);
	for (const invariant of result.invariants) {
		assert.equal(invariant.satisfied, false, `invariant ${invariant.id} must not be vacuous`);
	}
});

test("each invariant is a real check — satisfied only when its artifact exists", () => {
	const dir = mkTarget("invariants-real");
	// only a deployment profile → only inv-2 passes
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "profile.json"),
		JSON.stringify({ deploymentProfile: "personal-node" }),
	);
	const withProfile = checkInvariantNonRegression(dir);
	const inv2 = withProfile.invariants.find((i) => i.id === "inv-2");
	assert.equal(inv2.satisfied, true);
	assert.equal(
		withProfile.invariants.find((i) => i.id === "inv-1").satisfied,
		false,
		"inv-1 still fails without context pages",
	);
	assert.equal(
		withProfile.invariants.find((i) => i.id === "inv-3").satisfied,
		false,
		"inv-3 still fails without a transitions ledger",
	);
	// add the transitions ledger → inv-3 passes
	fs.mkdirSync(path.join(dir, ".amber", "phases"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "phases", "transitions.jsonl"), "");
	const withLedger = checkInvariantNonRegression(dir);
	assert.equal(withLedger.invariants.find((i) => i.id === "inv-3").satisfied, true);
});

// ── Gate/validator agreement (#270) ───────────────────────────

function profileEvidence(dir) {
	return gatherPhaseEvidence(dir, "phase-2").find(
		(e) => e.requirement === "personal-node profile declared",
	);
}

test("a bogus profile value satisfies neither the phase-2 gate nor inv-2", () => {
	const dir = mkTarget("gate-bogus-profile");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "profile.json"),
		JSON.stringify({ deploymentProfile: "bogus" }),
	);
	assert.equal(profileEvidence(dir).satisfied, false);
	const inv2 = checkInvariantNonRegression(dir).invariants.find((i) => i.id === "inv-2");
	assert.equal(inv2.satisfied, false);
});

test("malformed profile JSON satisfies neither the phase-2 gate nor inv-2", () => {
	const dir = mkTarget("gate-malformed-profile");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "profile.json"), "{ bad json");
	assert.equal(profileEvidence(dir).satisfied, false);
	const inv2 = checkInvariantNonRegression(dir).invariants.find((i) => i.id === "inv-2");
	assert.equal(inv2.satisfied, false);
});

test("any enum-valid declared profile satisfies the phase-2 gate", () => {
	const dir = mkTarget("gate-valid-profile");
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "profile.json"),
		JSON.stringify({ deploymentProfile: "team-hub" }),
	);
	assert.equal(profileEvidence(dir).satisfied, true);
});
