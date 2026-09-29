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
	for (const rel of [
		".claude-plugin/plugin.json",
		".claude-plugin/settings.json",
		".codex-plugin/plugin.json",
	]) {
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
		".claude-plugin/settings.json",
		".codex-plugin/plugin.json",
	]);
	for (const rel of [
		".claude-plugin/plugin.json",
		".claude-plugin/settings.json",
		".codex-plugin/plugin.json",
	]) {
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

// A version bump must not REFORMAT the manifest. Re-serializing the whole
// document expands every array, so `"skills": ["./skills/"]` came back as three
// lines and `npm run format:check` rejected .claude-plugin/plugin.json — on the
// release commit itself. Only the version bytes may change.
test("syncVersions patches the version value without touching other formatting", () => {
	const dir = fixture("9.9.9", "1.0.0");
	const rel = ".claude-plugin/plugin.json";
	const authored =
		'{\n\t"name": "amber-protocol",\n\t"version": "1.0.0",\n\t"skills": ["./skills/"]\n}\n';
	fs.writeFileSync(path.join(dir, rel), authored);

	const r = syncVersions(dir);
	assert.ok(r.synced.includes(rel), `${rel} synced`);
	const after = fs.readFileSync(path.join(dir, rel), "utf8");
	assert.equal(after, authored.replace('"1.0.0"', '"9.9.9"'), "only the version bytes changed");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("syncVersions skips a manifest that does not exist (no crash)", () => {
	const dir = fixture("9.9.9", "1.0.0");
	fs.rmSync(path.join(dir, ".codex-plugin", "plugin.json"));
	const r = syncVersions(dir);
	assert.deepEqual(r.synced, [".claude-plugin/plugin.json", ".claude-plugin/settings.json"]);
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

// Both language editions carry a version badge, and a badge updated in one file
// and not the other is a quiet claim about which version the reader has.
test("syncVersions keeps the badge in lockstep in both README editions", () => {
	const dir = fixture("9.9.9", "1.0.0");
	fs.writeFileSync(path.join(dir, "README.md"), "**Version:** 1.0.0 · **Status:** Stable\n");
	fs.writeFileSync(path.join(dir, "README.zh-CN.md"), "**Version:** 1.0.0 · **状态：**稳定版\n");

	const r = syncVersions(dir);
	assert.deepEqual(
		r.synced.filter((rel) => rel.startsWith("README")),
		["README.md", "README.zh-CN.md"],
	);
	for (const rel of ["README.md", "README.zh-CN.md"]) {
		assert.match(fs.readFileSync(path.join(dir, rel), "utf8"), /\*\*Version:\*\* 9\.9\.9/, rel);
	}
	fs.rmSync(dir, { recursive: true, force: true });
});

// The badges are the only place a reader sees the version without running the
// CLI, so they must agree with package.json. A release bumps package.json and
// then runs `version:sync` (CONTRIBUTING step 3) — which is why this is a gate
// and not a redundant cross-check.
test("the shipped READMEs carry the package version badge", () => {
	const root = path.join(__dirname, "..", "..");
	const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	for (const rel of ["README.md", "README.zh-CN.md"]) {
		const text = fs.readFileSync(path.join(root, rel), "utf8");
		assert.match(text, new RegExp(`\\*\\*Version:\\*\\*\\s*${version.replace(/\./g, "\\.")}`), rel);
	}
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
