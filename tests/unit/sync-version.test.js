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
	assert.deepEqual([...r.synced].sort(), [
		".claude-plugin/plugin.json",
		".codex-plugin/plugin.json",
	]);
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

test("syncVersions also updates the README version badge text", () => {
	const dir = fixture("9.9.9", "1.0.0");
	fs.writeFileSync(
		path.join(dir, "README.md"),
		"**Status:** Stable | **Version:** 1.0.0 · [Milestones ->](./ROADMAP.md)\n",
	);
	const r = syncVersions(dir);
	assert.ok(r.synced.includes("README.md"), "README.md in synced");
	const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
	assert.match(readme, /\*\*Version:\*\* 9\.9\.9/);
	assert.doesNotMatch(readme, /\*\*Version:\*\* 1\.0\.0/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("syncVersions leaves README alone when the badge already matches", () => {
	const dir = fixture("9.9.9", "1.0.0");
	fs.writeFileSync(path.join(dir, "README.md"), "**Version:** 9.9.9 · other\n");
	const r = syncVersions(dir);
	assert.ok(!r.synced.includes("README.md"), "README not re-synced");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("syncVersions updates the root lockfile and dsh bundle dependency", () => {
	const dir = fixture("9.9.9", "1.0.0");
	fs.writeFileSync(
		path.join(dir, "package-lock.json"),
		JSON.stringify({
			name: "amber-protocol",
			version: "1.0.0",
			packages: { "": { name: "amber-protocol", version: "1.0.0" } },
		}),
	);
	fs.mkdirSync(path.join(dir, "dsh"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "dsh", "package.json"),
		JSON.stringify({
			name: "dsh-amber-protocol",
			version: "1.0.0",
			dependencies: { "amber-protocol": "^1.5.1" },
		}),
	);

	const r = syncVersions(dir);
	assert.ok(r.synced.includes("package-lock.json"));
	assert.ok(r.synced.includes("dsh/package.json"));

	const lock = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8"));
	assert.equal(lock.version, "9.9.9");
	assert.equal(lock.packages[""].version, "9.9.9");

	const dsh = JSON.parse(fs.readFileSync(path.join(dir, "dsh", "package.json"), "utf8"));
	assert.equal(dsh.version, "9.9.9");
	assert.equal(dsh.dependencies["amber-protocol"], "^9.9.9");
	fs.rmSync(dir, { recursive: true, force: true });
});
