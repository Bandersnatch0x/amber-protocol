"use strict";

// F036-S1 regression: sessions surfaces must read through
// resolveStateDirForRead so legacy .harness state is visible. Previously
// audit.js (validateHandoff sessionCount) and context-request.js
// (findLatestLedger auto-bundle) hardcoded .amber/sessions, so a legacy
// .harness repository got zero session counts and no automatic evidence
// bundling while amber session list saw everything.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { validateHandoff } = require("../../scripts/lib/core/audit");
const { bundleSources } = require("../../scripts/lib/core/context-request");
const { resetWarnings } = require("../../scripts/lib/state-dir-resolver");

function tempDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function writeLegacySession(targetRoot, id, events) {
	const dir = path.join(targetRoot, ".harness", "sessions", id);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "ledger.jsonl"),
		events.map((e) => JSON.stringify(e)).join("\n") + "\n",
	);
	return dir;
}

test("validateHandoff counts sessions under the legacy .harness state dir", () => {
	resetWarnings();
	const target = tempDir("f036-audit-legacy");
	// validateHandoff returns early (before counting) when session-handoff.md
	// is absent, so the fixture needs a minimal one.
	fs.writeFileSync(
		path.join(target, "session-handoff.md"),
		"# Handoff\n\n## Next Action\n\n- none\n",
	);
	writeLegacySession(target, "s-one", [
		{ type: "session_created", timestamp: "2025-01-01T10:00:00Z", data: { goal: "a" } },
	]);
	writeLegacySession(target, "s-two", [
		{ type: "session_created", timestamp: "2025-01-01T11:00:00Z", data: { goal: "b" } },
	]);

	const handoff = validateHandoff(target);
	assert.equal(
		handoff.sessionCount,
		2,
		"audit session count must match the two legacy .harness sessions",
	);
});

test("bundleSources auto-bundles the latest ledger under the legacy .harness state dir", () => {
	resetWarnings();
	const target = tempDir("f036-bundle-legacy");
	writeLegacySession(target, "s-older", [
		{ type: "session_created", timestamp: "2025-01-01T10:00:00Z", data: { goal: "older" } },
	]);
	// Newer mtime so findLatestLedger picks this one.
	const latest = writeLegacySession(target, "s-latest", [
		{ type: "session_created", timestamp: "2025-01-01T11:00:00Z", data: { goal: "latest" } },
	]);
	const now = new Date();
	fs.utimesSync(path.join(latest, "ledger.jsonl"), now, now);
	// Backdate the older ledger explicitly: on coarse-mtime filesystems both
	// writes can share one mtimeMs, and readdir order then decides which
	// ledger findLatestLedger keeps — a CI-only flake (seen in run 32879175845).
	const older = path.join(target, ".harness", "sessions", "s-older", "ledger.jsonl");
	fs.utimesSync(older, new Date(now.getTime() - 10_000), new Date(now.getTime() - 10_000));

	const bundled = bundleSources(target, []);
	assert.deepEqual(bundled.errors, []);
	assert.equal(bundled.sources.length, 1, "auto-bundle must find the legacy ledger");
	assert.match(
		bundled.sources[0].ref.replace(/\\/g, "/"),
		/\.harness\/sessions\/s-latest\/ledger\.jsonl/,
	);
});
