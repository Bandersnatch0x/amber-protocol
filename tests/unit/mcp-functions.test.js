"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createFunctionRuntime } = require("../../scripts/lib/mcp-functions");
const { SCHEMA_VERSION } = require("../../scripts/lib/schema-version-checker");
const { mkTarget } = require("../helpers/harness");

function seedSession(dir, id, { mtimeSeconds } = {}) {
	const sdir = path.join(dir, ".amber", "sessions", id);
	fs.mkdirSync(sdir, { recursive: true });
	fs.writeFileSync(
		path.join(sdir, "manifest.json"),
		JSON.stringify({
			sessionId: id,
			schemaVersion: SCHEMA_VERSION,
			createdAt: "2026-08-01T00:00:00Z",
			updatedAt: "2026-08-01T00:00:00Z",
			route: { id: "feature-standard", version: "1.0.0" },
			goal: "g",
			status: "created",
			completedStages: [],
		}),
	);
	fs.writeFileSync(path.join(sdir, "timeline.jsonl"), "");
	if (mtimeSeconds) {
		fs.utimesSync(sdir, mtimeSeconds, mtimeSeconds);
	}
}

function runtimeFor(dir) {
	return createFunctionRuntime({
		configured: { primary: dir, targets: [dir], index: new Set([dir]) },
		definitions: [{ name: "amber.fn.sessionEvidence" }, { name: "amber.fn.repoOverview" }],
	});
}

test("sessionEvidence returns the newest session", () => {
	const dir = mkTarget("mcp-newest");
	seedSession(dir, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { mtimeSeconds: 1_700_000_000 });
	seedSession(dir, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { mtimeSeconds: 1_800_000_000 });
	const runtime = runtimeFor(dir);
	const { sessions } = runtime.invoke("amber.fn.sessionEvidence", {}, null);
	assert.equal(sessions.length, 1);
	assert.equal(sessions[0].sessionId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
});

test("sessionEvidence is deterministic on equal mtimes (lexicographic tiebreak)", () => {
	const dir = mkTarget("mcp-tiebreak");
	// identical mtimes — the same-ms class that once flipped between runs
	seedSession(dir, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", { mtimeSeconds: 1_750_000_000 });
	seedSession(dir, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { mtimeSeconds: 1_750_000_000 });
	const runtime = runtimeFor(dir);
	const pick = () => runtime.invoke("amber.fn.sessionEvidence", {}, null).sessions[0].sessionId;
	const first = pick();
	const second = pick();
	assert.equal(
		first,
		"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
		"lexicographically smaller id wins the tiebreak",
	);
	assert.equal(second, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "deterministic across calls");
});
