"use strict";

// F055 T1 (#283) — `amber retention` CLI seam: governed classification,
// deterministic read-only evaluation, fail-closed refusals with stable
// codes, and help registration.

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
const {
	classificationsPath,
	holdsPath,
	candidatesPath,
} = require("../scripts/lib/core/retention-registry");

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
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-retention-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

function fixtureRepo(dir) {
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/login", body: "# L\n" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "policy",
			identity: "policy/tenant-retention",
			body: "# Tenant retention\n",
			extensions: {
				retention: {
					classes: { operational: { ttlMs: 3_600_000, legalBasis: "ops-contract" } },
				},
			},
		}).ok,
		true,
	);
}

function classifyArgs(overrides = {}) {
	const flags = {
		"--record": "intent:intent/login@1",
		"--retention-class": "operational",
		"--policy": "policy/tenant-retention@1",
		...overrides,
	};
	const args = ["retention", "classify", "--target", ".", "--json"];
	for (const [flag, value] of Object.entries(flags)) {
		if (value !== null) args.push(flag, value);
	}
	return args;
}

test("retention classify, classifications, and evaluate form the governed lifecycle", () => {
	const dir = mkTarget("lifecycle");
	fixtureRepo(dir);
	const classified = runCli(classifyArgs(), dir);
	assert.equal(classified.status, 0, classified.stderr || classified.stdout);
	assert.equal(payload(classified).retentionClass, "operational");
	assert.equal(payload(classified).ttlMs, 3_600_000);
	assert.equal(payload(classified).legalBasis, "ops-contract");

	const listed = runCli(["retention", "classifications", "--target", ".", "--json"], dir);
	assert.equal(listed.status, 0, listed.stderr || listed.stdout);
	assert.equal(payload(listed).length, 1);
	assert.equal(payload(listed)[0].current, true);

	const classifiedAt = payload(classified).at;
	const expired = new Date(Date.parse(classifiedAt) + 3_600_000).toISOString();
	const retained = runCli(
		["retention", "evaluate", "--target", ".", "--now", classifiedAt, "--json"],
		dir,
	);
	assert.equal(retained.status, 0, retained.stderr || retained.stdout);
	assert.equal(payload(retained).entries[0].verdict, "retained");
	const eligible = runCli(
		["retention", "evaluate", "--target", ".", "--now", expired, "--json"],
		dir,
	);
	assert.equal(payload(eligible).entries[0].verdict, "expired-eligible");
});

test("retention refusals carry stable codes and never write", () => {
	const dir = mkTarget("refusals");
	fixtureRepo(dir);

	const badRecord = runCli(classifyArgs({ "--record": "intent/login" }), dir);
	assert.equal(badRecord.status, 1);
	assert.equal(envelope(badRecord).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badRecord).errors[0], /--record must be <type>:<identity>@<revision>/);

	const badPolicy = runCli(classifyArgs({ "--policy": "policy/tenant-retention" }), dir);
	assert.equal(badPolicy.status, 1);
	assert.equal(envelope(badPolicy).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badPolicy).errors[0], /--policy must be <identity>@<revision>/);

	const vocabulary = runCli(classifyArgs({ "--retention-class": "forever" }), dir);
	assert.equal(vocabulary.status, 1);
	assert.equal(envelope(vocabulary).code, "AMBER_E_RETENTION_INVALID");

	const unresolvedPolicy = runCli(classifyArgs({ "--policy": "policy/ghost@1" }), dir);
	assert.equal(unresolvedPolicy.status, 1);
	assert.equal(envelope(unresolvedPolicy).code, "AMBER_E_RETENTION_INVALID");
	assert.match(
		envelope(unresolvedPolicy).errors[0],
		/does not resolve to a committed policy artifact revision/,
	);

	const unsafe = runCli(classifyArgs({ "--sensitivity": "personal" }), dir);
	assert.equal(unsafe.status, 1);
	assert.equal(envelope(unsafe).code, "AMBER_E_RETENTION_INVALID");
	assert.match(envelope(unsafe).errors[0], /must be minimized before classification/);
	const minimized = runCli(
		classifyArgs({ "--sensitivity": "personal" }).concat(["--minimized"]),
		dir,
	);
	assert.equal(minimized.status, 0, minimized.stderr || minimized.stdout);
	assert.equal(payload(minimized).minimized, true);

	const ghost = runCli(classifyArgs({ "--record": "intent:intent/ghost@1" }), dir);
	assert.equal(ghost.status, 1);
	assert.equal(envelope(ghost).code, "AMBER_E_RETENTION_NOT_FOUND");

	const truncated = runCli(["retention", "classify", "--target", ".", "--json", "--record"], dir);
	assert.equal(truncated.status, 1);
	assert.equal(envelope(truncated).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(truncated).errors[0], /--record requires a value/);

	const badNow = runCli(
		["retention", "evaluate", "--target", ".", "--now", "yesterday", "--json"],
		dir,
	);
	assert.equal(badNow.status, 1);
	assert.equal(envelope(badNow).code, "AMBER_E_INVALID_ARG");
});

