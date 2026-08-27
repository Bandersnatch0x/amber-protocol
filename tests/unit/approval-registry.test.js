"use strict";

// F050 ticket 4 (#229) — Approval records: atomicity & lifecycle (unit seam).
//
// Tests assert externally visible behavior of the approval core: the
// human-only approver/revoker slots verified against the Principal registry,
// the half-open validity window [validAt, validUntil) with the recorded
// clock source and no-tolerance skew policy, the append-only
// granted/revoked/consumed event ledger with its hash chain and write lock,
// the size ceiling with env override, single-use consumption atomic with the
// authorized Decision's settlement, and fail-closed corruption handling —
// every failure mode carries a stable AMBER_E_* code.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	APPROVAL_SCHEMA_VERSION,
	SUPPORTED_APPROVAL_SCHEMA_VERSIONS,
	SKEW_POLICY,
	CLOCK_SOURCES,
	DEFAULT_MAX_APPROVAL_BYTES,
	GENESIS_HASH,
	chainHash,
	grantApproval,
	revokeApproval,
	consumeApproval,
	showApproval,
	listApprovals,
} = require("../../scripts/lib/core/approval-registry");
const { registerPrincipal, revokePrincipal } = require("../../scripts/lib/core/principal-registry");
const { admitArtifact, showArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { writeJSONL } = require("../../scripts/lib/core/jsonl");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-approval-${label}-`));
}

function ledgerPathOf(dir) {
	return path.join(dir, ".amber", "approvals", "registry.jsonl");
}

function readLedger(dir) {
	return fs
		.readFileSync(ledgerPathOf(dir), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
}

/**
 * Chain a sequence of hand-built ledger bodies the way the writers do: each
 * event binds the previous event's hash (the genesis constant first), and the
 * event's own hash covers its full canonical content. Fixtures for verdicts
 * the fold checks AFTER the chain walk must arrive chained or they trip the
 * chain verification instead of the verdict under test.
 */
function withChain(events) {
	let prevHash = GENESIS_HASH;
	return events.map((event) => {
		const hash = chainHash(event, prevHash);
		const chained = { ...event, prevHash, hash };
		prevHash = hash;
		return chained;
	});
}

/**
 * A writer-shaped stored granted event for hand-built ledger fixtures: the
 * grant writer always emits the FULL closed field set, so a stored event
 * missing a field is corruption in its own right — fixtures for other
 * verdicts must match the writer's shape or they trip the stored-shape check
 * before the verdict under test fires.
 */
function storedGranted(overrides = {}) {
	return {
		kind: "granted",
		schemaVersion: APPROVAL_SCHEMA_VERSION,
		at: "2026-08-01T00:00:00.000Z",
		approvalId: "approval/fixture-1",
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
		validAt: "2026-08-01T00:00:00.000Z",
		validUntil: "2027-08-01T00:00:00.000Z",
		recordedAt: "2026-08-01T00:00:00.000Z",
		clockSource: "injected",
		skewPolicy: SKEW_POLICY,
		...overrides,
	};
}

function revokedEvent(approvalId, revokerId = "bob@example.com", at = "2026-08-02T00:00:00.000Z") {
	return {
		kind: "revoked",
		schemaVersion: APPROVAL_SCHEMA_VERSION,
		at,
		approvalId,
		revoker: {
			id: revokerId,
			principalKind: "human",
			role: null,
			membership: null,
			capability: null,
			scope: null,
			validFrom: null,
			validTo: null,
			issuer: null,
		},
		clockSource: "injected",
	};
}

function consumedEvent(
	approvalId,
	decisionIdentity = "decision/fixture-1",
	decisionRevision = 1,
	at = "2026-08-03T00:00:00.000Z",
) {
	return {
		kind: "consumed",
		schemaVersion: APPROVAL_SCHEMA_VERSION,
		at,
		approvalId,
		decisionIdentity,
		decisionRevision,
		clockSource: "injected",
		skewPolicy: SKEW_POLICY,
	};
}

function seedPrincipals(dir) {
	const alice = registerPrincipal(dir, {
		id: "alice@example.com",
		principalKind: "human",
		role: "reviewer",
	});
	const bob = registerPrincipal(dir, {
		id: "bob@example.com",
		principalKind: "human",
	});
	const service = registerPrincipal(dir, {
		id: "ci-runner",
		principalKind: "service",
		capability: "execute",
	});
	assert.equal(alice.ok, true, (alice.errors || []).join("; "));
	assert.equal(bob.ok, true, (bob.errors || []).join("; "));
	assert.equal(service.ok, true, (service.errors || []).join("; "));
}

/** Grant one approval under an injected clock; asserts success. */
function grantFixture(dir, id = "approval/login-42", overrides = {}, opts = {}) {
	const result = grantApproval(
		dir,
		{
			id,
			approver: "alice@example.com",
			scope: null,
			subject: "spec/login@2",
			validUntil: "2027-08-01T00:00:00.000Z",
			...overrides,
		},
		{ now: new Date("2026-08-01T00:00:00.000Z"), ...opts },
	);
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	return result;
}

/** Admit one committed intent for decides Traces; asserts success. */
function admitIntentFixture(dir, identity = "intent/login", scope = null) {
	const admission = admitArtifact(dir, {
		type: "intent",
		identity,
		body: "# Intent fixture",
		scope,
	});
	assert.equal(admission.ok, true, (admission.errors || []).join("; "));
	return admission;
}

function consumeFixture(dir, id = "approval/login-42", overrides = {}, opts = {}) {
	return consumeApproval(
		dir,
		{
			id,
			decisionIdentity: "decision/login-approved",
			body: "# Decision: approved",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/login" } }],
			scope: null,
			...overrides,
		},
		{ now: new Date("2026-08-10T00:00:00.000Z"), ...opts },
	);
}

// ── Contract constants ──

test("approval constants pin the clock and schema contract", () => {
	assert.equal(APPROVAL_SCHEMA_VERSION, 1);
	assert.deepEqual(SUPPORTED_APPROVAL_SCHEMA_VERSIONS, [1]);
	assert.deepEqual(CLOCK_SOURCES, ["injected", "system"]);
	assert.equal(SKEW_POLICY, "no-tolerance");
	assert.equal(DEFAULT_MAX_APPROVAL_BYTES, 1024 * 1024);
});

// ── Grant ──

test("grant appends one immutable event and returns the derived record", () => {
	const dir = mkTarget("grant-shape");
	seedPrincipals(dir);
	const result = grantFixture(dir, "approval/login-42", { scope: "F050" });

	assert.equal(result.code, null);
	assert.equal(result.approval.status, "granted");
	assert.equal(result.approval.id, "approval/login-42");
	assert.equal(result.approval.approver.id, "alice@example.com");
	assert.equal(result.approval.approver.principalKind, "human");
	assert.equal(result.approval.approver.role, "reviewer");
	assert.equal(result.approval.scope, "F050");
	assert.equal(result.approval.subject, "spec/login@2");
	assert.equal(result.approval.validAt, "2026-08-01T00:00:00.000Z");
	assert.equal(result.approval.validUntil, "2027-08-01T00:00:00.000Z");
	assert.equal(result.approval.recordedAt, "2026-08-01T00:00:00.000Z");
	assert.equal(result.approval.revokedAt, null);
	assert.equal(result.approval.consumedAt, null);

	const events = readLedger(dir);
	assert.equal(events.length, 1);
	const event = events[0];
	assert.deepEqual(Object.keys(event).sort(), [
		"approvalId",
		"approver",
		"at",
		"clockSource",
		"hash",
		"kind",
		"prevHash",
		"recordedAt",
		"schemaVersion",
		"scope",
		"skewPolicy",
		"subject",
		"validAt",
		"validUntil",
	]);
	assert.equal(event.kind, "granted");
	assert.equal(event.prevHash, GENESIS_HASH);
	assert.equal(event.hash, chainHash({ ...event, prevHash: GENESIS_HASH }, GENESIS_HASH));
	assert.equal(event.clockSource, "injected", "an injected clock is recorded as its own source");
	assert.equal(event.skewPolicy, SKEW_POLICY);
});

test("grant without an injected clock records the system clock source", () => {
	const dir = mkTarget("grant-system-clock");
	seedPrincipals(dir);
	const result = grantApproval(dir, {
		id: "approval/system-clock",
		approver: "alice@example.com",
		subject: "spec/login@2",
		validUntil: "2027-08-01T00:00:00.000Z",
	});
	assert.equal(result.ok, true);
	assert.equal(readLedger(dir)[0].clockSource, "system");
});

test("grant validates its input before any durable state is touched", () => {
	const dir = mkTarget("grant-input");
	seedPrincipals(dir);
	const cases = [
		[{ id: "", approver: "alice@example.com", subject: "s", validUntil: "2027-08-01" }, "empty id"],
		[
			{
				id: "a".repeat(201),
				approver: "alice@example.com",
				subject: "s",
				validUntil: "2027-08-01",
			},
			"oversized id",
		],
		[{ id: "ok", approver: "", subject: "s", validUntil: "2027-08-01" }, "empty approver"],
		[
			{ id: "ok", approver: "alice@example.com", scope: 7, subject: "s", validUntil: "2027-08-01" },
			"non-string scope",
		],
		[
			{ id: "ok", approver: "alice@example.com", subject: "", validUntil: "2027-08-01" },
			"empty subject",
		],
		[
			{ id: "ok", approver: "alice@example.com", subject: "s", validUntil: "not-a-date" },
			"unparseable validUntil",
		],
		[
			{ id: "ok", approver: "alice@example.com", subject: "s", validUntil: "2027-08-01T09:00:00" },
			"zoneless datetime validUntil",
		],
	];
	for (const [input, label] of cases) {
		const result = grantApproval(dir, input);
		assert.equal(result.ok, false, `case "${label}" must fail`);
		assert.equal(result.code, "AMBER_E_INVALID_ARG", `case "${label}" codes as invalid argument`);
	}
	assert.equal(fs.existsSync(ledgerPathOf(dir)), false, "no durable state for malformed input");
});

test("grant binds a registry-verified HUMAN approver; ghost, service, and revoked principals fail closed", () => {
	const dir = mkTarget("grant-human");
	seedPrincipals(dir);

	const ghost = grantApproval(dir, {
		id: "approval/ghost",
		approver: "nobody@example.com",
		subject: "spec/login@2",
		validUntil: "2027-08-01T00:00:00.000Z",
	});
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_PRINCIPAL_NOT_FOUND");

	const service = grantApproval(dir, {
		id: "approval/service",
		approver: "ci-runner",
		subject: "spec/login@2",
		validUntil: "2027-08-01T00:00:00.000Z",
	});
	assert.equal(service.ok, false);
	assert.equal(service.code, "AMBER_E_APPROVAL_HUMAN_SLOT_REQUIRED");

	const revocation = revokePrincipal(dir, {
		id: "bob@example.com",
		revokedBy: "alice@example.com",
	});
	assert.equal(revocation.ok, true, (revocation.errors || []).join("; "));
	const revoked = grantApproval(dir, {
		id: "approval/revoked",
		approver: "bob@example.com",
		subject: "spec/login@2",
		validUntil: "2027-08-01T00:00:00.000Z",
	});
	assert.equal(revoked.ok, false);
	assert.equal(revoked.code, "AMBER_E_PRINCIPAL_REVOKED");
});

test("an approval id is granted exactly once — the duplicate is refused pre-lock", () => {
	const dir = mkTarget("grant-dup");
	seedPrincipals(dir);
	grantFixture(dir, "approval/login-42");
	const dup = grantApproval(
		dir,
		{
			id: "approval/login-42",
			approver: "alice@example.com",
			subject: "spec/login@2",
			validUntil: "2027-08-01T00:00:00.000Z",
		},
		{ now: new Date("2026-08-01T00:00:00.000Z") },
	);
	assert.equal(dup.ok, false);
	assert.equal(dup.code, "AMBER_E_APPROVAL_ALREADY_GRANTED");
	assert.equal(readLedger(dir).length, 1);
});

// ── Revoke ──

test("revoke appends one immutable event and the status flips to revoked", () => {
	const dir = mkTarget("revoke-happy");
	seedPrincipals(dir);
	grantFixture(dir, "approval/login-42");
	const result = revokeApproval(
		dir,
		{ id: "approval/login-42", revoker: "bob@example.com" },
		{ now: new Date("2026-08-02T00:00:00.000Z") },
	);
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.approval.status, "revoked");
	assert.equal(result.approval.revokedAt, "2026-08-02T00:00:00.000Z");
	assert.equal(result.approval.revoker.id, "bob@example.com");

	const events = readLedger(dir);
	assert.equal(events.length, 2);
	assert.equal(events[1].kind, "revoked");
	assert.deepEqual(Object.keys(events[1]).sort(), [
		"approvalId",
		"at",
		"clockSource",
		"hash",
		"kind",
		"prevHash",
		"revoker",
		"schemaVersion",
	]);
	assert.equal(events[1].prevHash, events[0].hash);
});

test("revoke refuses unknown, already-revoked, and consumed approvals with distinct stable codes", () => {
	const dir = mkTarget("revoke-refusals");
	seedPrincipals(dir);
	grantFixture(dir, "approval/login-42");
	grantFixture(dir, "approval/spent-1");
	admitIntentFixture(dir);

	const unknown = revokeApproval(dir, { id: "approval/nope", revoker: "bob@example.com" });
	assert.equal(unknown.code, "AMBER_E_APPROVAL_NOT_FOUND");

	const consumed = consumeFixture(dir, "approval/spent-1");
	assert.equal(consumed.ok, true, (consumed.errors || []).join("; "));
	const revokeConsumed = revokeApproval(dir, {
		id: "approval/spent-1",
		revoker: "bob@example.com",
	});
	assert.equal(revokeConsumed.ok, false);
	assert.equal(revokeConsumed.code, "AMBER_E_APPROVAL_ALREADY_CONSUMED");

	assert.equal(
		revokeApproval(dir, { id: "approval/login-42", revoker: "bob@example.com" }).ok,
		true,
	);
	const twice = revokeApproval(dir, { id: "approval/login-42", revoker: "bob@example.com" });
	assert.equal(twice.ok, false);
	assert.equal(twice.code, "AMBER_E_APPROVAL_ALREADY_REVOKED");
});

test("revoke is a human-only act; service principals and ghost ids fail closed", () => {
	const dir = mkTarget("revoke-human");
	seedPrincipals(dir);
	grantFixture(dir, "approval/login-42");
	const service = revokeApproval(dir, { id: "approval/login-42", revoker: "ci-runner" });
	assert.equal(service.ok, false);
	assert.equal(service.code, "AMBER_E_APPROVAL_HUMAN_SLOT_REQUIRED");
	const ghost = revokeApproval(dir, { id: "approval/login-42", revoker: "nobody@example.com" });
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_PRINCIPAL_NOT_FOUND");
	assert.equal(readLedger(dir).length, 1, "no revoked event was written");
});

// ── Consume ──

test("consume settles the Decision and appends the single-use consumed event atomically", () => {
	const dir = mkTarget("consume-happy");
	seedPrincipals(dir);
	grantFixture(dir, "approval/login-42");
	const intent = admitIntentFixture(dir);

	const result = consumeFixture(dir, "approval/login-42");
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.code, null);
	assert.equal(result.approval.status, "consumed");
	assert.equal(result.approval.consumedAt, "2026-08-10T00:00:00.000Z");
	assert.equal(result.approval.decisionIdentity, "decision/login-approved");
	assert.equal(result.approval.decisionRevision, result.receipt.revision);
	assert.ok(result.receipt.revision >= 1, "the admission receipt names the Decision revision");

	// The settled Decision is a committed artifact bound to the approval's
	// frozen approver and the approval decisionKind.
	const decision = showArtifact(dir, "decision/login-approved", { type: "decision" });
	assert.equal(decision.envelope.decisionKind, "approval");
	assert.equal(decision.envelope.principal.id, "alice@example.com");
	assert.deepEqual(decision.envelope.traces, [
		{
			type: "decides",
			to: { type: "intent", identity: "intent/login", revision: intent.receipt.revision },
		},
	]);

	const events = readLedger(dir);
	assert.equal(events.length, 2);
	assert.equal(events[1].kind, "consumed");
	assert.deepEqual(Object.keys(events[1]).sort(), [
		"approvalId",
		"at",
		"clockSource",
		"decisionIdentity",
		"decisionRevision",
		"hash",
		"kind",
		"prevHash",
		"schemaVersion",
		"skewPolicy",
	]);
	assert.equal(events[1].decisionRevision, result.receipt.revision);
	assert.equal(events[1].prevHash, events[0].hash);
});

test("one authorization can never be replayed — a second consumption is refused", () => {
	const dir = mkTarget("consume-replay");
	seedPrincipals(dir);
	grantFixture(dir, "approval/login-42");
	admitIntentFixture(dir);
	assert.equal(consumeFixture(dir, "approval/login-42").ok, true);

	const replay = consumeFixture(dir, "approval/login-42", {
		decisionIdentity: "decision/login-approved-2",
	});
	assert.equal(replay.ok, false);
	assert.equal(replay.code, "AMBER_E_APPROVAL_ALREADY_CONSUMED");
	assert.equal(readLedger(dir).length, 2, "no third event was written");
});

test("consume refuses unknown, revoked, and not-yet-valid approvals with distinct stable codes", () => {
	const dir = mkTarget("consume-refusals");
	seedPrincipals(dir);
	grantFixture(dir, "approval/revoked-1");
	admitIntentFixture(dir);

	const unknown = consumeFixture(dir, "approval/nope");
	assert.equal(unknown.code, "AMBER_E_APPROVAL_NOT_FOUND");

	assert.equal(
		revokeApproval(
			dir,
			{ id: "approval/revoked-1", revoker: "bob@example.com" },
			{ now: new Date("2026-08-02T00:00:00.000Z") },
		).ok,
		true,
	);
	const revoked = consumeFixture(dir, "approval/revoked-1");
	assert.equal(revoked.code, "AMBER_E_APPROVAL_REVOKED");

	// A hand-built grant whose window opens in the future: the fold accepts
	// it (writer-shaped), and the verdict must refuse before any admission.
	writeJSONL(
		ledgerPathOf(dir),
		withChain([
			storedGranted({
				approvalId: "approval/future-1",
				validAt: "2027-01-01T00:00:00.000Z",
				validUntil: "2028-01-01T00:00:00.000Z",
			}),
		]),
	);
	const early = consumeFixture(dir, "approval/future-1", {
		decisionIdentity: "decision/early",
	});
	assert.equal(early.code, "AMBER_E_APPROVAL_NOT_YET_VALID");
});

test("the validity window is half-open: at exactly validUntil the authorization is expired", () => {
	const dir = mkTarget("consume-boundary");
	seedPrincipals(dir);
	grantFixture(dir, "approval/login-42", { validUntil: "2026-08-15T00:00:00.000Z" });
	admitIntentFixture(dir);

	const before = consumeFixture(dir, "approval/login-42", undefined, {
		now: new Date("2026-08-14T23:59:59.999Z"),
	});
	assert.equal(before.ok, true, (before.errors || []).join("; "));

	const dir2 = mkTarget("consume-boundary-exact");
	seedPrincipals(dir2);
	grantFixture(dir2, "approval/login-42", { validUntil: "2026-08-15T00:00:00.000Z" });
	admitIntentFixture(dir2);
	const exact = consumeFixture(dir2, "approval/login-42", undefined, {
		now: new Date("2026-08-15T00:00:00.000Z"),
	});
	assert.equal(exact.ok, false);
	assert.equal(exact.code, "AMBER_E_APPROVAL_EXPIRED");
	assert.equal(
		fs.existsSync(path.join(dir2, ".amber", "artifacts", "decisions")),
		false,
		"no Decision was settled for an expired authorization",
	);
});

test("a failed Decision admission leaves the authorization unconsumed", () => {
	const dir = mkTarget("consume-failed-admission");
	seedPrincipals(dir);
	grantFixture(dir, "approval/login-42");
	admitIntentFixture(dir);

	const failed = consumeFixture(dir, "approval/login-42", {
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/ghost" } }],
	});
	assert.equal(failed.ok, false);
	assert.equal(failed.code, "AMBER_E_ARTIFACT_TRACE_TARGET_NOT_FOUND");
	assert.equal(readLedger(dir).length, 1, "no consumed event was written");

	const retry = consumeFixture(dir, "approval/login-42", {
		decisionIdentity: "decision/login-approved",
	});
	assert.equal(retry.ok, true, (retry.errors || []).join("; "));
});

test("scope confinement: a scoped approval forces the Decision's scope", () => {
	const dir = mkTarget("consume-scope");
	seedPrincipals(dir);
	grantFixture(dir, "approval/login-42", { scope: "F050" });
	admitIntentFixture(dir, "intent/login", "F050");

	const conflicting = consumeFixture(dir, "approval/login-42", { scope: "OTHER" });
	assert.equal(conflicting.ok, false);
	assert.equal(conflicting.code, "AMBER_E_INVALID_ARG");

	const matching = consumeFixture(dir, "approval/login-42", { scope: "F050" });
	assert.equal(matching.ok, true, (matching.errors || []).join("; "));
	assert.equal(
		showArtifact(dir, "decision/login-approved", { type: "decision" }).envelope.scope,
		"F050",
	);

	const dir2 = mkTarget("consume-scope-default");
	seedPrincipals(dir2);
	grantFixture(dir2, "approval/login-42", { scope: "F050" });
	admitIntentFixture(dir2, "intent/login", "F050");
	const defaulted = consumeFixture(dir2, "approval/login-42");
	assert.equal(defaulted.ok, true, (defaulted.errors || []).join("; "));
	assert.equal(
		showArtifact(dir2, "decision/login-approved", { type: "decision" }).envelope.scope,
		"F050",
		"an unscoped consumption inherits the approval's scope",
	);
});

// ── Read seams ──

test("show returns null for an unrecorded id; list keeps grant order; status is derived at read", () => {
	const dir = mkTarget("reads");
	seedPrincipals(dir);
	grantFixture(dir, "approval/a-1", { validUntil: "2026-08-05T00:00:00.000Z" });
	grantFixture(dir, "approval/b-1");
	assert.equal(showApproval(dir, "approval/nope"), null);
	assert.deepEqual(
		listApprovals(dir).map((record) => record.id),
		["approval/a-1", "approval/b-1"],
	);
	// "expired" is a verdict about the reader's present, never stored: read
	// past the window and the same ledger reads back expired.
	const later = listApprovals(dir, { now: new Date("2026-08-06T00:00:00.000Z") });
	assert.equal(later[0].status, "expired");
	assert.equal(later[1].status, "granted");
	assert.equal(later[0].validUntil, "2026-08-05T00:00:00.000Z");
});

// ── Fold: corruption and tamper evidence ──

function foldThrows(dir, code, needle) {
	try {
		showApproval(dir, "approval/fixture-1");
	} catch (err) {
		assert.equal(err.amberCode, code);
		assert.ok(err.message.includes(needle), `message should mention "${needle}": ${err.message}`);
		return;
	}
	assert.fail(`expected a typed ${code} throw`);
}

test("an in-place edit of a granted event fails closed as corruption", () => {
	const dir = mkTarget("tamper-edit");
	writeJSONL(ledgerPathOf(dir), withChain([storedGranted()]));
	const events = readLedger(dir);
	events[0].subject = "spec/tampered@9";
	fs.writeFileSync(ledgerPathOf(dir), `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
	foldThrows(dir, "AMBER_E_APPROVAL_REGISTRY_CORRUPT", "hash");
});

