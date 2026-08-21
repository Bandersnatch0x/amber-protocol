"use strict";

// ADR-0018 §10.3: when a target's .gitignore would hide the scaffolded
// MEMORY.md, `amber init` must surface the explicit re-include advisory
// (governed shared memory — tracked by git by default), not just the generic
// hidden-governance-file warning.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildScaffoldWarnings } = require("../../scripts/lib/core/scaffold");

function mkTarget(gitignoreBody) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-scaffold-adv-"));
	if (gitignoreBody !== null) {
		fs.writeFileSync(path.join(dir, ".gitignore"), gitignoreBody);
	}
	return dir;
}

test("a .gitignore that hides MEMORY.md gets the explicit re-include advisory", () => {
	const target = mkTarget("node_modules/\nMEMORY.md\n");
	const warnings = buildScaffoldWarnings(target, ["MEMORY.md", "AGENTS.md"], [], {});
	assert.ok(
		warnings.some((w) => w.includes("hidden by .gitignore rules")),
		"generic hidden-file warning stays",
	);
	const advisory = warnings.find((w) => w.includes("governed shared memory"));
	assert.ok(advisory, "MEMORY.md advisory is present");
	assert.match(advisory, /!\/MEMORY\.md/);
	assert.match(advisory, /L2 divergence/);
	fs.rmSync(target, { recursive: true, force: true });
});

test("no advisory when MEMORY.md is not among the hidden created files", () => {
	const target = mkTarget("node_modules/\nCLAUDE.md\n");
	const warnings = buildScaffoldWarnings(target, ["MEMORY.md", "CLAUDE.md"], [], {});
	assert.ok(warnings.some((w) => w.includes("hidden by .gitignore rules")));
	assert.ok(
		!warnings.some((w) => w.includes("governed shared memory")),
		"no MEMORY.md advisory without a MEMORY.md conflict",
	);
	fs.rmSync(target, { recursive: true, force: true });
});

test("dry-run installs never emit gitignore advisories", () => {
	const target = mkTarget("MEMORY.md\n");
	const warnings = buildScaffoldWarnings(target, ["MEMORY.md"], [], { dryRun: true });
	assert.deepEqual(warnings, []);
	fs.rmSync(target, { recursive: true, force: true });
});