test("retention corrupt ledgers fail reads closed at the CLI seam", () => {
	const dir = mkTarget("corrupt");
	fixtureRepo(dir);
	assert.equal(runCli(classifyArgs(), dir).status, 0);
	fs.appendFileSync(classificationsPath(dir), '{"kind":"classification"}\n');
	const listed = runCli(["retention", "classifications", "--target", ".", "--json"], dir);
	assert.equal(listed.status, 1);
	assert.equal(envelope(listed).code, "AMBER_E_RETENTION_CORRUPT");
	const evaluated = runCli(["retention", "evaluate", "--target", ".", "--json"], dir);
	assert.equal(evaluated.status, 1);
	assert.equal(envelope(evaluated).code, "AMBER_E_RETENTION_CORRUPT");
});

test("retention help and unknown actions route through the shared dispatcher", () => {
	const dir = mkTarget("help");
	const help = runCli(["retention", "--help"], dir);
	assert.equal(help.status, 0, help.stderr);
	assert.match(help.stdout, /classify --record <type>:<identity>@<rev>/);
	assert.match(help.stdout, /evaluate \[--now <iso>\]/);
	assert.match(help.stdout, /hold --id <hold-id>/);
	assert.match(help.stdout, /holder --id <holder-id> --holder-version <v>/);
	assert.match(help.stdout, /candidate --id <candidate-id> \[--now <iso>\]/);
	assert.match(help.stdout, /candidates \[--status <prepared\|authorized>\]/);
	const unknown = runCli(["retention", "delete", "--target", ".", "--json"], dir);
	assert.equal(unknown.status, 1);
	assert.match(
		envelope(unknown).errors[0],
		/retention requires classify, evaluate, classifications, hold, release, holds, holder, holders, candidate, authorize, or candidates/,
	);
});

test("retention holder, candidate, and bounded authorization at the CLI seam", () => {
	const dir = mkTarget("deletion");
	fixtureRepo(dir);
	holdDecisionFixture(dir, ["decision/holder-1"]);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(
		registerAdapter(dir, {
			id: "adapter/store",
			owner: "storage-team",
			adapterVersion: "1",
			recordTypes: [{ type: "canonical-record", versions: ["v1"] }],
			scope: "F055",
			identityMapping: { strategy: "path" },
			freshness: { maxAgeMs: 86_400_000 },
			permissions: { readOnly: true, allowedPaths: ["store"] },
		}).ok,
		true,
	);
	assert.equal(runCli(classifyArgs(), dir).status, 0);

	const holder = runCli(
		[
			"retention",
			"holder",
			"--target",
			".",
			"--id",
			"holder/canonical-body",
			"--holder-version",
			"1",
			"--surface",
			"canonical-body",
			"--adapter",
			"adapter/store",
			"--adapter-version",
			"1",
			"--decision-identity",
			"decision/holder-1",
			"--revision",
			"1",
			"--json",
		],
		dir,
	);
	assert.equal(holder.status, 0, holder.stderr || holder.stdout);
	assert.equal(payload(holder).surface, "canonical-body");
	const holders = runCli(["retention", "holders", "--target", ".", "--json"], dir);
	assert.equal(payload(holders).length, 1);

	const farFuture = "2036-01-01T00:00:00.000Z";
	const candidate = runCli(
		["retention", "candidate", "--target", ".", "--id", "deletion/1", "--now", farFuture, "--json"],
		dir,
	);
	assert.equal(candidate.status, 0, candidate.stderr || candidate.stdout);
	assert.equal(payload(candidate).status, "prepared");
	assert.equal(payload(candidate).records.length, 1);
	const candidateHash = payload(candidate).candidateHash;

	assert.equal(
		grantApproval(
			dir,
			{
				id: "approval/deletion-1",
				approver: "bob@example.com",
				scope: null,
				subject: `retention-deletion:${candidateHash}`,
				validUntil: "2037-01-01T00:00:00.000Z",
			},
			{ now: new Date(Date.now() - 60_000) },
		).ok,
		true,
	);
	const authorized = runCli(
		[
			"retention",
			"authorize",
			"--target",
			".",
			"--id",
			"deletion/1",
			"--approval",
			"approval/deletion-1",
			"--decision-identity",
			"decision/deletion-consume-1",
			"--body",
			"# Authorize deletion",
			"--trace",
			"decides:intent:intent/login",
			"--json",
		],
		dir,
	);
	assert.equal(authorized.status, 0, authorized.stderr || authorized.stdout);
	assert.equal(payload(authorized).status, "authorized");
	assert.equal(payload(authorized).authorization.approvalId, "approval/deletion-1");

	const listed = runCli(
		["retention", "candidates", "--target", ".", "--status", "authorized", "--json"],
		dir,
	);
	assert.equal(payload(listed).length, 1);
	const badStatus = runCli(
		["retention", "candidates", "--target", ".", "--status", "everything", "--json"],
		dir,
	);
	assert.equal(badStatus.status, 1);
	assert.equal(envelope(badStatus).code, "AMBER_E_INVALID_ARG");

	fs.appendFileSync(candidatesPath(dir), '{"kind":"candidate"}\n');
	const corrupt = runCli(["retention", "candidates", "--target", ".", "--json"], dir);
	assert.equal(corrupt.status, 1);
	assert.equal(envelope(corrupt).code, "AMBER_E_RETENTION_CANDIDATE_CORRUPT");
});

