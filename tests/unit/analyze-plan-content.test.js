"use strict";

// Unit tests for the extracted deep module analyzePlanContent — the pure
// plan-content analyzer. These exercise it directly (no filesystem, no
// process.env) through injected resolvers, which is the new test surface the
// extraction created.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { analyzePlanContent } = require("../../scripts/lib/core/execution-validator");

const resolvers = (overrides = {}) => ({
	hasEnvVar: () => true,
	hasApprovalFile: () => false,
	hasIntegrationFile: () => true,
	...overrides,
});

test("blocks a plan lacking both approval marker and .approved file", () => {
	const result = analyzePlanContent("# Plan\n", resolvers());
	assert.ok(result.blockers.some((b) => b.includes("Plan not approved")));
	assert.equal(result.checks.plan, false);
});

test("an inline approval marker approves the plan", () => {
	const result = analyzePlanContent("# Plan\n<!-- approved -->\n", resolvers());
	assert.equal(result.checks.plan, true);
	assert.ok(!result.blockers.some((b) => b.includes("Plan not approved")));
});

test("a sibling .approved file approves the plan via the resolver", () => {
	const result = analyzePlanContent("# Plan\n", resolvers({ hasApprovalFile: () => true }));
	assert.equal(result.checks.plan, true);
});

test("missing env var referenced in the plan is a blocker", () => {
	const result = analyzePlanContent(
		"# Plan\n<!-- approved -->\nUse ${DEPLOY_TOKEN}\n",
		resolvers({ hasEnvVar: () => false }),
	);
	assert.equal(result.checks.env, false);
	assert.ok(result.blockers.some((b) => b.startsWith("Missing env vars: DEPLOY_TOKEN")));
});

test("a present env var satisfies the env check", () => {
	const result = analyzePlanContent(
		"# Plan\n<!-- approved -->\nUse ${DEPLOY_TOKEN}\n",
		resolvers({ hasEnvVar: () => true }),
	);
	assert.equal(result.checks.env, true);
});

test("a plan with no env vars satisfies the env check", () => {
	const result = analyzePlanContent("# Plan\n<!-- approved -->\n", resolvers());
	assert.equal(result.checks.env, true);
});

test("a referenced integration that resolves passes the integration check", () => {
	const result = analyzePlanContent(
		"# Plan\n<!-- approved -->\nintegration: deploy\n",
		resolvers({ hasIntegrationFile: () => true }),
	);
	assert.equal(result.checks.integrations, true);
});

test("a referenced integration that does not resolve is a blocker", () => {
	const result = analyzePlanContent(
		"# Plan\n<!-- approved -->\nintegration: ghost\n",
		resolvers({ hasIntegrationFile: () => false }),
	);
	assert.equal(result.checks.integrations, false);
	assert.ok(result.blockers.some((b) => b.startsWith("Integration files not found: ghost")));
});

test("a plan with no integrations satisfies the integration check", () => {
	const result = analyzePlanContent("# Plan\n<!-- approved -->\n", resolvers());
	assert.equal(result.checks.integrations, true);
});

test("strict mode blocks plans missing Goals and Implementation sections", () => {
	const result = analyzePlanContent("# Plan\n<!-- approved -->\n", {
		strict: true,
		...resolvers(),
	});
	assert.ok(result.blockers.some((b) => b.includes("missing Goals or Objectives")));
	assert.ok(result.blockers.some((b) => b.includes("missing Implementation or Steps")));
});

test("strict mode warns when the Test section is absent", () => {
	const result = analyzePlanContent("# Plan\n<!-- approved -->\n## Goals\n## Implementation\n", {
		strict: true,
		...resolvers(),
	});
	assert.ok(result.warnings.some((w) => w.includes("missing Test section")));
	assert.ok(!result.blockers.some((b) => b.includes("missing Goals or Objectives")));
});

test("non-strict mode performs no section checks", () => {
	const result = analyzePlanContent("# Plan\n<!-- approved -->\n", resolvers());
	assert.ok(!result.warnings.some((w) => w.includes("missing Test section")));
});

test("a fully valid plan collects no blockers or warnings", () => {
	const result = analyzePlanContent(
		"# Plan\n<!-- approved -->\n## Goals\n## Implementation\n## Test\n",
		{ strict: true, ...resolvers() },
	);
	assert.deepEqual(result.blockers, []);
	assert.deepEqual(result.warnings, []);
	assert.equal(result.checks.plan, true);
	assert.equal(result.checks.env, true);
	assert.equal(result.checks.integrations, true);
});
