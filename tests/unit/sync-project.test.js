"use strict";

// Unit tests for scripts/lib/core/sync-project.js.
// Pins syncProject surface and note semantics: unavailable artifact must NOT
// fall through to the misleading "none detected" aligned message.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");

const { syncProject } = require("../../scripts/lib/core/sync-project");
const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
const { TEMPLATE_ROOT } = require("../../scripts/lib/core/constants");

const ALIGNED_NOTE =
	"Artifact drift: none detected. (aligned = code not newer than evidence; not a re-verification)";
const DRIFTED_RE =
	/Artifact drift:\s*\d+\s+drifted.*re-verify.*feature verify/i;

function copyTemplates() {
	const tpl = fs.mkdtempSync(path.join(os.tmpdir(), "amber-sync-proj-tpl-"));
	fs.cpSync(TEMPLATE_ROOT, tpl, { recursive: true });
	return tpl;
}

function installHarnessed(tpl) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-sync-proj-"));
	scaffoldHarness(dir, { templateRoot: tpl });
	return dir;
}

function gitInit(dir) {
	execSync("git init -q && git config user.email a@b.c && git config user.name t", {
		cwd: dir,
	});
}

function rmTree(...dirs) {
	for (const d of dirs) {
		if (d) fs.rmSync(d, { recursive: true, force: true });
	}
}

test("note drifted: artifact.available && counts.drifted>0 -> note matches drifted re-verify message", () => {
	const tpl = copyTemplates();
	const dir = installHarnessed(tpl);
	try {
		gitInit(dir);
		fs.mkdirSync(path.join(dir, "src"), { recursive: true });
		fs.writeFileSync(path.join(dir, "src", "a.js"), "x");
		execSync("git add -A && git commit -qm add-src", { cwd: dir });

		const featureList = JSON.parse(
			fs.readFileSync(path.join(dir, "feature_list.json"), "utf8"),
		);
		featureList.features.push({
			id: "F900",
			priority: 2,
			area: "test",
			title: "Drifted feature",
			user_visible_behavior: "b",
			status: "passing",
			verification: ["v"],
			paths: ["src/a.js"],
			evidence: [{ command: "c", result: "pass", date: "2020-01-01" }],
			notes: [],
		});
		fs.writeFileSync(
			path.join(dir, "feature_list.json"),
			JSON.stringify(featureList, null, 2),
		);

		const result = syncProject(dir, { execute: false, templateRoot: tpl });
		assert.ok(result.artifact && result.artifact.available === true);
		assert.ok(result.artifact.counts.drifted > 0);
		assert.match(result.note, DRIFTED_RE);
		assert.ok(
			!/none detected/i.test(result.note),
			"drifted note must not use the aligned fallthrough",
		);
	} finally {
		rmTree(tpl, dir);
	}
});

test("note aligned: no drift -> aligned = code not newer than evidence message", () => {
	const tpl = copyTemplates();
	const dir = installHarnessed(tpl);
	try {
		gitInit(dir);
		fs.mkdirSync(path.join(dir, "src"), { recursive: true });
		fs.writeFileSync(path.join(dir, "src", "a.js"), "x");
		execSync("git add -A && git commit -qm add-src", { cwd: dir });

		const featureList = JSON.parse(
			fs.readFileSync(path.join(dir, "feature_list.json"), "utf8"),
		);
		featureList.features.push({
			id: "F901",
			priority: 2,
			area: "test",
			title: "Aligned feature",
			user_visible_behavior: "b",
			status: "passing",
			verification: ["v"],
			paths: ["src/a.js"],
			// Far-future evidence => commit is not newer than evidence => aligned
			evidence: [{ command: "c", result: "pass", date: "2099-01-01" }],
			notes: [],
		});
		fs.writeFileSync(
			path.join(dir, "feature_list.json"),
			JSON.stringify(featureList, null, 2),
		);

		const result = syncProject(dir, { execute: false, templateRoot: tpl });
		assert.ok(result.artifact && result.artifact.available === true);
		assert.equal(result.artifact.counts.drifted, 0);
		assert.equal(result.note, ALIGNED_NOTE);
	} finally {
		rmTree(tpl, dir);
	}
});

test("note unavailable non-git: explicit not-available note, not none-detected fallthrough", () => {
	const tpl = copyTemplates();
	const dir = installHarnessed(tpl);
	try {
		// No git init — detector returns available:false (non-git)
		const result = syncProject(dir, { execute: false, templateRoot: tpl });
		assert.ok(result.artifact && result.artifact.available === false);
		assert.match(result.note, /not available|n\/a|unavailable|non-git/i);
		assert.ok(
			!/none detected/i.test(result.note),
			"unavailable must not fall through to aligned 'none detected'",
		);
	} finally {
		rmTree(tpl, dir);
	}
});

test("note unavailable product-repo: explicit not-available note, not none-detected fallthrough", () => {
	const tpl = copyTemplates();
	const dir = installHarnessed(tpl);
	try {
		gitInit(dir);
		// product-repo signals used by classifyTarget
		fs.writeFileSync(path.join(dir, "SPEC.md"), "s");
		fs.writeFileSync(path.join(dir, "ROADMAP.md"), "r");
		fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
		fs.writeFileSync(path.join(dir, "scripts", "amber.js"), "#");
		fs.mkdirSync(path.join(dir, "templates"), { recursive: true });
		execSync("git add -A && git commit -qm product", { cwd: dir });

		const result = syncProject(dir, { execute: false, templateRoot: tpl });
		assert.ok(result.artifact && result.artifact.available === false);
		assert.match(result.note, /not available|n\/a|unavailable|product-repo/i);
		assert.ok(
			!/none detected/i.test(result.note),
			"unavailable must not fall through to aligned 'none detected'",
		);
	} finally {
		rmTree(tpl, dir);
	}
});

test("note unavailable missing feature_list.json: explicit not-available note, not none-detected fallthrough", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-sync-proj-nofeat-"));
	try {
		gitInit(dir);
		fs.writeFileSync(path.join(dir, "README.md"), "x");
		execSync("git add -A && git commit -qm init", { cwd: dir });
		// No feature_list.json

		const result = syncProject(dir, { execute: false });
		assert.ok(result.artifact && result.artifact.available === false);
		assert.match(
			result.note,
			/not available|n\/a|unavailable|feature_list|not found|unreadable/i,
		);
		assert.ok(
			!/none detected/i.test(result.note),
			"unavailable must not fall through to aligned 'none detected'",
		);
	} finally {
		rmTree(dir);
	}
});

test("execute=false -> refresh is null; execute=true -> refresh populated", () => {
	const tpl = copyTemplates();
	const dir = installHarnessed(tpl);
	try {
		const dry = syncProject(dir, { execute: false, templateRoot: tpl });
		assert.equal(dry.refresh, null, "dry-run must leave refresh null");

		// Make a controlled file stale so execute path has work (still returns a refresh object even if empty arrays)
		const rel = "docs/wiki/glossary.md";
		const shipped = path.join(tpl, rel);
		if (fs.existsSync(shipped)) {
			fs.writeFileSync(
				shipped,
				fs.readFileSync(shipped, "utf8") + "\n# sync-project red\n",
			);
		}

		const execResult = syncProject(dir, { execute: true, templateRoot: tpl });
		assert.ok(execResult.refresh != null, "execute must populate refresh");
		assert.ok(Array.isArray(execResult.refresh.refreshed));
		assert.ok(Array.isArray(execResult.refresh.proposals));
	} finally {
		rmTree(tpl, dir);
	}
});
