"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { proposeMaintenance } = require("../scripts/lib/amber-core");

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

	const result = proposeMaintenance(fixtureRoot, {});

	assert.deepEqual(result.errors, []);
	assert.ok(result.proposalPath);

	const fullPath = path.join(fixtureRoot, result.proposalPath);
	assert.ok(fs.existsSync(fullPath));

	const content = fs.readFileSync(fullPath, "utf8");
	const sectionCount = (content.match(/^## /gm) || []).length;
	assert.ok(sectionCount >= 2, `Expected 2+ sections, got ${sectionCount}`);

	fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

