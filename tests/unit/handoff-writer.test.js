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
	assert.match(content, /^Last Updated: \d{4}-\d{2}-\d{2}$/m);
	assert.doesNotMatch(content, /Branch: not recorded/);
	assert.doesNotMatch(content, /Feature State\s*\n\s*\nNone\./);

	// The regenerated file still satisfies the handoff validator.
	const validated = validateHandoff(target);
	assert.deepEqual(validated.errors, []);
	assert.match(String(validated.lastUpdated || ""), /^\d{4}-\d{2}-\d{2}$/);
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

// Free-text evidence strings are valid in feature_list (validators only require
// a non-empty array for passing). Spreading a string into an object used to
// produce character-index keys and render every entry as `(none)`.
test("writeHandoff renders free-text string evidence instead of (none)", () => {
	const target = tempDir("string-evidence");
	scaffoldHarness(target);

	const featureListPath = path.join(target, "feature_list.json");
	const data = JSON.parse(fs.readFileSync(featureListPath, "utf8"));
	// Scaffold seeds F001; attach a free-text evidence string the way many
	// early "passing" features record it.
	const f001 = data.features.find((f) => f.id === "F001");
	assert.ok(f001, "scaffold seeds F001");
	f001.status = "passing";
	f001.evidence = ["npm test: 1158/0 passing across Node 18/20/22 CI matrix"];
	// Also keep one structured record so both shapes coexist.
	data.features.push({
		id: "F010",
		title: "structured evidence",
		status: "passing",
		area: "core",
		verification: ["x"],
		evidence: [
			{
				command: "npm test",
				result: "passed (exit 0)",
				date: "2026-07-22",
				sessionId: "deadbeef-0000-0000-0000-000000000001",
			},
		],
	});
	fs.writeFileSync(featureListPath, JSON.stringify(data, null, 2) + "\n");

	const res = writeHandoff(target);
	assert.equal(res.changed, true);
	const content = fs.readFileSync(path.join(target, "session-handoff.md"), "utf8");

	assert.match(
		content,
		/F001: npm test: 1158\/0 passing across Node 18\/20\/22 CI matrix/,
		"free-text evidence must appear verbatim",
	);
	assert.doesNotMatch(
		content,
		/F001: `\(none\)` → \(none\)/,
		"must not greenwash string evidence as empty structured fields",
	);
	assert.match(content, /F010: `npm test` → passed \(exit 0\)/);
	assert.match(content, /session deadbeef/);

	assert.deepEqual(require("../../scripts/lib/core/audit").validateHandoff(target).errors, []);
});

test("normalizeEvidenceEntry does not spread string characters", () => {
	const { normalizeEvidenceEntry } = require("../../scripts/lib/handoff-command");
	const n = normalizeEvidenceEntry("F001", "npm test green");
	assert.equal(n.feature, "F001");
	assert.equal(n.result, "npm test green");
	assert.equal(n.command, null);
	assert.equal(n.freeText, true);
	assert.equal(n["0"], undefined, "must not enumerate string indices");
});
