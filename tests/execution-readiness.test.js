"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { run } = require("../scripts/amber");

function tempFixture(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-execution-readiness-${name}-`));
}

test("execution readiness - unapproved plan returns ready=false with blocker", async () => {
	const fixtureRoot = tempFixture("unapproved");
	try {
		fs.mkdirSync(path.join(fixtureRoot, "docs", "plans"), { recursive: true });
		fs.writeFileSync(
			path.join(fixtureRoot, "feature_list.json"),
			JSON.stringify(
				{
					features: [
						{
							id: "F001",
							title: "Test Feature",
							verification: ["Run test"],
						},
					],
				},
				null,
				2,
			),
		);

		const planPath = path.join(fixtureRoot, "docs", "plans", "F001-test.md");
		fs.writeFileSync(
			planPath,
			[
				"# Plan: Test",
				"Feature: F001",
				"Status: implementation-ready",
				"User Confirmation: pending",
				"",
				"## Goal",
				"Test goal",
				"",
				"## High Level Design",
				"- Context: test",
				"",
				"## Vertical Slices",
				"- [ ] Slice 1",
				"",
				"## Acceptance Criteria",
				"- Criterion 1",
				"",
				"## Verification",
				"- Run test",
				"",
				"## Evidence Schema",
				"- Command:",
			].join("\n"),
		);

		const exitCode = await run([
			"execution",
			"readiness",
			"--target",
			fixtureRoot,
			"--plan",
			"docs/plans/F001-test.md",
			"--json",
		]);

		assert.strictEqual(exitCode, 1);
	} finally {
		fs.rmSync(fixtureRoot, { recursive: true, force: true });
	}
});

test("execution readiness - approved plan returns ready=true", async () => {
	const fixtureRoot = tempFixture("approved");
	try {
		fs.mkdirSync(path.join(fixtureRoot, "docs", "plans"), { recursive: true });
		fs.writeFileSync(
			path.join(fixtureRoot, "feature_list.json"),
			JSON.stringify(
				{
					features: [
						{
							id: "F001",
							title: "Test Feature",
							verification: ["Run test"],
						},
					],
				},
				null,
				2,
			),
		);

		const planPath = path.join(fixtureRoot, "docs", "plans", "F001-approved.md");
		fs.writeFileSync(
			planPath,
			[
				"# Plan: Approved",
				"Feature: F001",
				"Status: implementation-ready",
				"User Confirmation: confirmed",
				"<!-- gate: approved -->",
				"",
				"## Goal",
				"Test goal",
				"",
				"## High Level Design",
				"- Context: test",
				"",
				"## Vertical Slices",
				"- [ ] Slice 1",
				"",
				"## Acceptance Criteria",
				"- Criterion 1",
				"",
				"## Verification",
				"- Run test",
				"",
				"## Evidence Schema",
				"- Command:",
			].join("\n"),
		);

		const exitCode = await run([
			"execution",
			"readiness",
			"--target",
			fixtureRoot,
			"--plan",
			"docs/plans/F001-approved.md",
			"--json",
		]);

		assert.strictEqual(exitCode, 0);
	} finally {
		fs.rmSync(fixtureRoot, { recursive: true, force: true });
	}
});