function holdDecisionFixture(dir, decisionIdentities) {
	assert.equal(
		registerPrincipal(dir, { id: "legal@example.com", principalKind: "human" }).ok,
		true,
	);
	for (const identity of decisionIdentities) {
		const decision = admitArtifact(dir, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "legal@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/login" } }],
		});
		assert.equal(decision.ok, true, (decision.errors || []).join("; "));
	}
}

test("retention hold overrides expiry and release restores it at the CLI seam", () => {
	const dir = mkTarget("hold");
	fixtureRepo(dir);
	holdDecisionFixture(dir, ["decision/hold-1", "decision/release-1"]);
	assert.equal(runCli(classifyArgs(), dir).status, 0);

	const created = runCli(
		[
			"retention",
			"hold",
			"--target",
			".",
			"--id",
			"hold/litigation-42",
			"--subject",
			"intent/login",
			"--reason",
			"litigation hold",
			"--decision-identity",
			"decision/hold-1",
			"--revision",
			"1",
			"--json",
		],
		dir,
	);
	assert.equal(created.status, 0, created.stderr || created.stdout);
	assert.equal(payload(created).status, "active");
	assert.equal(payload(created).issuer.principal, "legal@example.com");

	const farFuture = "2036-01-01T00:00:00.000Z";
	const held = runCli(
		["retention", "evaluate", "--target", ".", "--now", farFuture, "--json"],
		dir,
	);
	assert.equal(held.status, 0, held.stderr || held.stdout);
	assert.equal(payload(held).entries[0].verdict, "retained-by-hold");
	assert.deepEqual(payload(held).entries[0].heldBy, ["hold/litigation-42"]);

	const scopeless = runCli(
		[
			"retention",
			"hold",
			"--target",
			".",
			"--id",
			"hold/x",
			"--reason",
			"r",
			"--decision-identity",
			"decision/release-1",
			"--revision",
			"1",
			"--json",
		],
		dir,
	);
	assert.equal(scopeless.status, 1);
	assert.equal(envelope(scopeless).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(scopeless).errors[0], /exactly one of --record/);

	const released = runCli(
		[
			"retention",
			"release",
			"--target",
			".",
			"--id",
			"hold/litigation-42",
			"--decision-identity",
			"decision/release-1",
			"--revision",
			"1",
			"--json",
		],
		dir,
	);
	assert.equal(released.status, 0, released.stderr || released.stdout);
	assert.equal(payload(released).status, "released");
	const restored = runCli(
		["retention", "evaluate", "--target", ".", "--now", farFuture, "--json"],
		dir,
	);
	assert.equal(payload(restored).entries[0].verdict, "expired-eligible");

	const again = runCli(
		[
			"retention",
			"release",
			"--target",
			".",
			"--id",
			"hold/litigation-42",
			"--decision-identity",
			"decision/release-1",
			"--revision",
			"1",
			"--json",
		],
		dir,
	);
	assert.equal(again.status, 1);
	assert.equal(envelope(again).code, "AMBER_E_RETENTION_INVALID");
	assert.match(envelope(again).errors[0], /already released/);

	const holds = runCli(["retention", "holds", "--target", ".", "--json"], dir);
	assert.equal(holds.status, 0, holds.stderr || holds.stdout);
	assert.equal(payload(holds).length, 1);
	assert.equal(payload(holds)[0].status, "released");

	// The spent creation Decision can never authorize another hold.
	const spent = runCli(
		[
			"retention",
			"hold",
			"--target",
			".",
			"--id",
			"hold/second",
			"--subject",
			"intent/other",
			"--reason",
			"r",
			"--decision-identity",
			"decision/hold-1",
			"--revision",
			"1",
			"--json",
		],
		dir,
	);
	assert.equal(spent.status, 1);
	assert.equal(envelope(spent).code, "AMBER_E_RETENTION_INVALID");
	assert.match(envelope(spent).errors[0], /single-use across the hold ledger/);

	const badStatus = runCli(
		["retention", "holds", "--target", ".", "--status", "everything", "--json"],
		dir,
	);
	assert.equal(badStatus.status, 1);
	assert.equal(envelope(badStatus).code, "AMBER_E_INVALID_ARG");
	assert.match(envelope(badStatus).errors[0], /--status must be one of active, released/);

	fs.appendFileSync(holdsPath(dir), '{"kind":"hold"}\n');
	const corrupt = runCli(["retention", "holds", "--target", ".", "--json"], dir);
	assert.equal(corrupt.status, 1);
	assert.equal(envelope(corrupt).code, "AMBER_E_RETENTION_HOLD_CORRUPT");
});