test("a spliced middle event breaks the chain and fails closed", () => {
	const dir = mkTarget("tamper-splice");
	writeJSONL(
		ledgerPathOf(dir),
		withChain([
			storedGranted(),
			revokedEvent("approval/fixture-1"),
			consumedEvent("approval/fixture-1"),
		]),
	);
	const events = readLedger(dir);
	const spliced = [events[0], events[2]];
	fs.writeFileSync(ledgerPathOf(dir), `${spliced.map((e) => JSON.stringify(e)).join("\n")}\n`);
	foldThrows(dir, "AMBER_E_APPROVAL_REGISTRY_CORRUPT", "prevHash");
});

test("a duplicate granted id inside the ledger is corruption, not a re-grant", () => {
	const dir = mkTarget("tamper-dup-grant");
	writeJSONL(
		ledgerPathOf(dir),
		withChain([storedGranted(), storedGranted({ at: "2026-08-02T00:00:00.000Z" })]),
	);
	foldThrows(dir, "AMBER_E_APPROVAL_REGISTRY_CORRUPT", "second time");
});

test("a revoked-then-consumed sequence is corruption — the writers can never produce it", () => {
	const dir = mkTarget("tamper-revoked-consumed");
	writeJSONL(
		ledgerPathOf(dir),
		withChain([
			storedGranted(),
			revokedEvent("approval/fixture-1"),
			consumedEvent("approval/fixture-1"),
		]),
	);
	foldThrows(dir, "AMBER_E_APPROVAL_REGISTRY_CORRUPT", "revoked");
});

