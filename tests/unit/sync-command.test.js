"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { dispatch } = require("../../scripts/lib/command-dispatcher");
const { scaffoldHarness } = require("../../scripts/lib/core/scaffold");
const { detectScaffoldDrift } = require("../../scripts/lib/core/scaffold-version-drift");
const { TEMPLATE_ROOT } = require("../../scripts/lib/core/constants");

const REL = "docs/wiki/glossary.md"; // controlled file

// parseArgs shim mirroring the {target, _, execute, json, templateRoot} shape dispatch reads.
// --template-root threads the fixture's template copy through to handleSync (which
// forwards args.templateRoot to detectScaffoldDrift/refreshAmberOwnedFiles), so the
// mutated fixture template — not the real TEMPLATE_ROOT — is the drift source.
function parseArgs(argv) {
	const args = { target: process.cwd(), _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--target") {
			args.target = argv[++i];
			continue;
		}
		if (a === "--execute") {
			args.execute = true;
			continue;
		}
		if (a === "--json") {
			args.json = true;
			continue;
		}
		if (a === "--template-root") {
			args.templateRoot = argv[++i];
			continue;
		}
		args._.push(a);
	}
	return args;
}

// Copy templates to a temp fixture (parallel-safe; do NOT mutate real templates).
function fixture() {
	const tpl = fs.mkdtempSync(path.join(os.tmpdir(), "amber-sync-tpl-"));
	fs.cpSync(TEMPLATE_ROOT, tpl, { recursive: true });
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-sync-"));
	scaffoldHarness(dir, { templateRoot: tpl }); // install + provenance (baseline = shipped copy)
	return { tpl, dir };
}

test("sync dry-run reports the plan and makes NO filesystem changes", () => {
	const { tpl, dir } = fixture();
	try {
		// Ship a new controlled template version → one stale controlled file.
		fs.writeFileSync(
			path.join(tpl, REL),
			fs.readFileSync(path.join(tpl, REL), "utf8") + "\n# new\n",
		);
		const installedPath = path.join(dir, REL);
		const before = fs.readFileSync(installedPath, "utf8");
		const { result, exitCode } = dispatch(
			"sync",
			parseArgs(["--target", dir, "--template-root", tpl]),
		);
		assert.equal(exitCode ?? 0, 0);
		// The plan reports the one stale controlled file (guards against garbage counts).
		assert.match(result.text, /stale=1/);
		// No changes made.
		assert.equal(fs.readFileSync(installedPath, "utf8"), before, "dry-run did not touch files");
		assert.ok(!fs.existsSync(installedPath + ".bak"), "no backup created in dry-run");
		// Plan + artifact note surfaced.
		assert.match(result.text, /dry-run/i);
		assert.match(result.text, /Artifact drift/i);
	} finally {
		fs.rmSync(tpl, { recursive: true, force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("sync --execute overwrites the stale controlled file and re-stamps (detector then fresh)", () => {
	const { tpl, dir } = fixture();
	try {
		fs.writeFileSync(
			path.join(tpl, REL),
			fs.readFileSync(path.join(tpl, REL), "utf8") + "\n# new\n",
		);
		const installedPath = path.join(dir, REL);
		const { result } = dispatch(
			"sync",
			parseArgs(["--target", dir, "--template-root", tpl, "--execute"]),
		);
		assert.ok(fs.readFileSync(installedPath, "utf8").includes("# new"), "stale file overwritten");
		assert.ok(fs.existsSync(installedPath + ".bak"), "backed up");
		// Detector now classifies the refreshed file as fresh (provenance re-stamped).
		// Compare against the SAME fixture template source used everywhere else.
		const drift = detectScaffoldDrift(dir, { templateRoot: tpl });
		assert.equal(drift.files.find((f) => f.path === REL).classification, "fresh");
		assert.match(result.text, /execute/i);
		assert.match(result.text, /Artifact drift/i);
	} finally {
		fs.rmSync(tpl, { recursive: true, force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("sync never resolves artifact drift (flags it as SP2)", () => {
	const { tpl, dir } = fixture();
	try {
		const { result } = dispatch("sync", parseArgs(["--target", dir]));
		assert.match(result.text, /Artifact drift/i);
	} finally {
		fs.rmSync(tpl, { recursive: true, force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("sync note reflects drifted count when artifact drift present", () => {
	const { tpl, dir } = fixture();
	try {
		execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
		fs.mkdirSync(path.join(dir, "src"), { recursive: true });
		fs.writeFileSync(path.join(dir, "src", "a.js"), "x");
		execSync("git add -A && git commit -qm add-src", { cwd: dir });
		const featureList = JSON.parse(fs.readFileSync(path.join(dir, "feature_list.json"), "utf8"));
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
		fs.writeFileSync(path.join(dir, "feature_list.json"), JSON.stringify(featureList, null, 2));
		const { result } = dispatch("sync", parseArgs(["--target", dir]));
		assert.match(result.text, /Artifact drift:.*drifted.*feature verify/);
	} finally {
		fs.rmSync(tpl, { recursive: true, force: true });
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
