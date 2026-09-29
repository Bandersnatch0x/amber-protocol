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

const TARGETS = [
	".claude-plugin/plugin.json",
	".claude-plugin/settings.json",
	".codex-plugin/plugin.json",
];

function syncJson(root, rel, update) {
	const abs = path.join(root, rel);
	if (!fs.existsSync(abs)) return false;
	const text = fs.readFileSync(abs, "utf8");
	const indent = text.match(/\n([\t ]+)"/)?.[1] || "\t";
	const draft = JSON.parse(text);
	if (!update(draft)) return false;
	fs.writeFileSync(abs, patchJsonText(text, draft, indent));
	return true;
}

// Collect the scalar values that differ between the committed document and the
// updated one, keyed by their JSON key name (the unit a textual patch can
// address without knowing the path).
function changedScalars(before, after, acc = new Map()) {
	if (Array.isArray(before) && Array.isArray(after)) {
		after.forEach((value, index) => changedScalars(before[index], value, acc));
		return acc;
	}
	if (before && after && typeof before === "object" && typeof after === "object") {
		for (const key of Object.keys(after)) {
			const previous = before[key];
			const next = after[key];
			if (next && typeof next === "object") changedScalars(previous, next, acc);
			else if (previous !== next) acc.set(key, { from: previous, to: next });
		}
	}
	return acc;
}

// Apply an updated document by rewriting ONLY the values that changed, in the
// bytes that are already there. Re-serializing the whole document instead
// normalizes its formatting: `JSON.stringify` expands every array, while
// prettier keeps a short one inline, so a version bump rewrote
// `"skills": ["./skills/"]` across three lines and `npm run format:check`
// rejected .claude-plugin/plugin.json — on the release commit itself.
// `syncReadme` already patches its version badge textually for the same reason:
// never rewrite more than the value you came to change.
function patchJsonText(text, draft, indent) {
	const before = JSON.parse(text);
	let patched = text;
	for (const [key, { from, to }] of changedScalars(before, draft)) {
		const escape = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(`("${escape(key)}"\\s*:\\s*)${escape(JSON.stringify(from))}`, "g");
		patched = patched.replace(re, (_match, prefix) => prefix + JSON.stringify(to));
	}
	// Fail-safe: if the byte-level patch did not reproduce the intended document
	// (an unexpected shape, or a duplicate key holding a different value), fall
	// back to a full re-serialization. Formatting drift is a lint failure; a
	// wrong version is a release failure.
	try {
		if (JSON.stringify(JSON.parse(patched)) === JSON.stringify(draft)) return patched;
	} catch {
		/* fall through to the re-serialized document */
	}
	return `${JSON.stringify(draft, null, indent)}\n`;
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
// text never drifts between releases (it is not a static manifest JSON). Both
// language editions carry the badge, so both are synced: a badge updated in one
// file and not the other is a quiet claim about which version the reader has.
const README_FILES = ["README.md", "README.zh-CN.md"];

function syncReadmes(root, version) {
	const synced = [];
	for (const rel of README_FILES) {
		const abs = path.join(root, rel);
		if (!fs.existsSync(abs)) continue;
		const text = fs.readFileSync(abs, "utf8");
		const re = /(\*\*Version:\*\*\s*)\d+\.\d+\.\d+/;
		if (!re.test(text)) continue;
		const updated = text.replace(re, `$1${version}`);
		if (updated === text) continue;
		fs.writeFileSync(abs, updated);
		synced.push(rel);
	}
	return synced;
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
	for (const rel of syncReadmes(root, pkg.version)) synced.push(rel);
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
