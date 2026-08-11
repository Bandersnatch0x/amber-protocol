"use strict";

// Characterization tests for checkExecutionReadiness: this function had zero
// coverage, so these pin its current behavior as a safety net before the
// plan-content analysis is extracted into a deep module.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { checkExecutionReadiness } = require("../../scripts/lib/core/execution-validator");

function tempProject() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "readiness-"));
	return root;
}

function writePlan(root, planName, content) {
	const planPath = path.join(root, planName);
	fs.writeFileSync(planPath, content);
	return planPath;
}

function withEnv(overrides, fn) {
	const saved = {};
	const names = Object.keys(overrides);
	for (const name of names) {
		saved[name] = process.env[name];
		if (overrides[name] === undefined) {
			delete process.env[name];
		} else {
			process.env[name] = overrides[name];
		}
	}
	try {
		return fn();
	} finally {
		for (const name of names) {
			if (saved[name] === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = saved[name];
			}
		}
	}
}

function approvedPlan(body = "# Plan\n") {
	return `${body}<!-- approved -->\n`;
}

test("missing plan file adds a blocker and stays not ready", () => {
	const root = tempProject();
	const result = checkExecutionReadiness(root, path.join(root, "missing.md"));
	assert.equal(result.ready, false);
	assert.ok(result.blockers.some((b) => b.startsWith("Plan file not found:")));
});

test("plan without approval marker is not ready", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", "# Plan\n");
	const result = checkExecutionReadiness(root, planPath);
	assert.equal(result.checks.plan, false);
	assert.ok(result.blockers.some((b) => b.includes("Plan not approved")));
});

test("plan with an approval marker is approved", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", approvedPlan());
	const result = checkExecutionReadiness(root, planPath);
	assert.equal(result.checks.plan, true);
	assert.ok(!result.blockers.some((b) => b.includes("Plan not approved")));
});

test("a .approved sibling file also marks the plan approved", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", "# Plan\n");
	fs.writeFileSync(path.join(root, "plan.approved"), "");
	const result = checkExecutionReadiness(root, planPath);
	assert.equal(result.checks.plan, true);
});

test("referenced env var present satisfies the env check", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", approvedPlan("Build with ${BUILD_TOKEN}\n"));
	const result = withEnv({ BUILD_TOKEN: "abc" }, () => checkExecutionReadiness(root, planPath));
	assert.equal(result.checks.env, true);
	assert.ok(!result.blockers.some((b) => b.startsWith("Missing env vars")));
});

test("referenced env var missing is a blocker", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", approvedPlan("Use ${MISSING_TOKEN_XYZ}\n"));
	const result = withEnv({ MISSING_TOKEN_XYZ: undefined }, () =>
		checkExecutionReadiness(root, planPath),
	);
	assert.equal(result.checks.env, false);
	assert.ok(result.blockers.some((b) => b.startsWith("Missing env vars: MISSING_TOKEN_XYZ")));
});

test("plan referencing an integration that exists passes the integration check", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", approvedPlan("integration: deploy\n"));
	fs.mkdirSync(path.join(root, "integrations"), { recursive: true });
	fs.writeFileSync(path.join(root, "integrations", "deploy.json"), "{}");
	const result = checkExecutionReadiness(root, planPath);
	assert.equal(result.checks.integrations, true);
});

test("plan referencing a missing integration is a blocker", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", approvedPlan("integration: ghost\n"));
	const result = checkExecutionReadiness(root, planPath);
	assert.equal(result.checks.integrations, false);
	assert.ok(result.blockers.some((b) => b.startsWith("Integration files not found: ghost")));
});

test("strict mode blocks a plan without Goals and Implementation sections", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", approvedPlan("# Plan\n"));
	const result = checkExecutionReadiness(root, planPath, { strict: true });
	assert.equal(result.strictMode, true);
	assert.ok(result.blockers.some((b) => b.includes("missing Goals or Objectives")));
	assert.ok(result.blockers.some((b) => b.includes("missing Implementation or Steps")));
});

