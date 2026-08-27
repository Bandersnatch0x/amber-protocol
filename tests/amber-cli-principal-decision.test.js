"use strict";

// F050 ticket 1 (#226) — public CLI seam coverage for the Principal registry
// and Decision artifacts: `amber principal register/show/list/revoke` and
// `amber artifact admit/show/list --type decision`, always asserted through
// the JSON result envelope with the stable code. The human-only authority
// slot (acceptance/approval may not be carried by a service identity) is the
// fail-closed core of the ticket; validity windows are pinned with fixed past
// and future dates so no clock injection is needed.

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
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-f050t1-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function registerPrincipal(dir, id, extra = []) {
	return runCli(
		["principal", "register", "--id", id, "--kind", "human", ...extra, "--target", dir, "--json"],
		dir,
	);
}

// A Decision must decide exactly one committed artifact revision. The
// cheapest stable subject is an accepted Intent (draft would trip the
// refines lifecycle gate; a Decision itself has no lifecycle gate).
function admitAcceptedIntent(dir) {
	const first = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/subject",
			"--body",
			"# Subject\n",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(first.status, 0, first.stderr);
	const accepted = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/subject",
			"--body",
			"# Subject\n",
			"--expected-head",
			"1",
			"--transition",
			"accept",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(accepted.status, 0, accepted.stderr);
	return payload(accepted).revision;
}

function admitDecision(dir, id, extra) {
	return runCli(
		[
			"artifact",
			"admit",
			"--type",
			"decision",
			"--id",
			id,
			"--body",
			"A decision.\n",
			...extra,
			"--target",
			dir,
			"--json",
		],
		dir,
	);
}

// ── Principal registry: register / show / list / revoke ──

test("principal register echoes the record; show and list round-trip the derived status", () => {
	const dir = mkTarget("register");
	const r = registerPrincipal(dir, "alice@example.com", [
		"--role",
		"tech-lead",
		"--issuer",
		"acme-it",
	]);
	assert.equal(r.status, 0, r.stderr);
	const record = payload(r);
	assert.equal(record.id, "alice@example.com");
	assert.equal(record.principalKind, "human");
	assert.equal(record.role, "tech-lead");
	assert.equal(record.issuer, "acme-it");
	assert.equal(record.revokedAt, null);

	const shown = runCli(
		["principal", "show", "--id", "alice@example.com", "--target", dir, "--json"],
		dir,
	);
	assert.equal(shown.status, 0, shown.stderr);
	assert.equal(payload(shown).status, "active");

	const listed = runCli(["principal", "list", "--target", dir, "--json"], dir);
	assert.equal(listed.status, 0, listed.stderr);
	const entries = payload(listed);
	assert.equal(entries.length, 1);
	assert.equal(entries[0].id, "alice@example.com");
	assert.equal(entries[0].status, "active");
});

test("principal list preserves first-registration order and derives expired and not-yet-valid statuses", () => {
	const dir = mkTarget("statuses");
	registerPrincipal(dir, "a@example.com", ["--valid-to", "2021-01-01"]);
	registerPrincipal(dir, "b@example.com");
	registerPrincipal(dir, "c@example.com", [
		"--valid-from",
		"2030-01-01",
		"--valid-to",
		"2031-01-01",
	]);
	const listed = runCli(["principal", "list", "--target", dir, "--json"], dir);
	assert.equal(listed.status, 0, listed.stderr);
	assert.deepEqual(
		payload(listed).map((e) => [e.id, e.status]),
		[
			["a@example.com", "expired"],
			["b@example.com", "active"],
			["c@example.com", "not-yet-valid"],
		],
	);
});

test("registering the same id twice fails closed; showing an unknown id is its own stable code", () => {
	const dir = mkTarget("dupe");
	assert.equal(registerPrincipal(dir, "alice@example.com").status, 0);
	const dup = registerPrincipal(dir, "alice@example.com");
	assert.equal(dup.status, 1);
	assert.equal(payload(dup).code, "AMBER_E_PRINCIPAL_ALREADY_REGISTERED");

	const missing = runCli(
		["principal", "show", "--id", "ghost@example.com", "--target", dir, "--json"],
		dir,
	);
	assert.equal(missing.status, 1);
	assert.equal(payload(missing).code, "AMBER_E_PRINCIPAL_NOT_FOUND");
});

