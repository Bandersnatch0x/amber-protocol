"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runMaintenanceAction } = require("../scripts/lib/core/maintenance");

function tempDir() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "maintenance-proposal-"));
}

test("project with stale docs + drift → proposal.md has 2+ sections", () => {
	const fixtureRoot = tempDir();
	fs.mkdirSync(path.join(fixtureRoot, "docs"), { recursive: true });
	fs.mkdirSync(path.join(fixtureRoot, ".amber"), { recursive: true });
	fs.mkdirSync(path.join(fixtureRoot, "workflow-packs"), { recursive: true });

	const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
	fs.writeFileSync(
		path.join(fixtureRoot, "docs", "old-guide.md"),
		"# Old Guide\nStale content"
	);
	fs.utimesSync(
		path.join(fixtureRoot, "docs", "old-guide.md"),
		new Date(oldDate),
		new Date(oldDate)
	);

	fs.writeFileSync(
		path.join(fixtureRoot, ".amber", "team.json"),
		JSON.stringify({ version: "0.1.0", preset: "safe-bootstrap" })
	);

	fs.writeFileSync(
		path.join(fixtureRoot, "workflow-packs", "safe-bootstrap.pack.json"),
		JSON.stringify({ version: "0.2.0" })
	);

	const result = runMaintenanceAction("propose", fixtureRoot, {});

	assert.deepEqual(result.errors, []);
	assert.ok(result.proposalPath);

	const fullPath = path.join(fixtureRoot, result.proposalPath);
	assert.ok(fs.existsSync(fullPath));

	const content = fs.readFileSync(fullPath, "utf8");
	const sectionCount = (content.match(/^## /gm) || []).length;
	assert.ok(sectionCount >= 2, `Expected 2+ sections, got ${sectionCount}`);

	fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test("unknown --priority value errors instead of silently emptying the proposal", () => {
	// An unrecognized priority used to leave allowedCategories empty, which
	// zeroed every section and wrote a blank proposal with no error. Validate
	// the input and fail fast instead.
	const fixtureRoot = tempDir();
	fs.mkdirSync(path.join(fixtureRoot, "docs", "wiki", "engineering"), {
		recursive: true,
	});
	fs.writeFileSync(
		path.join(fixtureRoot, "docs", "wiki", "engineering", "verification.md"),
		"Last Reviewed: 2000-01-01\n"
	);

	const result = runMaintenanceAction("propose", fixtureRoot, { priority: "bogus" });

	assert.ok(
		result.errors.some((e) => /priority/i.test(e)),
		`expected a priority error, got: ${JSON.stringify(result.errors)}`
	);
	assert.ok(!result.proposalPath, "no proposal should be written for a bad priority");

	fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test("valid --priority values are accepted and write a proposal", () => {
	const fixtureRoot = tempDir();
	fs.mkdirSync(path.join(fixtureRoot, "docs", "wiki", "engineering"), {
		recursive: true,
	});
	fs.writeFileSync(
		path.join(fixtureRoot, "docs", "wiki", "engineering", "verification.md"),
		"Last Reviewed: 2000-01-01\n"
	);

	for (const priority of ["high", "medium", "low"]) {
		const result = runMaintenanceAction("propose", fixtureRoot, { priority });
		assert.deepEqual(result.errors, [], `priority ${priority} should be accepted`);
		assert.ok(result.proposalPath, `priority ${priority} should write a proposal`);
	}

	fs.rmSync(fixtureRoot, { recursive: true, force: true });
});