test("an event for an unrecorded approval, an unknown kind, and an unknown field are corruption", () => {
	const dir = mkTarget("tamper-unknown");
	writeJSONL(ledgerPathOf(dir), withChain([revokedEvent("approval/ghost")]));
	foldThrows(dir, "AMBER_E_APPROVAL_REGISTRY_CORRUPT", "never granted");

	const dir2 = mkTarget("tamper-kind");
	writeJSONL(ledgerPathOf(dir2), withChain([{ ...storedGranted(), kind: "extended" }]));
	try {
		showApproval(dir2, "approval/fixture-1");
		assert.fail("expected a corruption throw");
	} catch (err) {
		assert.equal(err.amberCode, "AMBER_E_APPROVAL_REGISTRY_CORRUPT");
		assert.ok(err.message.includes("unknown kind"));
	}

	const dir3 = mkTarget("tamper-field");
	writeJSONL(ledgerPathOf(dir3), withChain([{ ...storedGranted(), extra: "nope" }]));
	try {
		showApproval(dir3, "approval/fixture-1");
		assert.fail("expected a corruption throw");
	} catch (err) {
		assert.equal(err.amberCode, "AMBER_E_APPROVAL_REGISTRY_CORRUPT");
		assert.ok(err.message.includes("unknown field"));
	}
});

