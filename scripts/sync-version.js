"use strict";

// Single-source-of-truth version sync. package.json is the only file whose
// `version` is hand-edited; this script copies it into the static manifest
// files that CONSUMERS read directly — the Claude and Codex plugin manifests.
// Those manifests MUST carry their own `version` (marketplaces read them as
// static JSON; they cannot read package.json at runtime), so we keep them in
// lockstep here instead of via a test failure at release time.
//
// Run via `npm run version:sync` as part of the release flow: edit
// package.json's version, run this, then commit + tag.
//
// OUT OF SCOPE: registry/*.json (a release-id -> release-detail map; a new
// release adds an entry rather than overwriting a current-version field) and
// rule-packs/*.json (independent per-pack versioning, no test ties them to
// package.json).

const fs = require("node:fs");
const path = require("node:path");

const TARGETS = [
	".claude-plugin/plugin.json",
	".codex-plugin/plugin.json",
];

function syncVersions(root) {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	if (!pkg || typeof pkg.version !== "string" || pkg.version.trim() === "") {
		throw new Error("package.json has no usable `version` field.");
	}
	const synced = [];
	for (const rel of TARGETS) {
		const abs = path.join(root, rel);
		if (!fs.existsSync(abs)) continue;
		const data = JSON.parse(fs.readFileSync(abs, "utf8"));
		if (data.version === pkg.version) continue;
		data.version = pkg.version;
		fs.writeFileSync(abs, JSON.stringify(data, null, 2) + "\n");
		synced.push(rel);
	}
	return { version: pkg.version, synced };
}

if (require.main === module) {
	const root = path.resolve(__dirname, "..");
	const r = syncVersions(root);
	process.stdout.write(`Synced version ${r.version}:\n`);
	for (const rel of r.synced) process.stdout.write(`  - ${rel}\n`);
	if (r.synced.length === 0) process.stdout.write("  (all manifests already in sync)\n");
}

module.exports = { syncVersions, TARGETS };
