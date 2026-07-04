"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { syncVersions } = require("../../scripts/sync-version");

// Build a minimal repo root with package.json + both plugin manifests.
function fixture(pkgVersion, manifestVersion) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-sync-"));
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ name: "amber-protocol", version: pkgVersion }),
	);
	for (const rel of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(
			path.join(dir, rel),
			JSON.stringify({ name: "amber-protocol", version: manifestVersion }),
		);
	}
	return dir;
}

test("syncVersions copies package.json version into the plugin manifests", () => {
	const dir = fixture("9.9.9", "1.0.0");
	const r = syncVersions(dir);
	assert.deepEqual([...r.synced].sort(), [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]);
	for (const rel of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"]) {
		const data = JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));
		assert.equal(data.version, "9.9.9", `${rel} synced`);
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

test("syncVersions is a no-op when manifests already match", () => {
	const dir = fixture("9.9.9", "9.9.9");
	const r = syncVersions(dir);
	assert.equal(r.synced.length, 0);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("syncVersions skips a manifest that does not exist (no crash)", () => {
	const dir = fixture("9.9.9", "1.0.0");
	fs.rmSync(path.join(dir, ".codex-plugin", "plugin.json"));
	const r = syncVersions(dir);
	assert.deepEqual(r.synced, [".claude-plugin/plugin.json"]);
	fs.rmSync(dir, { recursive: true, force: true });
});