test("an unsupported schemaVersion is refused as a version error, never reinterpreted", () => {
	const dir = mkTarget("tamper-version");
	writeJSONL(ledgerPathOf(dir), withChain([storedGranted({ schemaVersion: 2 })]));
	try {
		showApproval(dir, "approval/fixture-1");
		assert.fail("expected an unsupported-version throw");
	} catch (err) {
		assert.equal(err.amberCode, "AMBER_E_APPROVAL_UNSUPPORTED_VERSION");
		assert.ok(err.message.includes("schemaVersion 2"));
	}
});

test("stored events with malformed snapshots, clock sources, and skew policies fail closed", () => {
	const cases = [
		["tamper-snapshot", { approver: { id: "x", principalKind: "robot" } }, "principalKind"],
		["tamper-clock", { clockSource: "ntp" }, "clockSource"],
		["tamper-skew", { skewPolicy: "5m" }, "skewPolicy"],
	];
	for (const [label, override, needle] of cases) {
		const dir = mkTarget(label);
		writeJSONL(ledgerPathOf(dir), withChain([storedGranted(override)]));
		foldThrows(dir, "AMBER_E_APPROVAL_REGISTRY_CORRUPT", needle);
	}
});

test("an empty ledger folds to an empty list", () => {
	const dir = mkTarget("empty");
	fs.mkdirSync(path.dirname(ledgerPathOf(dir)), { recursive: true });
	fs.writeFileSync(ledgerPathOf(dir), "");
	assert.deepEqual(listApprovals(dir), []);
	assert.equal(showApproval(dir, "approval/any"), null);
});

