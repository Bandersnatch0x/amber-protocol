"use strict";

// F056 — `amber external` CLI seam: governed effect contract
// registration (T1 #288), request proposals with drift-bound
// authorization (T2 #289), read-only listing, fail-closed refusals with
// stable codes, and help registration.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { admitArtifact } = require("../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../scripts/lib/core/principal-registry");
const { registerAdapter } = require("../scripts/lib/core/adapter-registry");
const { grantApproval } = require("../scripts/lib/core/approval-registry");
const { effectsPath, proposalsPath } = require("../scripts/lib/core/external-registry");

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
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-external-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

function fixtureRepo(dir, decisionIdentities = ["decision/effect-1"]) {
	assert.equal(
		registerPrincipal(dir, { id: "legal@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/external", body: "# X\n" }).ok,
		true,
	);
	for (const identity of decisionIdentities) {
		assert.equal(
			admitArtifact(dir, {
				type: "decision",
				identity,
				body: `# ${identity}\n`,
				decisionKind: "approval",
				principal: "legal@example.com",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
			}).ok,
			true,
		);
	}
	assert.equal(
		registerAdapter(dir, {
			id: "adapter/tracker",
			owner: "platform-team",
			adapterVersion: "1",
			recordTypes: [{ type: "ticket", versions: ["v1"] }],
			scope: "F056",
			identityMapping: { strategy: "path" },
			freshness: { maxAgeMs: 86_400_000 },
			permissions: { readOnly: true, allowedPaths: ["tracker"] },
		}).ok,
		true,
	);
}

function registerArgs(overrides = {}) {
	const flags = {
		"--id": "effect/ticket-comment",
		"--effect-version": "1",
		"--owner": "platform-team",
		"--system": "ticketing",
		"--operation": "comment.create",
		"--external-target": "tracker/amber-protocol",
		"--scope": "issues",
		"--idempotency": "idempotent",
		"--credential": "scoped",
		"--receipt-field": "commentId",
		"--compensation-effect": "effect/ticket-comment-delete",
		"--timeout-ms": "30000",
		"--adapter": "adapter/tracker",
		"--adapter-version": "1",
		"--decision-identity": "decision/effect-1",
		"--revision": "1",
		...overrides,
	};
	const args = ["external", "register", "--target", ".", "--json"];
	for (const [flag, value] of Object.entries(flags)) {
		if (value === true) args.push(flag);
		else if (value !== null) args.push(flag, value);
	}
	return args;
}

test("external register and effects form the governed contract lifecycle", () => {
	const dir = mkTarget("lifecycle");
	fixtureRepo(dir, ["decision/effect-1", "decision/effect-2"]);
	const registered = runCli(registerArgs(), dir);
	assert.equal(registered.status, 0, registered.stderr || registered.stdout);
	assert.equal(payload(registered).id, "effect/ticket-comment");
	assert.equal(payload(registered).version, "1");
	assert.deepEqual(payload(registered).compensation, {
		kind: "effect",
		effect: "effect/ticket-comment-delete",
	});
	assert.equal(payload(registered).decision.principal, "legal@example.com");

	const irreversibleArgs = registerArgs({
		"--id": "effect/announce",
		"--system": "notification",
		"--operation": "message.post",
		"--receipt-field": "messageId",
		"--compensation-effect": null,
		"--irreversible": true,
		"--decision-identity": "decision/effect-2",
	});
	irreversibleArgs.push("--receipt-field", "messageTs");
	const irreversible = runCli(irreversibleArgs, dir);
	assert.equal(irreversible.status, 0, irreversible.stderr || irreversible.stdout);
	assert.deepEqual(payload(irreversible).compensation, { kind: "irreversible" });
	assert.deepEqual(payload(irreversible).receiptFields, ["messageId", "messageTs"]);

	const listed = runCli(["external", "effects", "--target", ".", "--json"], dir);
	assert.equal(listed.status, 0, listed.stderr || listed.stdout);
	assert.equal(payload(listed).length, 2);
	const filtered = runCli(
		["external", "effects", "--target", ".", "--system", "notification", "--json"],
		dir,
	);
	assert.equal(payload(filtered).length, 1);
	assert.equal(payload(filtered)[0].id, "effect/announce");
});

