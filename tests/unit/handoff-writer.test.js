"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
const { validateHandoff } = require("../../scripts/lib/core/audit");
const { addFeature, recordFeatureEvidence } = require("../../scripts/lib/feature-commands");
const { writeHandoff } = require("../../scripts/lib/handoff-command");

function tempDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-handoff-writer-${name}-`));
}

test("writeHandoff regenerates session-handoff.md from live state (not the template)", () => {
	const target = tempDir("live");
	scaffoldHarness(target);

	// The scaffolded template seeds F001 and says "Feature State: None." —
	// register a fresh feature with real evidence.
	addFeature(target, { id: "F002", title: "greeting output", area: "core" });
	recordFeatureEvidence(target, {
		feature: "F002",
		command: "npm test",
		result: "passed (exit 0)",
		sessionId: "abc12345-0000-0000-0000-000000000000",
	});

	const res = writeHandoff(target);
	assert.equal(res.changed, true);

	const content = fs.readFileSync(path.join(target, "session-handoff.md"), "utf8");
	// Live feature + evidence replaced the template placeholders.
	assert.match(content, /F002 \[passing\] greeting output/);
	assert.match(content, /F002: `npm test` → passed/);
	assert.match(content, /session abc12345/);
	assert.doesNotMatch(content, /Branch: not recorded/);
	assert.doesNotMatch(content, /Feature State\s*\n\s*\nNone\./);

	// The regenerated file still satisfies the handoff validator.
	assert.deepEqual(validateHandoff(target).errors, []);
});

test("writeHandoff is idempotent when state is unchanged", () => {
	const target = tempDir("idempotent");
	scaffoldHarness(target);
	addFeature(target, { id: "F001", title: "x", area: "core" });

	assert.equal(writeHandoff(target).changed, true);
	assert.equal(writeHandoff(target).changed, false);
});

test("writeHandoff dryRun does not write", () => {
	const target = tempDir("dry");
	scaffoldHarness(target);
	addFeature(target, { id: "F001", title: "x", area: "core" });

	const before = fs.readFileSync(path.join(target, "session-handoff.md"), "utf8");
	const res = writeHandoff(target, { dryRun: true });
	assert.equal(res.changed, true);
	assert.equal(fs.readFileSync(path.join(target, "session-handoff.md"), "utf8"), before);
});