// ── Locking and ceiling ──

test("a fresh lock held by another writer refuses the write; a stale lock is reclaimed", () => {
	const dir = mkTarget("lock");
	seedPrincipals(dir);
	const lockPath = path.join(dir, ".amber", "approvals", "approvals.lock");
	fs.mkdirSync(path.dirname(lockPath), { recursive: true });
	fs.writeFileSync(lockPath, "holder-token-1");

	const refused = grantApproval(
		dir,
		{
			id: "approval/login-42",
			approver: "alice@example.com",
			subject: "spec/login@2",
			validUntil: "2027-08-01T00:00:00.000Z",
		},
		{ now: new Date("2026-08-01T00:00:00.000Z") },
	);
	assert.equal(refused.ok, false);
	assert.equal(refused.code, "AMBER_E_APPROVAL_REGISTRY_LOCK");

	// 30 s staleness bound: a lock older than that is a crashed holder's
	// leftover and is reclaimed.
	const stale = new Date(Date.now() - 60_000);
	fs.utimesSync(lockPath, stale, stale);
	const reclaimed = grantFixture(dir, "approval/login-42");
	assert.equal(reclaimed.ok, true, (reclaimed.errors || []).join("; "));
});

test("the ledger size ceiling refuses oversized writes and a garbage override is a typed argument error", () => {
	const dir = mkTarget("ceiling");
	seedPrincipals(dir);
	const input = {
		approver: "alice@example.com",
		subject: "spec/login@2",
		validUntil: "2027-08-01T00:00:00.000Z",
	};
	const now = { now: new Date("2026-08-01T00:00:00.000Z") };
	process.env.AMBER_APPROVAL_MAX_REGISTRY_BYTES = "200";
	try {
		const refused = grantApproval(dir, { id: "approval/login-42", ...input }, now);
		assert.equal(refused.ok, false);
		assert.equal(refused.code, "AMBER_E_APPROVAL_SIZE_CEILING");
		assert.equal(fs.existsSync(ledgerPathOf(dir)), false);

		process.env.AMBER_APPROVAL_MAX_REGISTRY_BYTES = "garbage";
		const garbage = grantApproval(dir, { id: "approval/login-42", ...input }, now);
		assert.equal(garbage.ok, false);
		assert.equal(garbage.code, "AMBER_E_INVALID_ARG");
	} finally {
		delete process.env.AMBER_APPROVAL_MAX_REGISTRY_BYTES;
	}
});