test("external refusals carry stable codes and never write", () => {
	const dir = mkTarget("refusals");
	fixtureRepo(dir);

	const missingId = runCli(registerArgs({ "--id": null }), dir);
	assert.equal(missingId.status, 1);
	assert.equal(envelope(missingId).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(missingId).errors[0], /--id is required/);

	const truncated = runCli(registerArgs().slice(0, -1), dir);
	assert.equal(truncated.status, 1);
	assert.equal(envelope(truncated).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(truncated).errors[0], /--revision requires a value/);

	const noReceipt = runCli(registerArgs({ "--receipt-field": null }), dir);
	assert.equal(noReceipt.status, 1);
	assert.equal(envelope(noReceipt).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(noReceipt).errors[0], /--receipt-field is required at least once/);

	const bothCompensations = runCli(registerArgs({ "--irreversible": true }), dir);
	assert.equal(bothCompensations.status, 1);
	assert.equal(envelope(bothCompensations).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(bothCompensations).errors[0], /exactly one of --compensation-effect/);

	const neitherCompensation = runCli(registerArgs({ "--compensation-effect": null }), dir);
	assert.equal(neitherCompensation.status, 1);
	assert.match(envelope(neitherCompensation).errors[0], /exactly one of --compensation-effect/);

	const badTimeout = runCli(registerArgs({ "--timeout-ms": "soon" }), dir);
	assert.equal(badTimeout.status, 1);
	assert.match(envelope(badTimeout).errors[0], /--timeout-ms must be a positive integer/);

	const smuggled = runCli(registerArgs({ "--external-target": "https://evil.example" }), dir);
	assert.equal(smuggled.status, 1);
	assert.equal(envelope(smuggled).code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(envelope(smuggled).errors[0], /must not carry a URL scheme/);

	const ghostAdapter = runCli(registerArgs({ "--adapter": "adapter/ghost" }), dir);
	assert.equal(ghostAdapter.status, 1);
	assert.equal(envelope(ghostAdapter).code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(envelope(ghostAdapter).errors[0], /is not registered/);

	assert.equal(fs.existsSync(effectsPath(dir)), false);

	const badSystem = runCli(
		["external", "effects", "--target", ".", "--system", "everything", "--json"],
		dir,
	);
	assert.equal(badSystem.status, 1);
	assert.equal(envelope(badSystem).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badSystem).errors[0], /--system must be one of/);
});

test("external effects fails closed on a corrupt ledger", () => {
	const dir = mkTarget("corrupt");
	fixtureRepo(dir);
	assert.equal(runCli(registerArgs(), dir).status, 0);
	fs.appendFileSync(effectsPath(dir), '{"kind":"effect"}\n');
	const corrupt = runCli(["external", "effects", "--target", ".", "--json"], dir);
	assert.equal(corrupt.status, 1);
	assert.equal(envelope(corrupt).code, "AMBER_E_EXTERNAL_CORRUPT");
	const blocked = runCli(
		registerArgs({ "--effect-version": "2", "--decision-identity": "decision/effect-1" }),
		dir,
	);
	assert.equal(blocked.status, 1);
	assert.equal(envelope(blocked).code, "AMBER_E_EXTERNAL_CORRUPT");
});

test("external propose, authorize, and proposals govern the request lifecycle", () => {
	const dir = mkTarget("proposals");
	fixtureRepo(dir, ["decision/effect-1", "decision/effect-2"]);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(runCli(registerArgs(), dir).status, 0);
	const payloadA = `sha256:${"a".repeat(64)}`;
	const proposeArgs = (overrides = {}) => {
		const flags = {
			"--id": "request/1",
			"--effect": "effect/ticket-comment@1",
			"--payload-hash": payloadA,
			...overrides,
		};
		const args = ["external", "propose", "--target", ".", "--json"];
		for (const [flag, value] of Object.entries(flags)) {
			if (value !== null) args.push(flag, value);
		}
		return args;
	};
	const badPin = runCli(proposeArgs({ "--effect": "effect/ticket-comment" }), dir);
	assert.equal(badPin.status, 1);
	assert.equal(envelope(badPin).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badPin).errors[0], /--effect must be <id>@<version>/);

	const proposed = runCli(proposeArgs(), dir);
	assert.equal(proposed.status, 0, proposed.stderr || proposed.stdout);
	const proposedRecord = payload(proposed);
	assert.equal(proposedRecord.status, "proposed");

	const duplicate = runCli(proposeArgs({ "--id": "request/2" }), dir);
	assert.equal(duplicate.status, 1);
	assert.equal(envelope(duplicate).code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(envelope(duplicate).errors[0], /already proposed as "request\/1"/);

	assert.equal(
		grantApproval(dir, {
			id: "approval/external-1",
			approver: "bob@example.com",
			scope: null,
			subject: `external-effect:${proposedRecord.requestHash}`,
			validUntil: "2036-01-01T00:00:00.000Z",
		}).ok,
		true,
	);
	// A changed payload is a different request: its hash never matches
	// the granted approval's binding.
	const changedPayload = runCli(
		proposeArgs({ "--id": "request/2", "--payload-hash": `sha256:${"b".repeat(64)}` }),
		dir,
	);
	assert.equal(changedPayload.status, 0);
	const authorizeArgs = (overrides = {}) => {
		const flags = {
			"--id": "request/1",
			"--approval": "approval/external-1",
			"--decision-identity": "decision/external-consume-1",
			"--body": "# Authorize external effect",
			"--trace": "decides:intent:intent/external",
			...overrides,
		};
		const args = ["external", "authorize", "--target", ".", "--json"];
		for (const [flag, value] of Object.entries(flags)) {
			if (value !== null) args.push(flag, value);
		}
		return args;
	};
	const mismatched = runCli(authorizeArgs({ "--id": "request/2" }), dir);
	assert.equal(mismatched.status, 1);
	assert.equal(envelope(mismatched).code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(envelope(mismatched).errors[0], /not this proposal's binding/);

	const authorized = runCli(authorizeArgs(), dir);
	assert.equal(authorized.status, 0, authorized.stderr || authorized.stdout);
	assert.equal(payload(authorized).status, "authorized");
	assert.equal(payload(authorized).authorization.approvalId, "approval/external-1");

	const listed = runCli(
		["external", "proposals", "--target", ".", "--status", "authorized", "--json"],
		dir,
	);
	assert.equal(payload(listed).length, 1);
	const badStatus = runCli(
		["external", "proposals", "--target", ".", "--status", "everything", "--json"],
		dir,
	);
	assert.equal(badStatus.status, 1);
	assert.equal(envelope(badStatus).code, "AMBER_E_INVALID_ARG");

	// Drift: a new effect version registered after the proposal refuses
	// the remaining request's authorization.
	assert.equal(
		grantApproval(dir, {
			id: "approval/external-2",
			approver: "bob@example.com",
			scope: null,
			subject: `external-effect:${payload(changedPayload).requestHash}`,
			validUntil: "2036-01-01T00:00:00.000Z",
		}).ok,
		true,
	);
	const nextVersion = runCli(
		registerArgs({
			"--effect-version": "2",
			"--decision-identity": "decision/effect-2",
		}),
		dir,
	);
	assert.equal(nextVersion.status, 0, nextVersion.stderr || nextVersion.stdout);
	const drifted = runCli(
		authorizeArgs({ "--id": "request/2", "--approval": "approval/external-2" }),
		dir,
	);
	assert.equal(drifted.status, 1);
	assert.equal(envelope(drifted).code, "AMBER_E_EXTERNAL_DRIFT");

	fs.appendFileSync(proposalsPath(dir), '{"kind":"proposal"}\n');
	const corrupt = runCli(["external", "proposals", "--target", ".", "--json"], dir);
	assert.equal(corrupt.status, 1);
	assert.equal(envelope(corrupt).code, "AMBER_E_EXTERNAL_PROPOSAL_CORRUPT");
});

test("external help and unknown actions route through the shared dispatcher", () => {
	const dir = mkTarget("help");
	const help = runCli(["external", "--help"], dir);
	assert.equal(help.status, 0, help.stderr || help.stdout);
	assert.match(help.stdout, /amber external <register\|effects\|propose\|authorize\|proposals>/);
	assert.match(help.stdout, /--irreversible/);
	assert.match(help.stdout, /--payload-hash/);

	const unknown = runCli(["external", "bogus", "--target", ".", "--json"], dir);
	assert.equal(unknown.status, 1);
	assert.match(
		envelope(unknown).errors[0],
		/external requires register, effects, propose, authorize, or proposals/,
	);
});
