"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { migrateState, migrateWiki } = require("../../scripts/lib/state-migration");

function rootWithLegacyState() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-migrate-"));
	const sess = path.join(root, ".harness", "sessions", "s1");
	fs.mkdirSync(sess, { recursive: true });
	fs.writeFileSync(path.join(sess, "manifest.json"), JSON.stringify({ sessionId: "s1" }));
	fs.writeFileSync(path.join(sess, "timeline.jsonl"), JSON.stringify({ type: "start" }) + "\n");
	return root;
}

test("migrateState copies .harness into .amber and keeps the source", () => {
	const root = rootWithLegacyState();
	const result = migrateState(root);
	assert.ok(fs.existsSync(path.join(root, ".amber", "sessions", "s1", "manifest.json")));
	assert.ok(
		fs.existsSync(path.join(root, ".harness", "sessions", "s1", "manifest.json")),
		"source preserved",
	);
	assert.equal(result.failed.length, 0);
	assert.ok(result.copied.length >= 2);
	assert.equal(result.validated.manifests, 1);
	assert.equal(result.validated.timelines, 1);
});

test("migrateState merges into an existing .amber without overwriting files", () => {
	const root = rootWithLegacyState();
	const existing = path.join(root, ".amber", "sessions", "s1");
	fs.mkdirSync(existing, { recursive: true });
	fs.writeFileSync(
		path.join(existing, "manifest.json"),
		JSON.stringify({ sessionId: "canonical" }),
	);
	const result = migrateState(root);
	assert.equal(result.errors.length, 0);
	assert.deepEqual(result.conflicts, ["sessions/s1/manifest.json"]);
	assert.ok(fs.existsSync(path.join(root, ".amber", "sessions", "s1", "timeline.jsonl")));
	assert.match(
		fs.readFileSync(path.join(root, ".amber", "sessions", "s1", "manifest.json"), "utf8"),
		/canonical/,
	);
});

test("migrateState is a no-op when legacy state is already archived", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-migrate-"));
	fs.mkdirSync(path.join(root, ".amber"), { recursive: true });
	const result = migrateState(root, { archiveLegacy: true });
	assert.equal(result.errors.length, 0);
	assert.equal(result.archivedLegacy, false);
	assert.match(result.text, /Already consolidated/);
});

test("migrateState archives legacy source after a clean migration when requested", () => {
	const root = rootWithLegacyState();
	const result = migrateState(root, {
		archiveLegacy: true,
		now: new Date("2026-07-13T01:02:03.004Z"),
	});
	assert.equal(result.errors.length, 0);
	assert.equal(result.archivedLegacy, true);
	assert.ok(
		result.legacyBackupPath.endsWith(".amber-legacy-harness-backup-2026-07-13T01-02-03-004Z"),
	);
	assert.equal(fs.existsSync(path.join(root, ".harness")), false);
	assert.ok(fs.existsSync(path.join(result.legacyBackupPath, "sessions", "s1", "manifest.json")));
});

test("migrateState refuses to archive legacy source when conflicts remain", () => {
	const root = rootWithLegacyState();
	const existing = path.join(root, ".amber", "sessions", "s1");
	fs.mkdirSync(existing, { recursive: true });
	fs.writeFileSync(
		path.join(existing, "manifest.json"),
		JSON.stringify({ sessionId: "canonical" }),
	);
	const result = migrateState(root, { archiveLegacy: true });
	assert.equal(result.archivedLegacy, false);
	assert.ok(fs.existsSync(path.join(root, ".harness")));
	assert.match(result.errors.join("\n"), /Refusing to archive/);
});

test("migrateState reports corrupt manifests as failed validation, still copies", () => {
	const root = rootWithLegacyState();
	fs.writeFileSync(path.join(root, ".harness", "sessions", "s1", "manifest.json"), "{not json");
	const result = migrateState(root);
	assert.equal(result.failed.length, 1);
	assert.ok(fs.existsSync(path.join(root, ".amber", "sessions", "s1", "manifest.json")));
});

test("migrateWiki renames harness.md to amber.md and updates index links", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-wiki-"));
	const agentDir = path.join(root, "docs", "wiki", "agent");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(path.join(agentDir, "harness.md"), "# Harness\n");
	fs.writeFileSync(path.join(root, "docs", "wiki", "index.md"), "[Agent](./agent/harness.md)\n");
	const result = migrateWiki(root);
	assert.ok(fs.existsSync(path.join(agentDir, "amber.md")));
	assert.ok(!fs.existsSync(path.join(agentDir, "harness.md")));
	assert.match(
		fs.readFileSync(path.join(root, "docs", "wiki", "index.md"), "utf8"),
		/agent\/amber\.md/,
	);
	assert.equal(result.renamed.length, 1);
});

test("migrateWiki is a no-op when amber.md already exists", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-wiki-"));
	const agentDir = path.join(root, "docs", "wiki", "agent");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(path.join(agentDir, "amber.md"), "# Amber\n");
	const result = migrateWiki(root);
	assert.equal(result.renamed.length, 0);
	assert.equal(result.skipped.length, 1);
});
