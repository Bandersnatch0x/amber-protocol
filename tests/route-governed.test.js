"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const {
	approveRouteStage,
	verifyRouteLedger,
	executeRouteStage,
	routeLedgerPath,
} = require("../scripts/lib/route-commands");

function tmpRepoWithRoute() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-rt-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\n");
	fs.writeFileSync(path.join(dir, "x.txt"), "hi");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	return dir;
}

function writeHighNpmPolicy(dir) {
	fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "governance", "rules.json"),
		JSON.stringify({
			schemaVersion: 1,
			defaultAction: "deny",
			confidence_gating: {
				enabled: true,
				byRule: { "allow-npm-test": "high" },
				defaultConfidence: "low",
			},
			rules: [{ id: "allow-npm-test", action: "allow", match: "exact", pattern: "npm test" }],
		}),
	);
}

test("approveRouteStage writes an approved ledger record keyed by route:stage", () => {
	const dir = tmpRepoWithRoute();
	const r = approveRouteStage("feature-standard", "verify", dir, "me");
	assert.equal(r.exitCode, 0, r.text);
	const lp = routeLedgerPath(dir, "feature-standard");
	const recs = fs.readFileSync(lp, "utf8").trim().split("\n").map(JSON.parse);
	assert.equal(recs[0].kind, "approved");
	assert.equal(recs[0].approvalKey, "feature-standard:verify");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("approveRouteStage rejects an unknown stage", () => {
	const dir = tmpRepoWithRoute();
	const r = approveRouteStage("feature-standard", "nope", dir, "me");
	assert.equal(r.exitCode, 1);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("verifyRouteLedger reports intact on a fresh ledger", () => {
	const dir = tmpRepoWithRoute();
	approveRouteStage("feature-standard", "verify", dir, "me");
	const r = verifyRouteLedger("feature-standard", dir);
	assert.equal(r.exitCode, 0);
	assert.match(r.text, /intact/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("executeRouteStage without approval is blocked", () => {
	const dir = tmpRepoWithRoute();
	writeHighNpmPolicy(dir);
	const r = executeRouteStage("feature-standard", "verify", dir);
	assert.equal(r.exitCode, 1);
	assert.ok(r.errors.join("\n").includes("AMBER_E_LOOP_NOT_APPROVED"), r.errors.join("\n"));
	fs.rmSync(dir, { recursive: true, force: true });
});

test("executeRouteStage on a non-command stage is rejected", () => {
	const dir = tmpRepoWithRoute();
	const r = executeRouteStage("feature-standard", "capture", dir); // type: skill
	assert.equal(r.exitCode, 1);
	assert.match(r.errors.join("\n"), /command stages/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("approved + allowed route stage executes, main checkout clean, ledger gains executed record", () => {
	const dir = tmpRepoWithRoute();
	writeHighNpmPolicy(dir);
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ scripts: { test: "node -e 0" } }),
	);
	execSync("git add -A && git commit -qm pkg", { cwd: dir });
	approveRouteStage("feature-standard", "verify", dir, "me");
	const r = executeRouteStage("feature-standard", "verify", dir);
	assert.equal(r.exitCode, 0, r.text + JSON.stringify(r.errors));
	const status = execSync("git status --porcelain", { cwd: dir, encoding: "utf8" });
	assert.equal(status.trim(), "", "main checkout untouched");
	const recs = fs
		.readFileSync(routeLedgerPath(dir, "feature-standard"), "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	assert.equal(recs[1].kind, "executed");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("second execute is blocked — one approval, one execution (replay protection)", () => {
	const dir = tmpRepoWithRoute();
	writeHighNpmPolicy(dir);
	fs.writeFileSync(
		path.join(dir, "package.json"),
		JSON.stringify({ scripts: { test: "node -e 0" } }),
	);
	execSync("git add -A && git commit -qm pkg", { cwd: dir });
	approveRouteStage("feature-standard", "verify", dir, "me");
	executeRouteStage("feature-standard", "verify", dir);
	const second = executeRouteStage("feature-standard", "verify", dir);
	assert.equal(second.exitCode, 1);
	assert.ok(second.errors.join("\n").includes("AMBER_E_LOOP_NOT_APPROVED"));
	fs.rmSync(dir, { recursive: true, force: true });
});
