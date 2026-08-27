"use strict";

// F050 ticket 2 (#227) — public CLI seam coverage for Evidence receipts and
// the Assurance contract: `amber evidence record/verify/show/list`, always
// asserted through the JSON result envelope with the stable code. The
// fail-closed core of the ticket: "verified" is never recordable, and the
// producer can never verify its own receipt.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-f050t2-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

function seedPrincipals(dir) {
	const producer = runCli(
		[
			"principal",
			"register",
			"--id",
			"ci-runner",
			"--kind",
			"service",
			"--capability",
			"execute",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(producer.status, 0, producer.stderr);
	const reviewer = runCli(
		[
			"principal",
			"register",
			"--id",
			"reviewer-alice",
			"--kind",
			"human",
			"--role",
			"reviewer",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(reviewer.status, 0, reviewer.stderr);
}

function recordEvidence(dir, id, extra = []) {
	return runCli(
		[
			"evidence",
			"record",
			"--id",
			id,
			"--producer",
			"ci-runner",
			"--assurance",
			"observed",
			"--subject",
			"spec/login@2",
			"--status",
			"pass",
			...extra,
			"--target",
			dir,
			"--json",
		],
		dir,
	);
}

// ── record / show / list round-trip ──

test("evidence record echoes the derived receipt; show and list round-trip it", () => {
	const dir = mkTarget("round-trip");
	seedPrincipals(dir);
	const r = runCli(
		[
			"evidence",
			"record",
			"--id",
			"evidence/run-1",
			"--producer",
			"ci-runner",
			"--assurance",
			"replayable",
			"--replay-of",
			"eval.instruction-surface",
			"--subject",
			"eval.instruction-surface",
			"--status",
			"pass",
			"--scope",
			"F050",
			"--input",
			"npm test",
			"--tool",
			"node",
			"--env",
			"os=linux",
			"--env",
			"node=24",
			"--outputs",
			"all evals pass",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	const receipt = payload(r);
	assert.equal(receipt.id, "evidence/run-1");
	assert.equal(receipt.assurance, "replayable");
	assert.equal(receipt.recordedAssurance, "replayable");
	assert.deepEqual(receipt.verifiedBy, []);
	assert.equal(receipt.producer.id, "ci-runner");
	assert.equal(receipt.producer.principalKind, "service");
	assert.equal(receipt.scope, "F050");
	assert.deepEqual(receipt.inputs, ["npm test"]);
	assert.deepEqual(receipt.tools, ["node"]);
	assert.deepEqual(receipt.environment, { os: "linux", node: "24" });
	assert.deepEqual(receipt.outputs, ["all evals pass"]);
	assert.equal(receipt.replayOf, "eval.instruction-surface");
	assert.equal(receipt.status, "pass");

	const shown = payload(
		runCli(["evidence", "show", "--id", "evidence/run-1", "--target", dir, "--json"], dir),
	);
	assert.equal(shown.id, "evidence/run-1");

	const list = payload(runCli(["evidence", "list", "--target", dir, "--json"], dir));
	assert.equal(list.length, 1);
	assert.equal(list[0].id, "evidence/run-1");
});

// ── The Assurance contract at the CLI seam ──

test("record with assurance verified fails closed with its stable code", () => {
	const dir = mkTarget("verified-refused");
	seedPrincipals(dir);
	const r = recordEvidence(dir, "evidence/run-1", ["--assurance", "verified"]);
	assert.equal(r.status, 1);
	const env = envelope(r);
	assert.equal(env.code, "AMBER_E_EVIDENCE_ASSURANCE_FORBIDDEN");
	assert.equal(env.text, "");
	const list = payload(runCli(["evidence", "list", "--target", dir, "--json"], dir));
	assert.deepEqual(list, [], "the refused record wrote nothing");
});

test("a bare replayable claim fails closed at the CLI seam", () => {
	const dir = mkTarget("bare-replayable");
	seedPrincipals(dir);
	const r = runCli(
		[
			"evidence",
			"record",
			"--id",
			"evidence/run-1",
			"--producer",
			"ci-runner",
			"--assurance",
			"replayable",
			"--subject",
			"spec/login@2",
			"--status",
			"pass",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1);
	assert.equal(envelope(r).code, "AMBER_E_EVIDENCE_REPLAY_OF_CONFLICT");
});

test("verify promotes effective assurance; self-verification and unknown ids fail closed", () => {
	const dir = mkTarget("verify");
	seedPrincipals(dir);
	assert.equal(recordEvidence(dir, "evidence/run-1").status, 0);

	const self = runCli(
		[
			"evidence",
			"verify",
			"--id",
			"evidence/run-1",
			"--verifier",
			"ci-runner",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(self.status, 1);
	assert.equal(envelope(self).code, "AMBER_E_EVIDENCE_SELF_VERIFICATION");

	const verified = runCli(
		[
			"evidence",
			"verify",
			"--id",
			"evidence/run-1",
			"--verifier",
			"reviewer-alice",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(verified.status, 0, verified.stderr);
	const receipt = payload(verified);
	assert.equal(receipt.assurance, "verified");
	assert.equal(receipt.recordedAssurance, "observed", "the stored claim is untouched");
	assert.equal(receipt.verifiedBy.length, 1);
	assert.equal(receipt.verifiedBy[0].verifier.id, "reviewer-alice");
	assert.equal(receipt.verifiedBy[0].verifier.principalKind, "human");

	const unrecorded = runCli(
		[
			"evidence",
			"verify",
			"--id",
			"evidence/ghost",
			"--verifier",
			"reviewer-alice",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(unrecorded.status, 1);
	assert.equal(envelope(unrecorded).code, "AMBER_E_EVIDENCE_NOT_FOUND");
});

// ── Argument discipline ──

test("record requires its core flags and refuses malformed env entries", () => {
	const dir = mkTarget("arg-discipline");
	seedPrincipals(dir);
	const noAssurance = runCli(
		[
			"evidence",
			"record",
			"--id",
			"evidence/run-1",
			"--producer",
			"ci-runner",
			"--subject",
			"spec/login@2",
			"--status",
			"pass",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(noAssurance.status, 1);
	assert.equal(envelope(noAssurance).code, "AMBER_E_INVALID_ARG");

	const badEnv = recordEvidence(dir, "evidence/run-1", ["--env", "noequals"]);
	assert.equal(badEnv.status, 1);
	const env = envelope(badEnv);
	assert.equal(env.code, "AMBER_E_INVALID_ARG");
	assert.ok(env.errors[0].includes("--env"), env.errors[0]);

	const dupeEnv = recordEvidence(dir, "evidence/run-1", ["--env", "a=1", "--env", "a=2"]);
	assert.equal(dupeEnv.status, 1);
	assert.ok(envelope(dupeEnv).errors[0].includes("more than once"));

	const unregistered = runCli(
		[
			"evidence",
			"record",
			"--id",
			"evidence/run-1",
			"--producer",
			"ghost-bot",
			"--assurance",
			"observed",
			"--subject",
			"spec/login@2",
			"--status",
			"pass",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(unregistered.status, 1);
	assert.equal(envelope(unregistered).code, "AMBER_E_PRINCIPAL_NOT_FOUND");

	assert.equal(
		payload(runCli(["evidence", "list", "--target", dir, "--json"], dir)).length,
		0,
		"no refused write touched the ledger",
	);
});

test("a duplicate evidence id fails closed; show of an unknown id is NOT_FOUND", () => {
	const dir = mkTarget("duplicate");
	seedPrincipals(dir);
	assert.equal(recordEvidence(dir, "evidence/run-1").status, 0);
	const dupe = recordEvidence(dir, "evidence/run-1", ["--status", "fail"]);
	assert.equal(dupe.status, 1);
	assert.equal(envelope(dupe).code, "AMBER_E_EVIDENCE_ALREADY_RECORDED");

	const show = runCli(
		["evidence", "show", "--id", "evidence/nope", "--target", dir, "--json"],
		dir,
	);
	assert.equal(show.status, 1);
	assert.equal(envelope(show).code, "AMBER_E_EVIDENCE_NOT_FOUND");
});

test("an empty --target is refused, never silently falling back to the CWD", () => {
	const dir = mkTarget("empty-target");
	seedPrincipals(dir);
	const r = recordEvidence(dir, "evidence/run-1").status;
	assert.equal(r, 0);
	const empty = runCli(
		[
			"evidence",
			"record",
			"--id",
			"evidence/run-2",
			"--producer",
			"ci-runner",
			"--assurance",
			"observed",
			"--subject",
			"x",
			"--status",
			"pass",
			"--target",
			"  ",
			"--json",
		],
		dir,
	);
	assert.equal(empty.status, 1);
	assert.equal(envelope(empty).code, "AMBER_E_INVALID_ARG");
	assert.ok(envelope(empty).errors[0].includes("--target"));
});
