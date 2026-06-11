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

test("migrateState refuses to overwrite an existing .amber", () => {
	const root = rootWithLegacyState();
	fs.mkdirSync(path.join(root, ".amber"));
	const result = migrateState(root);
	assert.ok(result.errors.length >= 1);
	assert.match(result.errors[0], /\.amber already exists/);
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
	fs.writeFileSync(
		path.join(root, "docs", "wiki", "index.md"),
		"[Agent](./agent/harness.md)\n",
	);
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