test("strict mode warns when the Test section is absent", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", approvedPlan("## Goals\n## Implementation\n"));
	const result = checkExecutionReadiness(root, planPath, { strict: true });
	assert.ok(result.warnings.some((w) => w.includes("missing Test section")));
});

test("a non-git project root is treated as a clean worktree", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", approvedPlan());
	const result = checkExecutionReadiness(root, planPath);
	assert.equal(result.checks.worktree, true);
});

test("missing rules.json warns but policy check still passes via built-in defaults", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", approvedPlan());
	const result = checkExecutionReadiness(root, planPath);
	// Defaults always apply — absence of autonomous-policy is not a gap.
	assert.equal(result.checks.policy, true);
	assert.ok(
		result.warnings.some((w) => w.includes("rules.json")),
		`expected rules.json default warning, got: ${result.warnings.join("; ")}`,
	);
	assert.ok(
		!result.warnings.some((w) => w.includes("No autonomous-policy.json found")),
		"must not require removed autonomous-policy surface",
	);
});

test("a present governance rules.json keeps policy check true without autonomous-policy", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", approvedPlan());
	const rulesDir = path.join(root, ".amber", "governance");
	fs.mkdirSync(rulesDir, { recursive: true });
	fs.writeFileSync(
		path.join(rulesDir, "rules.json"),
		JSON.stringify({
			schemaVersion: 1,
			defaultAction: "deny",
			rules: [{ id: "allow-npm", action: "allow", match: "prefix", pattern: "npm " }],
		}),
	);
	const result = checkExecutionReadiness(root, planPath);
	assert.equal(result.checks.policy, true);
	assert.ok(!result.warnings.some((w) => w.includes("No .amber/governance/rules.json")));
});

test("strict mode requires on-disk rules.json, not autonomous-policy.json", () => {
	const root = tempProject();
	const planPath = writePlan(
		root,
		"plan.md",
		approvedPlan("## Goals\n## Implementation\n## Test\n"),
	);
	const missing = checkExecutionReadiness(root, planPath, { strict: true });
	assert.ok(
		missing.blockers.some((b) => /rules\.json required/.test(b)),
		`expected rules.json strict blocker, got: ${missing.blockers.join("; ")}`,
	);
	assert.ok(!missing.blockers.some((b) => /autonomous-policy/.test(b)));

	const rulesDir = path.join(root, ".amber", "governance");
	fs.mkdirSync(rulesDir, { recursive: true });
	fs.writeFileSync(
		path.join(rulesDir, "rules.json"),
		JSON.stringify({ schemaVersion: 1, defaultAction: "deny", rules: [] }),
	);
	const present = checkExecutionReadiness(root, planPath, { strict: true });
	assert.ok(!present.blockers.some((b) => /rules\.json required/.test(b)));
	assert.equal(present.checks.policy, true);
});

test("leftover autonomous-policy with auto user-approval is a warning only", () => {
	const root = tempProject();
	const planPath = writePlan(root, "plan.md", approvedPlan());
	const autoDir = path.join(root, ".amber");
	fs.mkdirSync(autoDir, { recursive: true });
	fs.writeFileSync(
		path.join(autoDir, "autonomous-policy.json"),
		JSON.stringify({ gates: { "user-approval": "approve" } }),
	);
	const result = checkExecutionReadiness(root, planPath);
	assert.ok(
		result.warnings.some((w) => /Leftover autonomous-policy/.test(w)),
		`expected leftover policy warning, got: ${result.warnings.join("; ")}`,
	);
	assert.equal(result.ready, true);
});

test("a fully ready plan returns ready true with no blockers", () => {
	const root = tempProject();
	const planPath = writePlan(
		root,
		"plan.md",
		approvedPlan("## Goals\n## Implementation\n## Test\n"),
	);
	const rulesDir = path.join(root, ".amber", "governance");
	fs.mkdirSync(rulesDir, { recursive: true });
	fs.writeFileSync(
		path.join(rulesDir, "rules.json"),
		JSON.stringify({ schemaVersion: 1, defaultAction: "deny", rules: [] }),
	);
	const result = withEnv({}, () => checkExecutionReadiness(root, planPath));
	assert.equal(result.ready, true);
	assert.deepEqual(result.blockers, []);
});
