"use strict";

// Removal-completeness guard (issues/0068; spec F075 amendment 2026-09-27).
//
// The two-axis review of 2e4c855 found the removal was declared complete in the
// spec while six *live* surfaces still referenced the removed `agent` / `team` /
// `adoption` commands — no gate caught it, because every gate looked at the
// registry instead of the prose and runtime strings around it. This guard closes
// that gap: live surfaces must not name a removed command family.
//
// Historical provenance (docs/quality/**, docs/product/**, docs/adr/**,
// docs/specs/**, docs/plans/**, docs/examples/**, issues/**) is intentionally
// out of scope — those records describe what was true then (0147 disposition).

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const REMOVED = /amber[ \t]+(agent|team|adoption)\b/;

// Live surfaces: code that runs, rules agents follow, and docs that describe the
// current CLI. Provenance trees are deliberately absent.
const LIVE_ROOTS = [
	"scripts",
	"skills",
	"templates",
	"routes",
	"workflow-packs",
	"standards",
	"profiles",
	"apps/web/src",
	"apps/web/server",
	"apps/docs/docs",
];

const LIVE_FILES = ["AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md", "docs/CLI_REFERENCE.md"];

// Files allowed to NAME a removed command, because naming it is their job.
//  - marker-line: the offending line must itself declare the removal, so a plain
//    instruction ("run amber team install") can never hide behind the allowance.
//  - disposition-table: the §52 table in legacy-core.js lists removed surfaces by
//    design; the guard replaces the marker with a stronger check — it asserts the
//    same rows carry status "removed" (see the second test below).
const ALLOWED_SURFACES = new Map([
	[
		"scripts/lib/harness/legacy-core.js",
		{ mode: "disposition-table", why: "F075 §52 disposition table — where removed surfaces are declared" },
	],
	[
		"apps/docs/docs/about/version-history.md",
		{ mode: "marker-line", why: "the public version-history page documents what was removed" },
	],
	[
		"apps/docs/docs/guides/session-handoff-and-continuity.md",
		{ mode: "marker-line", why: "names the removed command while explaining the current .gitignore advice" },
	],
]);

const REMOVAL_MARKER = /remov|deprecat|→|replaced by|legacy/i;

const SKIP_DIRS = new Set(["node_modules", ".git", "build", ".docusaurus", "dist"]);

function walk(absoluteDir, out = []) {
	let entries;
	try {
		entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name)) continue;
			walk(path.join(absoluteDir, entry.name), out);
		} else if (entry.isFile()) {
			out.push(path.join(absoluteDir, entry.name));
		}
	}
	return out;
}

function scanFile(absolutePath) {
	let text;
	try {
		text = fs.readFileSync(absolutePath, "utf8");
	} catch {
		return [];
	}
	const relative = path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
	const allowance = ALLOWED_SURFACES.get(relative);
	const hits = [];
	text.split("\n").forEach((line, index) => {
		if (!REMOVED.test(line)) return;
		// Disposition-table surfaces are covered by the status assertion below.
		if (allowance && allowance.mode === "disposition-table") return;
		// Marker-line surfaces may only name a removed command on a line that also
		// declares the removal.
		if (allowance && allowance.mode === "marker-line" && REMOVAL_MARKER.test(line)) return;
		hits.push(`${relative}:${index + 1}: ${line.trim().slice(0, 120)}`);
	});
	return hits;
}

function liveSurfaceHits() {
	const hits = [];
	for (const relative of LIVE_ROOTS) {
		for (const file of walk(path.join(REPO_ROOT, relative))) {
			hits.push(...scanFile(file));
		}
	}
	for (const relative of LIVE_FILES) {
		hits.push(...scanFile(path.join(REPO_ROOT, relative)));
	}
	return hits;
}

describe("removed command families leave no live reference", () => {
	it("no live surface names amber agent / team / adoption", () => {
		const hits = liveSurfaceHits();
		assert.deepEqual(
			hits,
			[],
			`live surfaces still reference a removed command family (issues/0068 — spec F075 declares the removal complete):\n${hits.join("\n")}`,
		);
	});

	it("the disposition table keeps every removed family marked removed", () => {
		// The allowance for legacy-core.js is only safe while this holds.
		const { LEGACY_DISPOSITIONS } = require("../../scripts/lib/harness/legacy-core");
		for (const surface of ["agent", "team", "adoption"]) {
			const row = LEGACY_DISPOSITIONS.find((entry) => entry.surface === surface);
			assert.ok(row, `the disposition table must still carry a ${surface} row`);
			assert.match(row.status, /^removed/);
		}
	});

	it("the guard discriminates: an injected reference is reported", () => {
		const probe = path.join(REPO_ROOT, "scripts", "lib", "core", "lifecycle.js");
		const original = fs.readFileSync(probe, "utf8");
		const injected = `${original}\n// probe: amber adoption report --target .\n`;
		try {
			fs.writeFileSync(probe, injected);
			assert.ok(
				scanFile(probe).some((hit) => hit.includes("amber adoption")),
				"an injected removed-command reference must be reported",
			);
		} finally {
			fs.writeFileSync(probe, original);
		}
		assert.deepEqual(scanFile(probe), [], "the probe must leave no residue");
	});
});
