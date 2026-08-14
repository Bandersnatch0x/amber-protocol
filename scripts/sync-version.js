"use strict";

// Single-source-of-truth version sync. package.json is the only file whose
// `version` is hand-edited; this script copies it into every package and plugin
// manifest that consumers read directly, plus the root lockfile.
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

const TARGETS = [".claude-plugin/plugin.json", ".codex-plugin/plugin.json"];

function syncJson(root, rel, update) {
	const abs = path.join(root, rel);
	if (!fs.existsSync(abs)) return false;
	const text = fs.readFileSync(abs, "utf8");
	const data = JSON.parse(text);
	if (!update(data)) return false;
	const indent = text.match(/\n([\t ]+)"/)?.[1] || "\t";
	fs.writeFileSync(abs, `${JSON.stringify(data, null, indent)}\n`);
	return true;
}

function syncPackageLock(root, version) {
	return syncJson(root, "package-lock.json", (lock) => {
		let changed = false;
		if (lock.version !== version) {
			lock.version = version;
			changed = true;
		}
		if (lock.packages?.[""] && lock.packages[""].version !== version) {
			lock.packages[""].version = version;
			changed = true;
		}
		return changed;
	});
}

function syncDshPackage(root, version) {
	return syncJson(root, "dsh/package.json", (dshPackage) => {
		let changed = false;
		if (dshPackage.version !== version) {
			dshPackage.version = version;
			changed = true;
		}
		if (
			dshPackage.dependencies?.["amber-protocol"] &&
			dshPackage.dependencies["amber-protocol"] !== `^${version}`
		) {
			dshPackage.dependencies["amber-protocol"] = `^${version}`;
			changed = true;
		}
		return changed;
	});
}

// README carries a human-readable version badge (e.g. "**Version:** 1.3.4").
// Keep it in lockstep with package.json via regex replacement so the badge
// text never drifts between releases (it is not a static manifest JSON).
function syncReadme(root, version) {
	const abs = path.join(root, "README.md");
	if (!fs.existsSync(abs)) return false;
	const text = fs.readFileSync(abs, "utf8");
	const re = /(\*\*Version:\*\*\s*)\d+\.\d+\.\d+/;
	if (!re.test(text)) return false;
	const updated = text.replace(re, `$1${version}`);
	if (updated === text) return false;
	fs.writeFileSync(abs, updated);
	return true;
}

function syncVersions(root) {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	if (!pkg || typeof pkg.version !== "string" || pkg.version.trim() === "") {
		throw new Error("package.json has no usable `version` field.");
	}
	const synced = [];
	for (const rel of TARGETS) {
		if (
			syncJson(root, rel, (data) => {
				if (data.version === pkg.version) return false;
				data.version = pkg.version;
				return true;
			})
		) {
			synced.push(rel);
		}
	}
	if (syncPackageLock(root, pkg.version)) synced.push("package-lock.json");
	if (syncDshPackage(root, pkg.version)) synced.push("dsh/package.json");
	if (syncReadme(root, pkg.version)) {
		synced.push("README.md");
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