test("revocation is terminal: binding fails closed and re-revocation is its own stable code", () => {
	const dir = mkTarget("revoke");
	assert.equal(registerPrincipal(dir, "alice@example.com").status, 0);
	const revocation = runCli(
		[
			"principal",
			"revoke",
			"--id",
			"alice@example.com",
			"--reason",
			"left",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(revocation.status, 0, revocation.stderr);
	assert.equal(payload(revocation).revokedReason, "left");

	const shown = runCli(
		["principal", "show", "--id", "alice@example.com", "--target", dir, "--json"],
		dir,
	);
	assert.equal(payload(shown).status, "revoked");

	admitAcceptedIntent(dir);
	const bound = admitDecision(dir, "decision/after-revoke", [
		"--decision-kind",
		"review",
		"--principal",
		"alice@example.com",
		"--trace",
		"decides:intent:intent/subject",
	]);
	assert.equal(bound.status, 1);
	assert.equal(payload(bound).code, "AMBER_E_PRINCIPAL_REVOKED");

	const again = runCli(
		["principal", "revoke", "--id", "alice@example.com", "--target", dir, "--json"],
		dir,
	);
	assert.equal(again.status, 1);
	assert.equal(payload(again).code, "AMBER_E_PRINCIPAL_ALREADY_REVOKED");
});

// ── Decision admission through the artifact seams ──

test("a decision binds a verified human principal and round-trips show and list", () => {
	const dir = mkTarget("decision-happy");
	assert.equal(registerPrincipal(dir, "alice@example.com", ["--role", "tech-lead"]).status, 0);
	admitAcceptedIntent(dir);

	const r = admitDecision(dir, "decision/login-accepted", [
		"--decision-kind",
		"acceptance",
		"--principal",
		"alice@example.com",
		"--trace",
		"decides:intent:intent/subject",
	]);
	assert.equal(r.status, 0, r.stderr);
	const receipt = payload(r);
	assert.equal(receipt.type, "decision");
	assert.equal(receipt.lifecycle, "recorded");
	assert.equal(receipt.decisionKind, "acceptance");

	const shown = runCli(
		[
			"artifact",
			"show",
			"--id",
			"decision/login-accepted",
			"--type",
			"decision",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(shown.status, 0, shown.stderr);
	const entry = payload(shown);
	assert.equal(entry.envelope.decisionKind, "acceptance");
	assert.equal(entry.envelope.lifecycle, "recorded");
	assert.equal(entry.envelope.principal.id, "alice@example.com");
	assert.equal(entry.envelope.principal.principalKind, "human");
	assert.equal(entry.envelope.principal.role, "tech-lead");

	const listed = runCli(["artifact", "list", "--target", dir, "--json"], dir);
	assert.equal(listed.status, 0, listed.stderr);
	const decision = payload(listed).find((e) => e.type === "decision");
	assert.equal(decision.identity, "decision/login-accepted");
	assert.equal(decision.envelope.principal.id, "alice@example.com");
});

test("acceptance and approval are human-only slots; review may be carried by a service identity", () => {
	const dir = mkTarget("human-slot");
	assert.equal(registerPrincipal(dir, "alice@example.com").status, 0);
	const service = runCli(
		["principal", "register", "--id", "ci-bot", "--kind", "service", "--target", dir, "--json"],
		dir,
	);
	assert.equal(service.status, 0, service.stderr);
	admitAcceptedIntent(dir);

	for (const kind of ["acceptance", "approval"]) {
		const refused = admitDecision(dir, `decision/${kind}-by-bot`, [
			"--decision-kind",
			kind,
			"--principal",
			"ci-bot",
			"--trace",
			"decides:intent:intent/subject",
		]);
		assert.equal(refused.status, 1, kind);
		assert.equal(payload(refused).code, "AMBER_E_DECISION_HUMAN_SLOT_REQUIRED", kind);
	}

	const review = admitDecision(dir, "decision/review-by-bot", [
		"--decision-kind",
		"review",
		"--principal",
		"ci-bot",
		"--trace",
		"decides:intent:intent/subject",
	]);
	assert.equal(review.status, 0, review.stderr);
	assert.equal(payload(review).decisionKind, "review");
});

test("an unregistered, expired, or not-yet-valid principal fails closed at admission", () => {
	const dir = mkTarget("validity");
	registerPrincipal(dir, "old@example.com", ["--valid-to", "2021-01-01"]);
	registerPrincipal(dir, "future@example.com", ["--valid-from", "2030-01-01"]);
	admitAcceptedIntent(dir);

	const cases = [
		["decision/unknown", "ghost@example.com", "AMBER_E_PRINCIPAL_NOT_FOUND"],
		["decision/expired", "old@example.com", "AMBER_E_PRINCIPAL_EXPIRED"],
		["decision/early", "future@example.com", "AMBER_E_PRINCIPAL_NOT_YET_VALID"],
	];
	for (const [id, principal, code] of cases) {
		const r = admitDecision(dir, id, [
			"--decision-kind",
			"review",
			"--principal",
			principal,
			"--trace",
			"decides:intent:intent/subject",
		]);
		assert.equal(r.status, 1, `${id}: ${r.stdout}`);
		assert.equal(payload(r).code, code, id);
	}
});

test("a decision without a principal, without a kind, or with an unknown kind fails closed", () => {
	const dir = mkTarget("kind-contract");
	assert.equal(registerPrincipal(dir, "alice@example.com").status, 0);
	admitAcceptedIntent(dir);

	const noPrincipal = admitDecision(dir, "decision/no-principal", [
		"--decision-kind",
		"acceptance",
		"--trace",
		"decides:intent:intent/subject",
	]);
	assert.equal(noPrincipal.status, 1);
	assert.equal(payload(noPrincipal).code, "AMBER_E_DECISION_PRINCIPAL_REQUIRED");

	for (const flags of [[], ["--decision-kind", "signoff", "--principal", "alice@example.com"]]) {
		const r = admitDecision(dir, "decision/bad-kind", [
			...flags,
			"--trace",
			"decides:intent:intent/subject",
		]);
		assert.equal(r.status, 1, r.stdout);
		assert.equal(payload(r).code, "AMBER_E_DECISION_KIND_INVALID");
	}
});

test("decision flags are rejected on non-decision types", () => {
	const dir = mkTarget("flag-scope");
	assert.equal(registerPrincipal(dir, "alice@example.com").status, 0);
	const r = runCli(
		[
			"artifact",
			"admit",
			"--id",
			"intent/plain",
			"--body",
			"# Plain\n",
			"--decision-kind",
			"review",
			"--principal",
			"alice@example.com",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 1);
	assert.equal(payload(r).code, "AMBER_E_INVALID_ARG");
});

test("a decision must decide exactly one committed revision", () => {
	const dir = mkTarget("trace-contract");
	assert.equal(registerPrincipal(dir, "alice@example.com").status, 0);
	admitAcceptedIntent(dir);

	const bare = admitDecision(dir, "decision/no-subject", [
		"--decision-kind",
		"review",
		"--principal",
		"alice@example.com",
	]);
	assert.equal(bare.status, 1);
	assert.equal(payload(bare).code, "AMBER_E_ARTIFACT_TRACE_CARDINALITY");

	const dangling = admitDecision(dir, "decision/dangling", [
		"--decision-kind",
		"review",
		"--principal",
		"alice@example.com",
		"--trace",
		"decides:intent:intent/never-admitted",
	]);
	assert.equal(dangling.status, 1);
	assert.equal(payload(dangling).code, "AMBER_E_ARTIFACT_TRACE_TARGET_NOT_FOUND");
});
