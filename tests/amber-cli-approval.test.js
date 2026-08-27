"use strict";

// F050 ticket 4 (#229) — public CLI seam coverage for Approval records:
// `amber approval grant/revoke/consume/show/list`, always asserted through
// the JSON result envelope with the stable code. The fail-closed core of
// the ticket: one authorization can never be replayed, and consumption is
// atomic with the authorized Decision's settlement.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { GENESIS_HASH, chainHash } = require("../scripts/lib/core/approval-registry");
const { writeJSONL } = require("../scripts/lib/core/jsonl");

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
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-f050t4-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

function seedPrincipals(dir) {
	const alice = runCli(
		[
			"principal",
			"register",
			"--id",
			"alice@example.com",
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
	assert.equal(alice.status, 0, alice.stderr);
	const bob = runCli(
		[
			"principal",
			"register",
			"--id",
			"bob@example.com",
			"--kind",
			"human",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(bob.status, 0, bob.stderr);
}

function grantApproval(dir, id, extra = []) {
	return runCli(
		[
			"approval",
			"grant",
			"--id",
			id,
			"--approver",
			"alice@example.com",
			"--subject",
			"spec/login@2",
			"--valid-until",
			"2027-08-01",
			...extra,
			"--target",
			dir,
			"--json",
		],
		dir,
	);
}

function admitIntent(dir) {
	const r = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/login",
			"--type",
			"intent",
			"--body",
			"# Intent: login flow",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
}

function consumeApproval(dir, id, extra = []) {
	return runCli(
		[
			"approval",
			"consume",
			"--id",
			id,
			"--decision-identity",
			"decision/login-approved",
			"--body",
			"# Decision: login intent approved",
			"--trace",
			"decides:intent:intent/login@1",
			...extra,
			"--target",
			dir,
			"--json",
		],
		dir,
	);
}

// ── grant / show / list round-trip ──

test("approval grant echoes the derived record; show and list round-trip it", () => {
	const dir = mkTarget("round-trip");
	seedPrincipals(dir);
	const r = grantApproval(dir, "approval/login-42", ["--scope", "F050"]);
	assert.equal(r.status, 0, r.stderr);
	const approval = payload(r);
	assert.equal(approval.id, "approval/login-42");
	assert.equal(approval.status, "granted");
	assert.equal(approval.approver.id, "alice@example.com");
	assert.equal(approval.approver.principalKind, "human");
	assert.equal(approval.scope, "F050");
	assert.equal(approval.subject, "spec/login@2");
	assert.equal(approval.validUntil, "2027-08-01");
	assert.equal(approval.validAt, approval.recordedAt);
	assert.equal(approval.revokedAt, null);
	assert.equal(approval.consumedAt, null);

	const shown = payload(
		runCli(["approval", "show", "--id", "approval/login-42", "--target", dir, "--json"], dir),
	);
	assert.equal(shown.id, "approval/login-42");
	assert.equal(shown.status, "granted");

	const list = payload(runCli(["approval", "list", "--target", dir, "--json"], dir));
	assert.equal(list.length, 1);
	assert.equal(list[0].id, "approval/login-42");
});

test("show of an unrecorded id fails closed with the not-found code", () => {
	const dir = mkTarget("show-unknown");
	seedPrincipals(dir);
	const r = runCli(["approval", "show", "--id", "approval/nope", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
	assert.equal(envelope(r).code, "AMBER_E_APPROVAL_NOT_FOUND");
});

// ── The single-use contract at the CLI seam ──

test("consume settles the Decision; a replay is refused with the already-consumed code", () => {
	const dir = mkTarget("consume-replay");
	seedPrincipals(dir);
	admitIntent(dir);
	assert.equal(grantApproval(dir, "approval/login-42").status, 0);

	const consumed = consumeApproval(dir, "approval/login-42");
	assert.equal(consumed.status, 0, consumed.stderr);
	const result = payload(consumed);
	assert.equal(result.approval.status, "consumed");
	assert.equal(result.approval.decisionIdentity, "decision/login-approved");
	assert.equal(result.approval.decisionRevision, result.decision.revision);
	assert.equal(result.decision.decisionKind, "approval");
	assert.equal(result.decision.principal.id, "alice@example.com");

	const replay = consumeApproval(dir, "approval/login-42", [
		"--decision-identity",
		"decision/login-approved-2",
	]);
	assert.equal(replay.status, 1);
	assert.equal(envelope(replay).code, "AMBER_E_APPROVAL_ALREADY_CONSUMED");

	const shown = payload(
		runCli(["approval", "show", "--id", "approval/login-42", "--target", dir, "--json"], dir),
	);
	assert.equal(shown.status, "consumed");
});

test("consume of a revoked approval fails closed; revocation is terminal", () => {
	const dir = mkTarget("consume-revoked");
	seedPrincipals(dir);
	admitIntent(dir);
	assert.equal(grantApproval(dir, "approval/login-42").status, 0);

	const revoked = runCli(
		[
			"approval",
			"revoke",
			"--id",
			"approval/login-42",
			"--revoker",
			"bob@example.com",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(revoked.status, 0, revoked.stderr);
	assert.equal(payload(revoked).status, "revoked");

	const consumed = consumeApproval(dir, "approval/login-42");
	assert.equal(consumed.status, 1);
	assert.equal(envelope(consumed).code, "AMBER_E_APPROVAL_REVOKED");

	const twice = runCli(
		[
			"approval",
			"revoke",
			"--id",
			"approval/login-42",
			"--revoker",
			"bob@example.com",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(twice.status, 1);
	assert.equal(envelope(twice).code, "AMBER_E_APPROVAL_ALREADY_REVOKED");
});

test("consume of an expired approval fails closed with the expiry code", () => {
	const dir = mkTarget("consume-expired");
	seedPrincipals(dir);
	admitIntent(dir);
	// The writer refuses born-expired grants (the window must be non-empty),
	// so a closed window at the CLI seam can only be a stored one: a
	// hand-built chained granted event whose validUntil has passed.
	const grantedBody = {
		kind: "granted",
		schemaVersion: 1,
		at: "2026-01-01T00:00:00.000Z",
		approvalId: "approval/login-42",
		approver: {
			id: "alice@example.com",
			principalKind: "human",
			role: "reviewer",
			membership: null,
			capability: null,
			scope: null,
			validFrom: null,
			validTo: null,
			issuer: null,
		},
		scope: null,
		subject: "spec/login@2",
		validAt: "2026-01-01T00:00:00.000Z",
		validUntil: "2026-01-02T00:00:00.000Z",
		recordedAt: "2026-01-01T00:00:00.000Z",
		clockSource: "injected",
		skewPolicy: "no-tolerance",
	};
	writeJSONL(path.join(dir, ".amber", "approvals", "registry.jsonl"), [
		{ ...grantedBody, prevHash: GENESIS_HASH, hash: chainHash(grantedBody, GENESIS_HASH) },
	]);

	const consumed = consumeApproval(dir, "approval/login-42");
	assert.equal(consumed.status, 1);
	assert.equal(envelope(consumed).code, "AMBER_E_APPROVAL_EXPIRED");

	const shown = payload(
		runCli(["approval", "show", "--id", "approval/login-42", "--target", dir, "--json"], dir),
	);
	assert.equal(shown.status, "expired", "expiry is derived at read, never stored");
});

test("grant requires a human approver; a service principal fails closed", () => {
	const dir = mkTarget("grant-human");
	seedPrincipals(dir);
	const service = runCli(
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
	assert.equal(service.status, 0, service.stderr);

	const r = runCli(
		[
			"approval",
			"grant",
			"--id",
			"approval/login-42",
			"--approver",
			"ci-runner",
			"--subject",
			"spec/login@2",
			"--valid-until",
			"2027-08-01",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1);
	assert.equal(envelope(r).code, "AMBER_E_APPROVAL_HUMAN_SLOT_REQUIRED");

	const ghost = runCli(
		[
			"approval",
			"grant",
			"--id",
			"approval/login-42",
			"--approver",
			"nobody@example.com",
			"--subject",
			"spec/login@2",
			"--valid-until",
			"2027-08-01",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(ghost.status, 1);
	assert.equal(envelope(ghost).code, "AMBER_E_PRINCIPAL_NOT_FOUND");
});

test("a duplicate grant fails closed with its stable code", () => {
	const dir = mkTarget("grant-dup");
	seedPrincipals(dir);
	assert.equal(grantApproval(dir, "approval/login-42").status, 0);
	const dup = grantApproval(dir, "approval/login-42");
	assert.equal(dup.status, 1);
	assert.equal(envelope(dup).code, "AMBER_E_APPROVAL_ALREADY_GRANTED");
});

// ── Arg discipline ──

test("truncated value flags and empty --target fail closed as invalid arguments", () => {
	const dir = mkTarget("arg-discipline");
	seedPrincipals(dir);

	const truncated = runCli(
		[
			"approval",
			"grant",
			"--id",
			"approval/login-42",
			"--approver",
			"alice@example.com",
			"--subject",
			"spec/login@2",
			"--target",
			dir,
			"--json",
			"--valid-until",
		],
		dir,
	);
	assert.equal(truncated.status, 1);
	assert.equal(envelope(truncated).code, "AMBER_E_INVALID_ARG");
	assert.ok(envelope(truncated).errors[0].includes("--valid-until requires a value"));

	const emptyTarget = runCli(
		[
			"approval",
			"grant",
			"--id",
			"approval/login-42",
			"--approver",
			"alice@example.com",
			"--subject",
			"spec/login@2",
			"--valid-until",
			"2027-08-01",
			"--target",
			"  ",
			"--json",
		],
		dir,
	);
	assert.equal(emptyTarget.status, 1);
	assert.equal(envelope(emptyTarget).code, "AMBER_E_INVALID_ARG");

	const badUntil = grantApproval(dir, "approval/login-42", ["--valid-until", "not-a-date"]);
	assert.equal(badUntil.status, 1);
	assert.equal(envelope(badUntil).code, "AMBER_E_INVALID_ARG");
});

test("help lists every approval action with the required flags", () => {
	const r = runCli(["approval", "--help"], ROOT);
	assert.equal(r.status, 0, r.stderr);
	for (const needle of [
		"approval grant",
		"approval revoke",
		"approval consume",
		"approval show",
		"approval list",
		"--approver",
		"--revoker",
		"--valid-until",
		"--decision-identity",
	]) {
		assert.ok(r.stdout.includes(needle), `help should mention ${needle}`);
	}
});
