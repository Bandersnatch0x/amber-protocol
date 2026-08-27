"use strict";

// F050 ticket 5 (#230) — public CLI seam coverage for deny-wins Policy
// evaluation. Policy Contracts are admitted through the canonical artifact
// surface; `amber policy evaluate/show/list` consumes the active policy stack,
// consumed Approval, and passing Gate Outcome.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");
const SUBJECT = "spec/login@2";

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-f050t5-${label}-`));
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

function payload(r) {
	const outer = envelope(r);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function policyLedgerPath(dir) {
	return path.join(dir, ".amber", "policies", "outcomes.jsonl");
}

function mustRun(r) {
	assert.equal(r.status, 0, r.stderr || r.stdout);
	return r;
}

function seedPrincipals(dir) {
	for (const [id, kind, role] of [
		["alice@example.com", "human", "approver"],
		["bob@example.com", "human", "verifier"],
		["dev@example.com", "human", "submitter"],
		["manager@example.com", "human", "manager"],
		["ci-bot", "service", "runner"],
	]) {
		mustRun(
			runCli(
				[
					"principal",
					"register",
					"--id",
					id,
					"--kind",
					kind,
					"--role",
					role,
					"--target",
					dir,
					"--json",
				],
				dir,
			),
		);
	}
}

function admitArtifactCli(dir, args) {
	return mustRun(runCli(["artifact", "admit", "--target", dir, ...args, "--json"], dir));
}

function admitActivePolicy(dir, layer, extraExtensions = [], id = `policy/${layer}`) {
	const base = [
		"--type",
		"policy",
		"--id",
		id,
		"--body",
		`# Policy: ${layer}`,
		"--extension",
		"policy.policyVersion=1",
		"--extension",
		`policy.layer=${layer}`,
		...extraExtensions.flatMap((entry) => ["--extension", entry]),
	];
	admitArtifactCli(dir, base);
	admitArtifactCli(dir, [...base, "--expected-head", "1", "--transition", "activate"]);
}

function setupStrictContext(dir) {
	seedPrincipals(dir);
	mustRun(
		runCli(
			[
				"evidence",
				"record",
				"--id",
				"evidence/run-42",
				"--producer",
				"ci-bot",
				"--assurance",
				"observed",
				"--subject",
				SUBJECT,
				"--status",
				"pass",
				"--outputs",
				"ok",
				"--target",
				dir,
				"--json",
			],
			dir,
		),
	);
	mustRun(
		runCli(
			[
				"evidence",
				"verify",
				"--id",
				"evidence/run-42",
				"--verifier",
				"bob@example.com",
				"--target",
				dir,
				"--json",
			],
			dir,
		),
	);
	admitArtifactCli(dir, [
		"--type",
		"gate",
		"--id",
		"gate/login-gate",
		"--body",
		"# Gate: login readiness",
		"--extension",
		`gate.require=[{"evidenceType":"${SUBJECT}","assurance":"verified"}]`,
	]);
	mustRun(
		runCli(
			[
				"gate",
				"evaluate",
				"--gate",
				"gate/login-gate",
				"--subject",
				SUBJECT,
				"--now",
				"2026-08-10T00:00:00.000Z",
				"--target",
				dir,
				"--json",
			],
			dir,
		),
	);
	admitArtifactCli(dir, ["--type", "intent", "--id", "intent/login", "--body", "# Intent: login"]);
	mustRun(
		runCli(
			[
				"approval",
				"grant",
				"--id",
				"approval/login-42",
				"--approver",
				"alice@example.com",
				"--subject",
				SUBJECT,
				"--valid-until",
				"2027-01-01T00:00:00.000Z",
				"--now",
				"2026-08-01T00:00:00.000Z",
				"--target",
				dir,
				"--json",
			],
			dir,
		),
	);
	mustRun(
		runCli(
			[
				"approval",
				"consume",
				"--id",
				"approval/login-42",
				"--decision-identity",
				"decision/login-approved",
				"--body",
				"# Decision: approved",
				"--trace",
				"decides:intent:intent/login@1",
				"--now",
				"2026-08-10T00:00:00.000Z",
				"--target",
				dir,
				"--json",
			],
			dir,
		),
	);
	admitActivePolicy(dir, "org");
	admitActivePolicy(dir, "tenant");
}

function evaluatePolicyCli(dir, extra = []) {
	return runCli(
		[
			"policy",
			"evaluate",
			"--org-policy",
			"policy/org",
			"--tenant-policy",
			"policy/tenant",
			"--subject",
			SUBJECT,
			"--submitter",
			"dev@example.com",
			"--capability",
			"release",
			"--approval",
			"approval/login-42",
			"--gate-outcome-index",
			"0",
			"--now",
			"2026-08-10T00:00:00.000Z",
			...extra,
			"--target",
			dir,
			"--json",
		],
		dir,
	);
}

test("policy evaluate appends a pass outcome; show and list round-trip it", () => {
	const dir = mkTarget("pass");
	setupStrictContext(dir);
	const r = evaluatePolicyCli(dir);
	assert.equal(r.status, 0, r.stderr);
	const outcome = payload(r);
	assert.equal(outcome.verdict, "pass");
	assert.equal(outcome.index, 0);
	assert.equal(outcome.clockSource, "injected");
	assert.equal(outcome.policies.org.identity, "policy/org");
	assert.equal(outcome.policies.tenant.identity, "policy/tenant");
	assert.equal(outcome.approval.status, "consumed");
	assert.equal(outcome.gateOutcome.verdict, "pass");
	assert.deepEqual(outcome.reasons, []);

	const shown = payload(runCli(["policy", "show", "--index", "0", "--target", dir, "--json"], dir));
	assert.equal(shown.hash, outcome.hash);
	const list = payload(runCli(["policy", "list", "--target", dir, "--json"], dir));
	assert.equal(list.length, 1);
	assert.equal(list[0].verdict, "pass");
});

test("a deny rule exits non-zero but returns and appends the deny outcome", () => {
	const dir = mkTarget("deny");
	setupStrictContext(dir);
	admitActivePolicy(dir, "repo", ['policy.rules={"denyCapabilities":["release"]}'], "policy/repo");
	const r = evaluatePolicyCli(dir, ["--repo-policy", "policy/repo"]);
	assert.equal(r.status, 1);
	assert.equal(envelope(r).code, "AMBER_E_POLICY_DENIED");
	const outcome = payload(r);
	assert.equal(outcome.verdict, "deny");
	assert.ok(outcome.reasons.some((reason) => reason.includes("denies capability")));
	assert.equal(fs.existsSync(policyLedgerPath(dir)), true);
});

test("missing required policy and stale policy refuse before any outcome is appended", () => {
	const missing = mkTarget("missing");
	seedPrincipals(missing);
	const r = evaluatePolicyCli(missing);
	assert.equal(r.status, 1);
	assert.equal(envelope(r).code, "AMBER_E_POLICY_MISSING");
	assert.equal(fs.existsSync(policyLedgerPath(missing)), false);

	const stale = mkTarget("stale");
	setupStrictContext(stale);
	admitActivePolicy(stale, "repo", ["policy.validUntil=2026-01-01T00:00:00.000Z"], "policy/repo");
	const expired = evaluatePolicyCli(stale, ["--repo-policy", "policy/repo"]);
	assert.equal(expired.status, 1);
	assert.equal(envelope(expired).code, "AMBER_E_POLICY_STALE");
});

test("policy help is wired", () => {
	const r = runCli(["policy", "--help"], ROOT);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(r.stdout.includes("policy evaluate"));
	assert.ok(r.stdout.includes("--org-policy"));
});
