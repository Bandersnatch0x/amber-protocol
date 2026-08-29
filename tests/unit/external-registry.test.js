"use strict";

// F056 T1 (#288) — External Effect registry with pinned Adapter contracts.
//
// Tests assert externally visible behavior: registration binds the closed
// contract shape behind a single-use committed human Decision with a
// verified Adapter pin, registered versions are immutable (a change
// registers a new version), no field can smuggle a command / executable /
// URL, and tampered or validly re-chained forged ledgers fail every read
// closed with stable AMBER_E_EXTERNAL_* codes.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	EXTERNAL_SCHEMA_VERSION,
	SUPPORTED_EXTERNAL_SCHEMA_VERSIONS,
	DEFAULT_MAX_EXTERNAL_BYTES,
	MAX_EXTERNAL_TIMEOUT_MS,
	EXTERNAL_SYSTEMS,
	EXTERNAL_IDEMPOTENCY,
	EXTERNAL_CREDENTIALS,
	EXTERNAL_DECISION_KINDS,
	GENESIS_HASH,
	chainHash,
	effectsPath,
	registerExternalEffect,
	showExternalEffect,
	listExternalEffects,
	PROPOSAL_STATUSES,
	proposalsPath,
	proposeExternalEffect,
	authorizeExternalEffect,
	showExternalProposal,
	listExternalProposals,
	DECLARED_STATUSES,
	EXECUTION_OUTCOMES,
	executionsPath,
	executeExternalEffect,
	settleExternalExecution,
	reconcileExternalExecution,
	showExternalExecution,
	listExternalExecutions,
	compensateExternalEffect,
	listExternalTransactions,
} = require("../../scripts/lib/core/external-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { registerAdapter } = require("../../scripts/lib/core/adapter-registry");
const { grantApproval, showApproval } = require("../../scripts/lib/core/approval-registry");
const { recordEvidence } = require("../../scripts/lib/core/evidence-receipts");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-external-${label}-`));
}

const NOW = new Date("2026-08-29T00:00:00.000Z");

/** Principal + intent + one committed human Decision per identity + Adapter. */
function externalFixture(dir, decisionIdentities = ["decision/effect-1"]) {
	assert.equal(
		registerPrincipal(dir, { id: "legal@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/external", body: "# X\n" }).ok,
		true,
	);
	for (const identity of decisionIdentities) {
		const decision = admitArtifact(dir, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "legal@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
		});
		assert.equal(decision.ok, true, (decision.errors || []).join("; "));
	}
	const registered = registerAdapter(dir, {
		id: "adapter/tracker",
		owner: "platform-team",
		adapterVersion: "1",
		recordTypes: [{ type: "ticket", versions: ["v1"] }],
		scope: "F056",
		identityMapping: { strategy: "path" },
		freshness: { maxAgeMs: 86_400_000 },
		permissions: { readOnly: true, allowedPaths: ["tracker"] },
	});
	assert.equal(registered.ok, true, (registered.errors || []).join("; "));
}

function effectInput(overrides = {}) {
	return {
		id: "effect/ticket-comment",
		version: "1",
		owner: "platform-team",
		system: "ticketing",
		operation: "comment.create",
		target: "tracker/amber-protocol",
		scope: "issues",
		idempotency: "idempotent",
		credentials: "scoped",
		receiptFields: ["commentId"],
		compensation: { kind: "effect", effect: "effect/ticket-comment-delete" },
		timeoutMs: 30_000,
		adapter: { id: "adapter/tracker", version: "1" },
		decision: { identity: "decision/effect-1", revision: 1 },
		...overrides,
	};
}

function readEvents(ledgerPath) {
	return fs
		.readFileSync(ledgerPath, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line));
}

function writeEvents(ledgerPath, events) {
	fs.writeFileSync(ledgerPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

test("external constants pin the system, idempotency, credentials, and bound contracts", () => {
	assert.equal(EXTERNAL_SCHEMA_VERSION, 2);
	assert.deepEqual([...SUPPORTED_EXTERNAL_SCHEMA_VERSIONS], [1, 2]);
	assert.equal(DEFAULT_MAX_EXTERNAL_BYTES, 1024 * 1024);
	assert.equal(MAX_EXTERNAL_TIMEOUT_MS, 24 * 3_600_000);
	assert.deepEqual(
		[...EXTERNAL_SYSTEMS],
		["ticketing", "code-review", "notification", "deployment", "storage"],
	);
	assert.deepEqual([...EXTERNAL_IDEMPOTENCY], ["idempotent", "at-most-once"]);
	assert.deepEqual([...EXTERNAL_CREDENTIALS], ["none", "scoped"]);
	assert.deepEqual([...EXTERNAL_DECISION_KINDS], ["acceptance", "approval"]);
});

test("register binds the closed contract behind a verified Adapter pin and human Decision", () => {
	const dir = mkTarget("register");
	externalFixture(dir);
	const result = registerExternalEffect(
		dir,
		effectInput({ receiptFields: ["commentId", "commentUrl"] }),
		{ now: NOW },
	);
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.record.id, "effect/ticket-comment");
	assert.equal(result.record.version, "1");
	assert.equal(result.record.owner, "platform-team");
	assert.equal(result.record.system, "ticketing");
	assert.equal(result.record.operation, "comment.create");
	assert.equal(result.record.target, "tracker/amber-protocol");
	assert.equal(result.record.scope, "issues");
	assert.equal(result.record.idempotency, "idempotent");
	assert.equal(result.record.credentials, "scoped");
	assert.deepEqual(result.record.receiptFields, ["commentId", "commentUrl"]);
	assert.deepEqual(result.record.compensation, {
		kind: "effect",
		effect: "effect/ticket-comment-delete",
	});
	assert.equal(result.record.timeoutMs, 30_000);
	assert.deepEqual(result.record.adapter, { id: "adapter/tracker", version: "1" });
	// The Decision snapshot freezes the verified principal, not a free string.
	assert.deepEqual(result.record.decision, {
		identity: "decision/effect-1",
		revision: 1,
		decisionKind: "approval",
		principal: "legal@example.com",
	});
	const events = readEvents(effectsPath(dir));
	assert.equal(events.length, 1);
	assert.equal(events[0].prevHash, GENESIS_HASH);
	assert.equal(chainHash(events[0], GENESIS_HASH), events[0].hash);
	assert.equal(showExternalEffect(dir, "effect/ticket-comment").version, "1");
	assert.equal(listExternalEffects(dir).length, 1);
	assert.equal(listExternalEffects(dir, { system: "ticketing" }).length, 1);
	assert.equal(listExternalEffects(dir, { system: "storage" }).length, 0);
});

test("a registered id@version is immutable; changed semantics register a new version", () => {
	const dir = mkTarget("immutable");
	externalFixture(dir, ["decision/effect-1", "decision/effect-2", "decision/effect-3"]);
	assert.equal(registerExternalEffect(dir, effectInput(), { now: NOW }).ok, true);
	const duplicate = registerExternalEffect(
		dir,
		effectInput({ decision: { identity: "decision/effect-2", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(duplicate.ok, false);
	assert.equal(duplicate.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(duplicate.errors[0], /already registered.*new version/);
	const next = registerExternalEffect(
		dir,
		effectInput({
			version: "2",
			timeoutMs: 60_000,
			decision: { identity: "decision/effect-2", revision: 1 },
		}),
		{ now: NOW },
	);
	assert.equal(next.ok, true, (next.errors || []).join("; "));
	assert.equal(showExternalEffect(dir, "effect/ticket-comment").version, "2");
	assert.equal(showExternalEffect(dir, "effect/ticket-comment", "1").timeoutMs, 30_000);
	assert.equal(showExternalEffect(dir, "effect/ticket-comment", "9"), null);
	assert.equal(showExternalEffect(dir, "effect/ghost"), null);
});

test("a registration Decision is single-use across the effect ledger", () => {
	const dir = mkTarget("single-use");
	externalFixture(dir);
	assert.equal(registerExternalEffect(dir, effectInput(), { now: NOW }).ok, true);
	const reused = registerExternalEffect(
		dir,
		effectInput({ id: "effect/ticket-close", operation: "ticket.close" }),
		{ now: NOW },
	);
	assert.equal(reused.ok, false);
	assert.equal(reused.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(reused.errors[0], /already authorized effect .*single-use/);
});

test("the closed contract shape refuses unknown fields and out-of-vocabulary values", () => {
	const dir = mkTarget("shape");
	externalFixture(dir);
	const cases = [
		[effectInput({ runCommand: "true" }), /unknown field "runCommand"/],
		[effectInput({ system: "email" }), /system must be one of/],
		[effectInput({ idempotency: "retry" }), /idempotency must be one of/],
		[effectInput({ credentials: "admin" }), /credentials must be one of/],
		[effectInput({ receiptFields: [] }), /receiptFields must be a non-empty array/],
		[effectInput({ timeoutMs: 0 }), /timeoutMs must be a positive integer/],
		[
			effectInput({ timeoutMs: MAX_EXTERNAL_TIMEOUT_MS + 1 }),
			/timeoutMs must be a positive integer no greater than/,
		],
	];
	for (const [input, pattern] of cases) {
		const refused = registerExternalEffect(dir, input, { now: NOW });
		assert.equal(refused.ok, false, JSON.stringify(input));
		assert.equal(refused.code, "AMBER_E_EXTERNAL_INVALID");
		assert.match(refused.errors[0], pattern);
	}
	assert.equal(fs.existsSync(effectsPath(dir)), false);
});

test("no contract field can smuggle a command, executable path, or URL", () => {
	const dir = mkTarget("smuggle");
	externalFixture(dir);
	const cases = [
		[effectInput({ target: "https://evil.example/hook" }), /must not carry a URL scheme/],
		[effectInput({ operation: "rm -rf /" }), /never a command line/],
		[effectInput({ id: "effect/x; curl evil" }), /cannot ride a registered name/],
		[effectInput({ owner: "team && true" }), /cannot ride a registered name/],
		[effectInput({ scope: "..\\escape me" }), /cannot ride a registered name/],
		[effectInput({ target: "tracker/../../etc/passwd" }), /must not carry a ".." path segment/],
		[effectInput({ version: "1; curl evil" }), /version.*cannot ride a registered name/],
		[
			effectInput({ receiptFields: ["https://evil.example/hook"] }),
			/receiptFields\[0\] must not carry a URL scheme/,
		],
		[
			effectInput({ compensation: { kind: "effect", effect: "https://evil.example" } }),
			/must not carry a URL scheme/,
		],
	];
	for (const [input, pattern] of cases) {
		const refused = registerExternalEffect(dir, input, { now: NOW });
		assert.equal(refused.ok, false, JSON.stringify(input));
		assert.equal(refused.code, "AMBER_E_EXTERNAL_INVALID");
		assert.match(refused.errors[0], pattern);
	}
	assert.equal(fs.existsSync(effectsPath(dir)), false);
});

test("compensation declares exactly one of a compensating effect or irreversibility", () => {
	const dir = mkTarget("compensation");
	externalFixture(dir);
	const both = registerExternalEffect(
		dir,
		effectInput({ compensation: { kind: "irreversible", effect: "effect/undo" } }),
		{ now: NOW },
	);
	assert.equal(both.ok, false);
	assert.match(both.errors[0], /irreversible and must not name a compensating effect/);
	const unknownKind = registerExternalEffect(dir, effectInput({ compensation: { kind: "undo" } }), {
		now: NOW,
	});
	assert.equal(unknownKind.ok, false);
	assert.match(unknownKind.errors[0], /kind must be "effect" or "irreversible"/);
	const irreversible = registerExternalEffect(
		dir,
		effectInput({ compensation: { kind: "irreversible" } }),
		{ now: NOW },
	);
	assert.equal(irreversible.ok, true, (irreversible.errors || []).join("; "));
	assert.deepEqual(irreversible.record.compensation, { kind: "irreversible" });
});

test("an unresolved or version-mismatched Adapter pin refuses registration", () => {
	const dir = mkTarget("adapter-pin");
	externalFixture(dir);
	const ghost = registerExternalEffect(
		dir,
		effectInput({ adapter: { id: "adapter/ghost", version: "1" } }),
		{ now: NOW },
	);
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(ghost.errors[0], /"adapter\/ghost" is not registered/);
	const drifted = registerExternalEffect(
		dir,
		effectInput({ adapter: { id: "adapter/tracker", version: "2" } }),
		{ now: NOW },
	);
	assert.equal(drifted.ok, false);
	assert.match(drifted.errors[0], /registered at version "1", not the pinned "2"/);
	assert.equal(fs.existsSync(effectsPath(dir)), false);
});

test("registration authority requires an unscoped committed human Decision", () => {
	const dir = mkTarget("authority");
	externalFixture(dir);
	assert.equal(
		registerPrincipal(dir, { id: "bot@example.com", principalKind: "service" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "decision",
			identity: "decision/review-1",
			body: "# Review\n",
			decisionKind: "review",
			principal: "bot@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
		}).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "intent",
			identity: "intent/scoped",
			body: "# S\n",
			scope: "session/1",
		}).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "decision",
			identity: "decision/scoped-1",
			body: "# Scoped\n",
			decisionKind: "approval",
			principal: "legal@example.com",
			scope: "session/1",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/scoped" } }],
		}).ok,
		true,
	);
	const cases = [
		[{ identity: "decision/ghost", revision: 1 }, /is not a committed Decision artifact/],
		[{ identity: "decision/effect-1", revision: 9 }, /is not a committed Decision artifact/],
		[{ identity: "decision/review-1", revision: 1 }, /carries decisionKind "review"/],
		[{ identity: "decision/scoped-1", revision: 1 }, /is scoped to "session\/1"/],
	];
	for (const [decision, pattern] of cases) {
		const refused = registerExternalEffect(dir, effectInput({ decision }), { now: NOW });
		assert.equal(refused.ok, false, JSON.stringify(decision));
		assert.equal(refused.code, "AMBER_E_EXTERNAL_INVALID");
		assert.match(refused.errors[0], pattern);
	}
	const badPin = registerExternalEffect(dir, effectInput({ decision: { identity: "d" } }), {
		now: NOW,
	});
	assert.equal(badPin.ok, false);
	assert.match(badPin.errors[0], /decision.revision must be a positive integer/);
});

test("a tampered effect ledger fails every read closed", () => {
	const dir = mkTarget("tamper");
	externalFixture(dir);
	assert.equal(registerExternalEffect(dir, effectInput(), { now: NOW }).ok, true);
	const pristine = readEvents(effectsPath(dir));
	const tampered = JSON.parse(JSON.stringify(pristine));
	tampered[0].timeoutMs = 999_999;
	writeEvents(effectsPath(dir), tampered);
	assert.throws(
		() => listExternalEffects(dir),
		(err) =>
			err.amberCode === "AMBER_E_EXTERNAL_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	writeEvents(effectsPath(dir), pristine);
	const blockedInput = effectInput({
		version: "2",
		decision: { identity: "decision/effect-1", revision: 1 },
	});
	// A corrupt ledger also refuses new registrations (append reads first).
	const rechained = JSON.parse(JSON.stringify(pristine));
	const { hash: _hash, ...rest } = rechained[0];
	const forged = { ...rest, executable: "/usr/bin/curl" };
	forged.hash = chainHash(forged, forged.prevHash);
	writeEvents(effectsPath(dir), [forged]);
	// A validly re-chained forgery with a smuggled field fails shape
	// validation: an execution vector cannot ride the closed event shape.
	// The chain carries no external anchor (mirroring the F054/F055
	// ledgers), so re-chain resistance IS the closed shape + vocabulary.
	assert.throws(
		() => showExternalEffect(dir, "effect/ticket-comment"),
		(err) =>
			err.amberCode === "AMBER_E_EXTERNAL_CORRUPT" &&
			/unknown field "executable"/.test(err.message),
	);
	const blocked = registerExternalEffect(dir, blockedInput, { now: NOW });
	assert.equal(blocked.ok, false);
	assert.equal(blocked.code, "AMBER_E_EXTERNAL_CORRUPT");
	// A validly re-chained unsupported schema version fails closed too.
	const downgraded = { ...rest, schemaVersion: 99 };
	downgraded.hash = chainHash(downgraded, downgraded.prevHash);
	writeEvents(effectsPath(dir), [downgraded]);
	assert.throws(
		() => listExternalEffects(dir),
		(err) =>
			err.amberCode === "AMBER_E_EXTERNAL_CORRUPT" &&
			/unsupported schemaVersion 99/.test(err.message),
	);
});

test("a fresh effect lock held by another writer refuses registration", () => {
	const dir = mkTarget("lock");
	externalFixture(dir, ["decision/effect-1", "decision/effect-2"]);
	assert.equal(registerExternalEffect(dir, effectInput(), { now: NOW }).ok, true);
	const lockPath = path.join(dir, ".amber", "external", "effects.lock");
	fs.writeFileSync(lockPath, "holder-token-1");
	const nextInput = effectInput({
		version: "2",
		decision: { identity: "decision/effect-2", revision: 1 },
	});
	const contended = registerExternalEffect(dir, nextInput, { now: NOW });
	assert.equal(contended.ok, false);
	assert.equal(contended.code, "AMBER_E_EXTERNAL_LOCK");
	fs.rmSync(lockPath);
	assert.equal(registerExternalEffect(dir, nextInput, { now: NOW }).ok, true);
});

test("the effect ledger byte ceiling refuses growth without writing", () => {
	const dir = mkTarget("ceiling");
	externalFixture(dir);
	process.env.AMBER_EXTERNAL_MAX_EFFECTS_BYTES = "64";
	try {
		const capped = registerExternalEffect(dir, effectInput(), { now: NOW });
		assert.equal(capped.ok, false);
		assert.equal(capped.code, "AMBER_E_EXTERNAL_SIZE_CEILING");
		assert.match(capped.errors[0], /would exceed 64 bytes/);
		assert.equal(fs.existsSync(effectsPath(dir)), false);
	} finally {
		delete process.env.AMBER_EXTERNAL_MAX_EFFECTS_BYTES;
	}
	assert.equal(registerExternalEffect(dir, effectInput(), { now: NOW }).ok, true);
});

// ---------------------------------------------------------------------------
// F056 T2 (#289) — proposals & drift-bound authorization.
// ---------------------------------------------------------------------------

const PAYLOAD = `sha256:${"a".repeat(64)}`;

/** T1 fixture + registered effect + a human approver. */
function proposalFixture(dir, decisionIdentities = ["decision/effect-1"]) {
	externalFixture(dir, decisionIdentities);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(registerExternalEffect(dir, effectInput(), { now: NOW }).ok, true);
}

function grantRequestApproval(dir, id, requestHash) {
	assert.equal(
		grantApproval(
			dir,
			{
				id,
				approver: "bob@example.com",
				scope: null,
				subject: `external-effect:${requestHash}`,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: NOW },
		).ok,
		true,
	);
}

test("propose binds the registered contract into a canonical requestHash", () => {
	const dir = mkTarget("propose");
	proposalFixture(dir);
	const proposed = proposeExternalEffect(
		dir,
		{
			id: "request/1",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: PAYLOAD,
		},
		{ now: NOW },
	);
	assert.equal(proposed.ok, true, (proposed.errors || []).join("; "));
	assert.equal(proposed.record.owner, "platform-team");
	assert.deepEqual(proposed.record.effect, { id: "effect/ticket-comment", version: "1" });
	assert.deepEqual(proposed.record.adapter, { id: "adapter/tracker", version: "1" });
	assert.equal(proposed.record.target, "tracker/amber-protocol");
	assert.equal(proposed.record.scope, "issues");
	assert.equal(proposed.record.payloadHash, PAYLOAD);
	assert.equal(proposed.record.credentials, "scoped");
	assert.deepEqual(proposed.record.compensation, {
		kind: "effect",
		effect: "effect/ticket-comment-delete",
	});
	assert.match(proposed.record.requestHash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(proposed.record.status, "proposed");
	assert.equal(proposed.record.authorization, null);
	const events = readEvents(proposalsPath(dir));
	assert.equal(events[0].prevHash, GENESIS_HASH);
	assert.equal(chainHash(events[0], GENESIS_HASH), events[0].hash);
	assert.equal(showExternalProposal(dir, "request/1").requestHash, proposed.record.requestHash);
	assert.deepEqual([...PROPOSAL_STATUSES], ["proposed", "authorized"]);
	assert.equal(listExternalProposals(dir, { status: "proposed" }).length, 1);
	assert.equal(listExternalProposals(dir, { status: "authorized" }).length, 0);
});

test("an identical request refuses naming the existing proposal", () => {
	const dir = mkTarget("idempotency");
	proposalFixture(dir);
	const effect = { id: "effect/ticket-comment", version: "1" };
	assert.equal(
		proposeExternalEffect(dir, { id: "request/1", effect, payloadHash: PAYLOAD }, { now: NOW }).ok,
		true,
	);
	const reusedId = proposeExternalEffect(
		dir,
		{ id: "request/1", effect, payloadHash: `sha256:${"b".repeat(64)}` },
		{ now: NOW },
	);
	assert.equal(reusedId.ok, false);
	assert.equal(reusedId.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(reusedId.errors[0], /already exists; propose a new id/);
	const duplicate = proposeExternalEffect(
		dir,
		{ id: "request/2", effect, payloadHash: PAYLOAD },
		{ now: NOW },
	);
	assert.equal(duplicate.ok, false);
	assert.equal(duplicate.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(duplicate.errors[0], /already proposed as "request\/1"/);
	assert.equal(
		proposeExternalEffect(
			dir,
			{ id: "request/2", effect, payloadHash: `sha256:${"b".repeat(64)}` },
			{ now: NOW },
		).ok,
		true,
	);
});

test("propose refuses ghost effects, stale pins, and malformed payload hashes", () => {
	const dir = mkTarget("propose-refusals");
	proposalFixture(dir, ["decision/effect-1", "decision/effect-2"]);
	const pin = { id: "effect/ticket-comment", version: "1" };
	const badHash = proposeExternalEffect(
		dir,
		{ id: "request/1", effect: pin, payloadHash: "sha256:xyz" },
		{ now: NOW },
	);
	assert.equal(badHash.ok, false);
	assert.equal(badHash.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(badHash.errors[0], /payloadHash must be a sha256:<64-hex> string/);
	const ghost = proposeExternalEffect(
		dir,
		{ id: "request/1", effect: { id: "effect/ghost", version: "1" }, payloadHash: PAYLOAD },
		{ now: NOW },
	);
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_EXTERNAL_NOT_FOUND");
	const smuggled = proposeExternalEffect(
		dir,
		{ id: "request/1", effect: pin, payloadHash: PAYLOAD, note: "x" },
		{ now: NOW },
	);
	assert.equal(smuggled.ok, false);
	assert.match(smuggled.errors[0], /unknown field "note"/);
	assert.equal(
		registerExternalEffect(
			dir,
			effectInput({ version: "2", decision: { identity: "decision/effect-2", revision: 1 } }),
			{ now: NOW },
		).ok,
		true,
	);
	const stale = proposeExternalEffect(
		dir,
		{ id: "request/1", effect: pin, payloadHash: PAYLOAD },
		{ now: NOW },
	);
	assert.equal(stale.ok, false);
	assert.equal(stale.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(stale.errors[0], /registered at version "2", not the pinned "1"/);
	assert.equal(fs.existsSync(proposalsPath(dir)), false);
});

test("authorize consumes a single-use Approval bound to the requestHash atomically", () => {
	const dir = mkTarget("authorize");
	proposalFixture(dir);
	const proposed = proposeExternalEffect(
		dir,
		{
			id: "request/1",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: PAYLOAD,
		},
		{ now: NOW },
	);
	assert.equal(proposed.ok, true);
	grantRequestApproval(dir, "approval/external-1", proposed.record.requestHash);
	grantRequestApproval(dir, "approval/other", `sha256:${"0".repeat(64)}`);
	const authorizeInput = (overrides = {}) => ({
		id: "request/1",
		approval: "approval/external-1",
		decisionIdentity: "decision/external-consume-1",
		body: "# Authorize external effect\n",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
		scope: null,
		...overrides,
	});
	const mismatched = authorizeExternalEffect(dir, authorizeInput({ approval: "approval/other" }), {
		now: NOW,
	});
	assert.equal(mismatched.ok, false);
	assert.match(mismatched.errors[0], /not this proposal's binding/);
	const unrecorded = authorizeExternalEffect(dir, authorizeInput({ approval: "approval/ghost" }), {
		now: NOW,
	});
	assert.equal(unrecorded.ok, false);
	assert.match(unrecorded.errors[0], /is not recorded/);
	const ghost = authorizeExternalEffect(dir, authorizeInput({ id: "request/ghost" }), {
		now: NOW,
	});
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_EXTERNAL_NOT_FOUND");
	const authorized = authorizeExternalEffect(dir, authorizeInput(), { now: NOW });
	assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));
	assert.equal(authorized.record.status, "authorized");
	assert.equal(authorized.record.authorization.approvalId, "approval/external-1");
	assert.equal(
		authorized.record.authorization.decision.revision,
		authorized.consumption.receipt.revision,
	);
	assert.equal(showApproval(dir, "approval/external-1", { now: NOW }).status, "consumed");
	assert.equal(listExternalProposals(dir, { status: "authorized" }).length, 1);
	const again = authorizeExternalEffect(dir, authorizeInput(), { now: NOW });
	assert.equal(again.ok, false);
	assert.match(again.errors[0], /already authorized; an authorization is single-use/);
});

test("effect-version drift between proposal and authorization refuses", () => {
	const dir = mkTarget("drift");
	proposalFixture(dir, ["decision/effect-1", "decision/effect-2"]);
	const proposed = proposeExternalEffect(
		dir,
		{
			id: "request/1",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: PAYLOAD,
		},
		{ now: NOW },
	);
	assert.equal(proposed.ok, true);
	grantRequestApproval(dir, "approval/external-1", proposed.record.requestHash);
	assert.equal(
		registerExternalEffect(
			dir,
			effectInput({
				version: "2",
				timeoutMs: 60_000,
				decision: { identity: "decision/effect-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const drifted = authorizeExternalEffect(
		dir,
		{
			id: "request/1",
			approval: "approval/external-1",
			decisionIdentity: "decision/external-consume-1",
			body: "# Authorize external effect\n",
		},
		{ now: NOW },
	);
	assert.equal(drifted.ok, false);
	assert.equal(drifted.code, "AMBER_E_EXTERNAL_DRIFT");
	assert.match(drifted.errors[0], /registered at version "2", not the pinned "1"/);
	// The refusal is before the point of no return: the approval stays
	// unconsumed and the proposal stays proposed.
	assert.equal(showApproval(dir, "approval/external-1", { now: NOW }).status, "granted");
	assert.equal(showExternalProposal(dir, "request/1").status, "proposed");
});

test("out-of-band registry loss surfaces as drift at authorization", () => {
	const dir = mkTarget("registry-loss");
	proposalFixture(dir);
	const proposed = proposeExternalEffect(
		dir,
		{
			id: "request/1",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: PAYLOAD,
		},
		{ now: NOW },
	);
	assert.equal(proposed.ok, true);
	grantRequestApproval(dir, "approval/external-1", proposed.record.requestHash);
	const authorizeInput = {
		id: "request/1",
		approval: "approval/external-1",
		decisionIdentity: "decision/external-consume-1",
		body: "# Authorize external effect\n",
	};
	// Governed writes cannot change an Adapter's version (duplicate ids
	// refuse), so the adapter clause only fires on out-of-band loss or
	// replacement of the Adapter ledger — it still refuses closed.
	const adapterLedger = path.join(dir, ".amber", "adapters", "registry.jsonl");
	const adapterEvents = fs.readFileSync(adapterLedger, "utf8");
	fs.rmSync(adapterLedger);
	const adapterDrift = authorizeExternalEffect(dir, authorizeInput, { now: NOW });
	assert.equal(adapterDrift.ok, false);
	assert.equal(adapterDrift.code, "AMBER_E_EXTERNAL_DRIFT");
	assert.match(adapterDrift.errors[0], /register a new effect version against the current Adapter/);
	fs.writeFileSync(adapterLedger, adapterEvents);
	fs.rmSync(effectsPath(dir));
	const effectLoss = authorizeExternalEffect(dir, authorizeInput, { now: NOW });
	assert.equal(effectLoss.ok, false);
	assert.equal(effectLoss.code, "AMBER_E_EXTERNAL_DRIFT");
	assert.match(effectLoss.errors[0], /is not registered/);
	assert.equal(showApproval(dir, "approval/external-1", { now: NOW }).status, "granted");
});

test("the proposal ledger byte ceiling refuses growth without writing", () => {
	const dir = mkTarget("proposal-ceiling");
	proposalFixture(dir);
	process.env.AMBER_EXTERNAL_MAX_PROPOSALS_BYTES = "64";
	try {
		const capped = proposeExternalEffect(
			dir,
			{
				id: "request/1",
				effect: { id: "effect/ticket-comment", version: "1" },
				payloadHash: PAYLOAD,
			},
			{ now: NOW },
		);
		assert.equal(capped.ok, false);
		assert.equal(capped.code, "AMBER_E_EXTERNAL_PROPOSAL_SIZE_CEILING");
		assert.equal(fs.existsSync(proposalsPath(dir)), false);
	} finally {
		delete process.env.AMBER_EXTERNAL_MAX_PROPOSALS_BYTES;
	}
});

test("a tampered proposal ledger fails every read closed", () => {
	const dir = mkTarget("proposal-tamper");
	proposalFixture(dir);
	assert.equal(
		proposeExternalEffect(
			dir,
			{
				id: "request/1",
				effect: { id: "effect/ticket-comment", version: "1" },
				payloadHash: PAYLOAD,
			},
			{ now: NOW },
		).ok,
		true,
	);
	const pristine = readEvents(proposalsPath(dir));
	const tampered = JSON.parse(JSON.stringify(pristine));
	tampered[0].payloadHash = `sha256:${"c".repeat(64)}`;
	writeEvents(proposalsPath(dir), tampered);
	assert.throws(
		() => listExternalProposals(dir),
		(err) =>
			err.amberCode === "AMBER_E_EXTERNAL_PROPOSAL_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	// A validly re-chained authorization of a proposal that was never
	// made fails the fold closed.
	const forged = {
		kind: "authorized",
		schemaVersion: 1,
		at: NOW.toISOString(),
		id: "request/ghost",
		approvalId: "approval/forged",
		decision: { identity: "decision/forged", revision: 1 },
		prevHash: pristine[0].hash,
	};
	forged.hash = chainHash(forged, forged.prevHash);
	writeEvents(proposalsPath(dir), [...pristine, forged]);
	assert.throws(
		() => showExternalProposal(dir, "request/1"),
		(err) =>
			err.amberCode === "AMBER_E_EXTERNAL_PROPOSAL_CORRUPT" &&
			/authorizes unknown proposal/.test(err.message),
	);
});

test("a fresh proposal lock held by another writer refuses proposing", () => {
	const dir = mkTarget("proposal-lock");
	proposalFixture(dir);
	const lockPath = path.join(dir, ".amber", "external", "proposals.lock");
	fs.writeFileSync(lockPath, "holder-token-1");
	const input = {
		id: "request/1",
		effect: { id: "effect/ticket-comment", version: "1" },
		payloadHash: PAYLOAD,
	};
	const contended = proposeExternalEffect(dir, input, { now: NOW });
	assert.equal(contended.ok, false);
	assert.equal(contended.code, "AMBER_E_EXTERNAL_PROPOSAL_LOCK");
	fs.rmSync(lockPath);
	assert.equal(proposeExternalEffect(dir, input, { now: NOW }).ok, true);
});

// ---------------------------------------------------------------------------
// F056 T3 (#290) — Adapter execution, settlement & credential boundary.
// ---------------------------------------------------------------------------

const JWT_LIKE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";

/** Propose request/1 against effect/ticket-comment@1 and authorize it. */
function authorizedRequestFixture(dir, decisionIdentities = ["decision/effect-1"]) {
	proposalFixture(dir, decisionIdentities);
	const proposed = proposeExternalEffect(
		dir,
		{
			id: "request/1",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: PAYLOAD,
		},
		{ now: NOW },
	);
	assert.equal(proposed.ok, true, (proposed.errors || []).join("; "));
	grantRequestApproval(dir, "approval/external-1", proposed.record.requestHash);
	const authorized = authorizeExternalEffect(
		dir,
		{
			id: "request/1",
			approval: "approval/external-1",
			decisionIdentity: "decision/external-consume-1",
			body: "# Authorize external effect\n",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
		},
		{ now: NOW },
	);
	assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));
}

function boundary(overrides = {}) {
	return {
		purpose: "comment.create",
		scope: "tracker/amber-protocol",
		expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
		...overrides,
	};
}

function executeInput(overrides = {}) {
	return { id: "execution/1", request: "request/1", credential: boundary(), ...overrides };
}

test("execute prepares only from the reviewed contract snapshot with a credential boundary", () => {
	const dir = mkTarget("execute");
	authorizedRequestFixture(dir);
	assert.deepEqual([...DECLARED_STATUSES], ["committed", "failed", "denied", "unknown"]);
	assert.deepEqual(
		[...EXECUTION_OUTCOMES],
		["denied", "attempted", "committed", "failed", "unknown"],
	);
	const ghost = executeExternalEffect(dir, executeInput({ request: "request/ghost" }), {
		now: NOW,
	});
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_EXTERNAL_NOT_FOUND");
	const missingBoundary = executeExternalEffect(dir, executeInput({ credential: null }), {
		now: NOW,
	});
	assert.equal(missingBoundary.ok, false);
	assert.match(missingBoundary.errors[0], /binds a purpose\/scope\/expiry credential boundary/);
	const longLived = executeExternalEffect(
		dir,
		executeInput({
			credential: boundary({ expiresAt: new Date(NOW.getTime() + 60_000).toISOString() }),
		}),
		{ now: NOW },
	);
	assert.equal(longLived.ok, false);
	assert.match(longLived.errors[0], /must not outlive the contract's declared timeout/);
	const expired = executeExternalEffect(
		dir,
		executeInput({ credential: boundary({ expiresAt: NOW.toISOString() }) }),
		{ now: NOW },
	);
	assert.equal(expired.ok, false);
	assert.match(expired.errors[0], /strictly after the execution clock/);
	const leaked = executeExternalEffect(
		dir,
		executeInput({ credential: boundary({ purpose: JWT_LIKE }) }),
		{ now: NOW },
	);
	assert.equal(leaked.ok, false);
	assert.equal(leaked.code, "AMBER_E_EXTERNAL_CREDENTIAL_LEAK");
	const smuggledHandle = executeExternalEffect(
		dir,
		executeInput({ credential: { ...boundary(), handle: "vault://token" } }),
		{ now: NOW },
	);
	assert.equal(smuggledHandle.ok, false);
	assert.match(smuggledHandle.errors[0], /unknown field "handle"/);
	const tokenId = executeExternalEffect(dir, executeInput({ id: "ghp_abcdef123456" }), {
		now: NOW,
	});
	assert.equal(tokenId.ok, false);
	assert.equal(tokenId.code, "AMBER_E_EXTERNAL_CREDENTIAL_LEAK");
	assert.equal(fs.existsSync(executionsPath(dir)), false);

	const prepared = executeExternalEffect(dir, executeInput(), { now: NOW });
	assert.equal(prepared.ok, true, (prepared.errors || []).join("; "));
	assert.equal(prepared.record.request, "request/1");
	assert.deepEqual(prepared.record.effect, { id: "effect/ticket-comment", version: "1" });
	assert.deepEqual(prepared.record.adapter, { id: "adapter/tracker", version: "1" });
	assert.equal(prepared.record.operation, "comment.create");
	assert.equal(prepared.record.target, "tracker/amber-protocol");
	assert.equal(prepared.record.idempotency, "idempotent");
	assert.equal(prepared.record.timeoutMs, 30_000);
	assert.deepEqual(prepared.record.credential, boundary());
	assert.equal(prepared.record.status, "prepared");
	assert.equal(prepared.record.outcome, null);
	const open = executeExternalEffect(dir, executeInput({ id: "execution/2" }), { now: NOW });
	assert.equal(open.ok, false);
	assert.match(open.errors[0], /is still open for this request; settle it before retrying/);
	const unauthorizedProposal = proposeExternalEffect(
		dir,
		{
			id: "request/2",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: `sha256:${"b".repeat(64)}`,
		},
		{ now: NOW },
	);
	assert.equal(unauthorizedProposal.ok, true);
	const unauthorized = executeExternalEffect(
		dir,
		executeInput({ id: "execution/2", request: "request/2" }),
		{ now: NOW },
	);
	assert.equal(unauthorized.ok, false);
	assert.match(unauthorized.errors[0], /is not authorized; execution follows authorization/);
});

test("a credentials-none contract refuses any credential boundary", () => {
	const dir = mkTarget("credential-none");
	proposalFixture(dir, ["decision/effect-1", "decision/effect-2"]);
	assert.equal(
		registerExternalEffect(
			dir,
			effectInput({
				id: "effect/announce",
				operation: "message.post",
				credentials: "none",
				decision: { identity: "decision/effect-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const proposed = proposeExternalEffect(
		dir,
		{ id: "request/1", effect: { id: "effect/announce", version: "1" }, payloadHash: PAYLOAD },
		{ now: NOW },
	);
	assert.equal(proposed.ok, true, (proposed.errors || []).join("; "));
	grantRequestApproval(dir, "approval/external-1", proposed.record.requestHash);
	assert.equal(
		authorizeExternalEffect(
			dir,
			{
				id: "request/1",
				approval: "approval/external-1",
				decisionIdentity: "decision/external-consume-1",
				body: "# Authorize\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
			},
			{ now: NOW },
		).ok,
		true,
	);
	const boundaryRefused = executeExternalEffect(dir, executeInput(), { now: NOW });
	assert.equal(boundaryRefused.ok, false);
	assert.match(boundaryRefused.errors[0], /declares credentials "none"; no credential boundary/);
	const bare = executeExternalEffect(dir, executeInput({ credential: null }), { now: NOW });
	assert.equal(bare.ok, true, (bare.errors || []).join("; "));
	assert.equal(bare.record.credential, null);
});

function settleInput(overrides = {}) {
	return {
		id: "execution/1",
		externalRecordId: "TRACK-1234",
		requestDigest: `sha256:${"d".repeat(64)}`,
		responseDigest: `sha256:${"e".repeat(64)}`,
		declared: "committed",
		...overrides,
	};
}

test("Amber, never the adapter, derives the settlement outcome", () => {
	const dir = mkTarget("settle");
	authorizedRequestFixture(dir);
	assert.equal(executeExternalEffect(dir, executeInput(), { now: NOW }).ok, true);

	const ghost = settleExternalExecution(dir, settleInput({ id: "execution/ghost" }), { now: NOW });
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_EXTERNAL_NOT_FOUND");
	const missingOutput = settleExternalExecution(dir, settleInput({ externalRecordId: null }), {
		now: NOW,
	});
	assert.equal(missingOutput.ok, false);
	assert.equal(missingOutput.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(missingOutput.errors[0], /missing output reads as its refusal, never success/);
	const hiddenRecord = settleExternalExecution(dir, settleInput({ declared: "failed" }), {
		now: NOW,
	});
	assert.equal(hiddenRecord.ok, false);
	assert.match(hiddenRecord.errors[0], /cannot declare "failed"; it settles as committed/);
	const hiddenDenied = settleExternalExecution(dir, settleInput({ declared: "denied" }), {
		now: NOW,
	});
	assert.equal(hiddenDenied.ok, false);
	assert.match(hiddenDenied.errors[0], /cannot declare "denied"; it settles as committed/);
	const chattyUnknown = settleExternalExecution(
		dir,
		settleInput({ declared: "unknown", externalRecordId: null }),
		{ now: NOW },
	);
	assert.equal(chattyUnknown.ok, false);
	assert.match(chattyUnknown.errors[0], /an output-bearing receipt cannot declare unknown/);
	const badDigest = settleExternalExecution(dir, settleInput({ requestDigest: "sha256:xyz" }), {
		now: NOW,
	});
	assert.equal(badDigest.ok, false);
	assert.match(badDigest.errors[0], /requestDigest must be a sha256:<64-hex> string/);
	const leakedRecord = settleExternalExecution(dir, settleInput({ externalRecordId: JWT_LIKE }), {
		now: NOW,
	});
	assert.equal(leakedRecord.ok, false);
	assert.equal(leakedRecord.code, "AMBER_E_EXTERNAL_CREDENTIAL_LEAK");

	const committed = settleExternalExecution(dir, settleInput(), { now: NOW });
	assert.equal(committed.ok, true, (committed.errors || []).join("; "));
	assert.equal(committed.record.status, "settled");
	assert.equal(committed.record.outcome, "committed");
	assert.equal(committed.record.settlement.declared, "committed");
	const again = settleExternalExecution(dir, settleInput(), { now: NOW });
	assert.equal(again.ok, false);
	assert.match(again.errors[0], /settled outcomes never re-settle/);
	const committedRetry = executeExternalEffect(dir, executeInput({ id: "execution/2" }), {
		now: NOW,
	});
	assert.equal(committedRetry.ok, false);
	assert.match(committedRetry.errors[0], /a retry never creates a duplicate external record/);
	assert.equal(showExternalExecution(dir, "execution/1").outcome, "committed");
	assert.equal(listExternalExecutions(dir, { request: "request/1" }).length, 1);
});

test("an unproven failure downgrades to attempted and retries by declared idempotency", () => {
	const dir = mkTarget("attempted");
	authorizedRequestFixture(dir);
	assert.equal(executeExternalEffect(dir, executeInput(), { now: NOW }).ok, true);
	const failed = settleExternalExecution(
		dir,
		settleInput({ externalRecordId: null, declared: "failed" }),
		{ now: NOW },
	);
	assert.equal(failed.ok, true, (failed.errors || []).join("; "));
	assert.equal(failed.record.outcome, "failed");
	// failed re-executes freely.
	assert.equal(
		executeExternalEffect(dir, executeInput({ id: "execution/2" }), { now: NOW }).ok,
		true,
	);
	const attempted = settleExternalExecution(
		dir,
		settleInput({
			id: "execution/2",
			externalRecordId: null,
			responseDigest: null,
			declared: "failed",
		}),
		{ now: NOW },
	);
	assert.equal(attempted.ok, true, (attempted.errors || []).join("; "));
	assert.equal(attempted.record.outcome, "attempted");
	// A proven denial derives denied — and denied re-executes freely too.
	assert.equal(
		executeExternalEffect(dir, executeInput({ id: "execution/2b" }), { now: NOW }).ok,
		true,
	);
	const denied = settleExternalExecution(
		dir,
		settleInput({ id: "execution/2b", externalRecordId: null, declared: "denied" }),
		{ now: NOW },
	);
	assert.equal(denied.ok, true, (denied.errors || []).join("; "));
	assert.equal(denied.record.outcome, "denied");
	// The contract declares idempotent, so an unconfirmed outcome retries.
	assert.equal(
		executeExternalEffect(dir, executeInput({ id: "execution/3" }), { now: NOW }).ok,
		true,
	);
	const unknown = settleExternalExecution(
		dir,
		settleInput({
			id: "execution/3",
			externalRecordId: null,
			responseDigest: null,
			declared: "unknown",
		}),
		{ now: NOW },
	);
	assert.equal(unknown.ok, true, (unknown.errors || []).join("; "));
	assert.equal(unknown.record.outcome, "unknown");
});

test("an at-most-once contract never retries through an unconfirmed outcome", () => {
	const dir = mkTarget("at-most-once");
	proposalFixture(dir, ["decision/effect-1", "decision/effect-2"]);
	assert.equal(
		registerExternalEffect(
			dir,
			effectInput({
				id: "effect/announce",
				operation: "message.post",
				idempotency: "at-most-once",
				decision: { identity: "decision/effect-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const proposed = proposeExternalEffect(
		dir,
		{ id: "request/1", effect: { id: "effect/announce", version: "1" }, payloadHash: PAYLOAD },
		{ now: NOW },
	);
	assert.equal(proposed.ok, true);
	grantRequestApproval(dir, "approval/external-1", proposed.record.requestHash);
	assert.equal(
		authorizeExternalEffect(
			dir,
			{
				id: "request/1",
				approval: "approval/external-1",
				decisionIdentity: "decision/external-consume-1",
				body: "# Authorize\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(executeExternalEffect(dir, executeInput(), { now: NOW }).ok, true);
	assert.equal(
		settleExternalExecution(
			dir,
			settleInput({
				externalRecordId: null,
				responseDigest: null,
				declared: "unknown",
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const retry = executeExternalEffect(dir, executeInput({ id: "execution/2" }), { now: NOW });
	assert.equal(retry.ok, false);
	assert.equal(retry.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(retry.errors[0], /at-most-once; reconcile with independent Evidence/);
});

test("reconciliation is the only path from unknown to committed and needs an independent producer", () => {
	const dir = mkTarget("reconcile");
	authorizedRequestFixture(dir);
	assert.equal(
		registerPrincipal(dir, { id: "auditor@example.com", principalKind: "service" }).ok,
		true,
	);
	const evidenceInput = (id, producer) => ({
		id,
		producer,
		assurance: "observed",
		scope: null,
		subject: "external/execution-1",
		inputs: null,
		tools: null,
		environment: null,
		outputs: null,
		status: "pass",
	});
	assert.equal(
		recordEvidence(dir, evidenceInput("evidence/reconcile-1", "auditor@example.com")).ok,
		true,
	);
	assert.equal(
		recordEvidence(dir, evidenceInput("evidence/self-serve", "bob@example.com")).ok,
		true,
	);
	assert.equal(executeExternalEffect(dir, executeInput(), { now: NOW }).ok, true);
	const reconcileInput = (overrides = {}) => ({
		id: "execution/1",
		evidence: "evidence/reconcile-1",
		externalRecordId: "TRACK-1234",
		...overrides,
	});
	const premature = reconcileExternalExecution(dir, reconcileInput(), { now: NOW });
	assert.equal(premature.ok, false);
	assert.match(premature.errors[0], /reconciliation is the only path from unknown to committed/);
	assert.equal(
		settleExternalExecution(
			dir,
			settleInput({ externalRecordId: null, responseDigest: null, declared: "unknown" }),
			{ now: NOW },
		).ok,
		true,
	);
	const ghostEvidence = reconcileExternalExecution(
		dir,
		reconcileInput({ evidence: "evidence/ghost" }),
		{ now: NOW },
	);
	assert.equal(ghostEvidence.ok, false);
	assert.match(ghostEvidence.errors[0], /is not recorded/);
	const selfServe = reconcileExternalExecution(
		dir,
		reconcileInput({ evidence: "evidence/self-serve" }),
		{ now: NOW },
	);
	assert.equal(selfServe.ok, false);
	assert.match(selfServe.errors[0], /reconciliation requires an independent producer/);
	const leaked = reconcileExternalExecution(dir, reconcileInput({ externalRecordId: JWT_LIKE }), {
		now: NOW,
	});
	assert.equal(leaked.ok, false);
	assert.equal(leaked.code, "AMBER_E_EXTERNAL_CREDENTIAL_LEAK");
	const reconciled = reconcileExternalExecution(dir, reconcileInput(), { now: NOW });
	assert.equal(reconciled.ok, true, (reconciled.errors || []).join("; "));
	assert.equal(reconciled.record.outcome, "committed");
	assert.equal(reconciled.record.reconciliation.evidence, "evidence/reconcile-1");
	assert.equal(reconciled.record.reconciliation.externalRecordId, "TRACK-1234");
	const again = reconcileExternalExecution(dir, reconcileInput(), { now: NOW });
	assert.equal(again.ok, false);
	assert.match(again.errors[0], /reconciliation is the only path from unknown to committed/);
});

test("one request commits at most once across retries and reconciliation", () => {
	const dir = mkTarget("single-commit");
	authorizedRequestFixture(dir);
	assert.equal(
		registerPrincipal(dir, { id: "auditor@example.com", principalKind: "service" }).ok,
		true,
	);
	assert.equal(
		recordEvidence(dir, {
			id: "evidence/reconcile-1",
			producer: "auditor@example.com",
			assurance: "observed",
			scope: null,
			subject: "external/execution-1",
			inputs: null,
			tools: null,
			environment: null,
			outputs: null,
			status: "pass",
		}).ok,
		true,
	);
	assert.equal(executeExternalEffect(dir, executeInput(), { now: NOW }).ok, true);
	assert.equal(
		settleExternalExecution(
			dir,
			settleInput({ externalRecordId: null, responseDigest: null, declared: "unknown" }),
			{ now: NOW },
		).ok,
		true,
	);
	// An idempotent retry opens; the older unknown cannot reconcile while
	// a sibling is open.
	assert.equal(
		executeExternalEffect(dir, executeInput({ id: "execution/2" }), { now: NOW }).ok,
		true,
	);
	const reconcileInput = {
		id: "execution/1",
		evidence: "evidence/reconcile-1",
		externalRecordId: "TRACK-1234",
	};
	const openSibling = reconcileExternalExecution(dir, reconcileInput, { now: NOW });
	assert.equal(openSibling.ok, false);
	assert.match(openSibling.errors[0], /still open; a request commits at most once/);
	// The retry commits; the older unknown can never also become committed.
	assert.equal(
		settleExternalExecution(dir, settleInput({ id: "execution/2" }), { now: NOW }).ok,
		true,
	);
	const committedSibling = reconcileExternalExecution(dir, reconcileInput, { now: NOW });
	assert.equal(committedSibling.ok, false);
	assert.match(committedSibling.errors[0], /already committed; a request commits at most once/);
	const retry = executeExternalEffect(dir, executeInput({ id: "execution/3" }), { now: NOW });
	assert.equal(retry.ok, false);
	assert.match(retry.errors[0], /already committed externally/);
	assert.ok(retry.errors[0].includes('execution "execution/2"'));
});

test("a reconciled commit blocks later retries even behind a newer failure", () => {
	const dir = mkTarget("reconciled-blocks");
	authorizedRequestFixture(dir);
	assert.equal(
		registerPrincipal(dir, { id: "auditor@example.com", principalKind: "service" }).ok,
		true,
	);
	assert.equal(
		recordEvidence(dir, {
			id: "evidence/reconcile-1",
			producer: "auditor@example.com",
			assurance: "observed",
			scope: null,
			subject: "external/execution-1",
			inputs: null,
			tools: null,
			environment: null,
			outputs: null,
			status: "pass",
		}).ok,
		true,
	);
	assert.equal(executeExternalEffect(dir, executeInput(), { now: NOW }).ok, true);
	assert.equal(
		settleExternalExecution(
			dir,
			settleInput({ externalRecordId: null, responseDigest: null, declared: "unknown" }),
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(
		executeExternalEffect(dir, executeInput({ id: "execution/2" }), { now: NOW }).ok,
		true,
	);
	assert.equal(
		settleExternalExecution(
			dir,
			settleInput({ id: "execution/2", externalRecordId: null, declared: "failed" }),
			{ now: NOW },
		).ok,
		true,
	);
	// The older unknown reconciles to committed while the latest attempt
	// is a failure...
	assert.equal(
		reconcileExternalExecution(
			dir,
			{ id: "execution/1", evidence: "evidence/reconcile-1", externalRecordId: "TRACK-1234" },
			{ now: NOW },
		).ok,
		true,
	);
	// ...and the committed older attempt still blocks any new retry.
	const retry = executeExternalEffect(dir, executeInput({ id: "execution/3" }), { now: NOW });
	assert.equal(retry.ok, false);
	assert.match(retry.errors[0], /already committed externally/);
	assert.ok(retry.errors[0].includes('execution "execution/1"'));
});

test("a tampered execution ledger fails every read closed", () => {
	const dir = mkTarget("exec-tamper");
	authorizedRequestFixture(dir);
	assert.equal(executeExternalEffect(dir, executeInput(), { now: NOW }).ok, true);
	assert.equal(
		settleExternalExecution(dir, settleInput({ externalRecordId: null, declared: "failed" }), {
			now: NOW,
		}).ok,
		true,
	);
	const pristine = readEvents(executionsPath(dir));
	const tampered = JSON.parse(JSON.stringify(pristine));
	tampered[1].outcome = "committed";
	writeEvents(executionsPath(dir), tampered);
	assert.throws(
		() => showExternalExecution(dir, "execution/1"),
		(err) =>
			err.amberCode === "AMBER_E_EXTERNAL_EXEC_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	// A validly re-chained rewritten verdict fails the derivation check:
	// the adapter's declaration can never become a different outcome.
	const { hash: _hash, ...settledBody } = tampered[1];
	const forged = { ...settledBody };
	forged.hash = chainHash(forged, forged.prevHash);
	writeEvents(executionsPath(dir), [pristine[0], forged]);
	assert.throws(
		() => showExternalExecution(dir, "execution/1"),
		(err) =>
			err.amberCode === "AMBER_E_EXTERNAL_EXEC_CORRUPT" &&
			/Amber, never the adapter, derives the outcome/.test(err.message),
	);
	// A validly re-chained leak forgery fails the read closed: credential
	// material cannot ride even a consistently re-hashed ledger.
	const leakForged = { ...settledBody, externalRecordId: JWT_LIKE, declared: "committed" };
	leakForged.outcome = "committed";
	leakForged.responseDigest = `sha256:${"e".repeat(64)}`;
	leakForged.hash = chainHash(leakForged, leakForged.prevHash);
	writeEvents(executionsPath(dir), [pristine[0], leakForged]);
	assert.throws(
		() => showExternalExecution(dir, "execution/1"),
		(err) =>
			err.amberCode === "AMBER_E_EXTERNAL_EXEC_CORRUPT" && /credential material/.test(err.message),
	);
	// A validly re-chained second settlement of a settled execution fails
	// the fold closed too.
	const duplicate = { ...pristine[1] };
	delete duplicate.hash;
	duplicate.prevHash = pristine[1].hash;
	duplicate.hash = chainHash(duplicate, duplicate.prevHash);
	writeEvents(executionsPath(dir), [...pristine, duplicate]);
	assert.throws(
		() => showExternalExecution(dir, "execution/1"),
		(err) =>
			err.amberCode === "AMBER_E_EXTERNAL_EXEC_CORRUPT" &&
			/settled outcomes never re-settle/.test(err.message),
	);
});

test("a fresh execution lock held by another writer refuses preparing", () => {
	const dir = mkTarget("exec-lock");
	authorizedRequestFixture(dir);
	const lockPath = path.join(dir, ".amber", "external", "executions.lock");
	fs.writeFileSync(lockPath, "holder-token-1");
	const contended = executeExternalEffect(dir, executeInput(), { now: NOW });
	assert.equal(contended.ok, false);
	assert.equal(contended.code, "AMBER_E_EXTERNAL_EXEC_LOCK");
	fs.rmSync(lockPath);
	assert.equal(executeExternalEffect(dir, executeInput(), { now: NOW }).ok, true);
});

// ---------------------------------------------------------------------------
// F056 T4 (#291) — compensation effects, MCP non-execution & transport
// isolation.
// ---------------------------------------------------------------------------

/** Authorized + executed original, with the declared compensating effect
 *  registered so compensation can ride the pipeline. */
function committedOriginalFixture(dir) {
	proposalFixture(dir, ["decision/effect-1", "decision/effect-2"]);
	assert.equal(
		registerExternalEffect(
			dir,
			effectInput({
				id: "effect/ticket-comment-delete",
				operation: "comment.delete",
				compensation: { kind: "irreversible" },
				decision: { identity: "decision/effect-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const proposed = proposeExternalEffect(
		dir,
		{
			id: "request/1",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: PAYLOAD,
		},
		{ now: NOW },
	);
	assert.equal(proposed.ok, true, (proposed.errors || []).join("; "));
	grantRequestApproval(dir, "approval/external-1", proposed.record.requestHash);
	assert.equal(
		authorizeExternalEffect(
			dir,
			{
				id: "request/1",
				approval: "approval/external-1",
				decisionIdentity: "decision/external-consume-1",
				body: "# Authorize external effect\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(executeExternalEffect(dir, executeInput(), { now: NOW }).ok, true);
}

test("compensation opens a new governed proposal referencing the original", () => {
	const dir = mkTarget("compensate");
	committedOriginalFixture(dir);
	const compensateInput = (overrides = {}) => ({
		id: "request/undo-1",
		execution: "execution/1",
		payloadHash: `sha256:${"b".repeat(64)}`,
		...overrides,
	});
	// A still-open execution has no terminal outcome to compensate.
	const premature = compensateExternalEffect(dir, compensateInput(), { now: NOW });
	assert.equal(premature.ok, false);
	assert.equal(premature.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(premature.errors[0], /only a committed or failed effect compensates/);
	assert.equal(settleExternalExecution(dir, settleInput(), { now: NOW }).ok, true);
	const ghost = compensateExternalEffect(dir, compensateInput({ execution: "execution/ghost" }), {
		now: NOW,
	});
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_EXTERNAL_NOT_FOUND");
	const compensated = compensateExternalEffect(dir, compensateInput(), { now: NOW });
	assert.equal(compensated.ok, true, (compensated.errors || []).join("; "));
	assert.equal(compensated.record.compensates, "execution/1");
	assert.deepEqual(compensated.record.effect, {
		id: "effect/ticket-comment-delete",
		version: "1",
	});
	assert.equal(compensated.record.status, "proposed");
	const duplicate = compensateExternalEffect(
		dir,
		compensateInput({ id: "request/undo-2", payloadHash: `sha256:${"c".repeat(64)}` }),
		{ now: NOW },
	);
	assert.equal(duplicate.ok, false);
	assert.match(duplicate.errors[0], /already has compensation proposal "request\/undo-1"/);

	// The compensation rides the full pipeline: own authorization, own
	// execution, own receipt.
	grantRequestApproval(dir, "approval/external-2", compensated.record.requestHash);
	assert.equal(
		authorizeExternalEffect(
			dir,
			{
				id: "request/undo-1",
				approval: "approval/external-2",
				decisionIdentity: "decision/external-consume-2",
				body: "# Authorize compensation\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(
		executeExternalEffect(
			dir,
			executeInput({ id: "execution/undo-1", request: "request/undo-1" }),
			{ now: NOW },
		).ok,
		true,
	);
	let transactions = listExternalTransactions(dir, { request: "request/1" });
	assert.equal(transactions.length, 1);
	assert.equal(transactions[0].compensated, false);
	assert.equal(transactions[0].compensatedBy.proposal, "request/undo-1");
	assert.equal(transactions[0].compensatedBy.execution, null);
	assert.equal(
		settleExternalExecution(
			dir,
			settleInput({ id: "execution/undo-1", externalRecordId: "TRACK-1234-DEL" }),
			{ now: NOW },
		).ok,
		true,
	);
	transactions = listExternalTransactions(dir, { request: "request/1" });
	assert.equal(transactions[0].compensated, true);
	assert.equal(transactions[0].compensatedBy.execution, "execution/undo-1");
	// The original outcome is never rewritten: the linkage is read-time.
	assert.equal(showExternalExecution(dir, "execution/1").outcome, "committed");
	assert.equal(showExternalExecution(dir, "execution/1").compensated, undefined);
	const compensationRow = listExternalTransactions(dir, { request: "request/undo-1" })[0];
	assert.equal(compensationRow.compensated, false);
	assert.equal(compensationRow.compensatedBy, null);
});

test("an irreversible contract refuses compensation and unregistered compensations refuse", () => {
	const dir = mkTarget("irreversible");
	proposalFixture(dir, ["decision/effect-1", "decision/effect-2"]);
	// The default fixture contract declares effect/ticket-comment-delete,
	// which is NOT registered here.
	const proposed = proposeExternalEffect(
		dir,
		{
			id: "request/1",
			effect: { id: "effect/ticket-comment", version: "1" },
			payloadHash: PAYLOAD,
		},
		{ now: NOW },
	);
	assert.equal(proposed.ok, true);
	grantRequestApproval(dir, "approval/external-1", proposed.record.requestHash);
	assert.equal(
		authorizeExternalEffect(
			dir,
			{
				id: "request/1",
				approval: "approval/external-1",
				decisionIdentity: "decision/external-consume-1",
				body: "# Authorize\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(executeExternalEffect(dir, executeInput(), { now: NOW }).ok, true);
	assert.equal(settleExternalExecution(dir, settleInput(), { now: NOW }).ok, true);
	const unregistered = compensateExternalEffect(
		dir,
		{ id: "request/undo-1", execution: "execution/1", payloadHash: `sha256:${"b".repeat(64)}` },
		{ now: NOW },
	);
	assert.equal(unregistered.ok, false);
	assert.equal(unregistered.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(unregistered.errors[0], /register the declared compensation contract/);

	// An irreversible original refuses compensation outright.
	assert.equal(
		registerExternalEffect(
			dir,
			effectInput({
				id: "effect/announce",
				operation: "message.post",
				compensation: { kind: "irreversible" },
				decision: { identity: "decision/effect-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const proposedB = proposeExternalEffect(
		dir,
		{
			id: "request/2",
			effect: { id: "effect/announce", version: "1" },
			payloadHash: `sha256:${"c".repeat(64)}`,
		},
		{ now: NOW },
	);
	assert.equal(proposedB.ok, true);
	grantRequestApproval(dir, "approval/external-2", proposedB.record.requestHash);
	assert.equal(
		authorizeExternalEffect(
			dir,
			{
				id: "request/2",
				approval: "approval/external-2",
				decisionIdentity: "decision/external-consume-2",
				body: "# Authorize\n",
				traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
			},
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(
		executeExternalEffect(dir, executeInput({ id: "execution/2", request: "request/2" }), {
			now: NOW,
		}).ok,
		true,
	);
	assert.equal(
		settleExternalExecution(dir, settleInput({ id: "execution/2", externalRecordId: "MSG-1" }), {
			now: NOW,
		}).ok,
		true,
	);
	const refused = compensateExternalEffect(
		dir,
		{ id: "request/undo-2", execution: "execution/2", payloadHash: `sha256:${"d".repeat(64)}` },
		{ now: NOW },
	);
	assert.equal(refused.ok, false);
	assert.equal(refused.code, "AMBER_E_EXTERNAL_INVALID");
	assert.match(refused.errors[0], /an irreversible contract refuses compensation/);
});

test("the MCP seam exposes no external execution surface", () => {
	const { COMMAND_CAPABILITIES } = require("../../scripts/lib/mcp-action-contracts");
	// External writes are approval-required submissions only and never
	// spawned (ADR-0022/F018): the MCP capability registry carries no
	// external verb at all, so no registry-proven read-only variant can
	// ever auto-execute one.
	const externalCapabilities = Object.keys(COMMAND_CAPABILITIES).filter((key) =>
		key.split(/[\s.:/-]/).includes("external"),
	);
	assert.deepEqual(externalCapabilities, []);
});

test("the external registry never touches the sync transport surface", () => {
	// ADR-0020's self-owned git transport exception stays isolated: the
	// external surface shares no module, code, or state path with it,
	// and never spawns a process.
	const sources = ["scripts/lib/core/external-registry.js", "scripts/lib/external-commands.js"].map(
		(file) => fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8"),
	);
	for (const source of sources) {
		assert.equal(/sync-transport|transport-ledger|AMBER_E_SYNC/.test(source), false);
		assert.equal(/child_process|execSync|spawn/.test(source), false);
	}
	const dir = mkTarget("isolation");
	for (const ledger of [effectsPath(dir), proposalsPath(dir), executionsPath(dir)]) {
		assert.match(ledger.replaceAll("\\", "/"), /\.amber\/external\//);
	}
});

test("v1 proposal events without the compensates linkage stay readable", () => {
	const dir = mkTarget("v1-proposals");
	proposalFixture(dir);
	assert.equal(
		proposeExternalEffect(
			dir,
			{
				id: "request/1",
				effect: { id: "effect/ticket-comment", version: "1" },
				payloadHash: PAYLOAD,
			},
			{ now: NOW },
		).ok,
		true,
	);
	// Rewrite the ledger as a schemaVersion-1 event without compensates —
	// exactly what the committed T2/T3 code wrote before the linkage
	// existed — re-chained validly.
	const pristine = readEvents(proposalsPath(dir));
	const { hash: _hash, compensates: _compensates, ...v1Body } = pristine[0];
	const v1 = { ...v1Body, schemaVersion: 1 };
	v1.hash = chainHash(v1, v1.prevHash);
	writeEvents(proposalsPath(dir), [v1]);
	const folded = showExternalProposal(dir, "request/1");
	assert.equal(folded.compensates, null);
	assert.equal(folded.schemaVersion, 1);
	// A v1 event smuggling the field it predates refuses.
	const smuggled = { ...v1Body, schemaVersion: 1, compensates: "execution/1" };
	delete smuggled.hash;
	smuggled.hash = chainHash(smuggled, smuggled.prevHash);
	writeEvents(proposalsPath(dir), [smuggled]);
	assert.throws(
		() => showExternalProposal(dir, "request/1"),
		(err) =>
			err.amberCode === "AMBER_E_EXTERNAL_PROPOSAL_CORRUPT" &&
			/unknown field "compensates"/.test(err.message),
	);
});

test("a compensation proposal drift-refuses at authorization like any request", () => {
	const dir = mkTarget("compensation-drift");
	committedOriginalFixture(dir);
	assert.equal(settleExternalExecution(dir, settleInput(), { now: NOW }).ok, true);
	const compensated = compensateExternalEffect(
		dir,
		{
			id: "request/undo-1",
			execution: "execution/1",
			payloadHash: `sha256:${"b".repeat(64)}`,
		},
		{ now: NOW },
	);
	assert.equal(compensated.ok, true, (compensated.errors || []).join("; "));
	grantRequestApproval(dir, "approval/external-2", compensated.record.requestHash);
	// A new version of the compensating contract registered after the
	// compensation proposal drifts its authorization closed.
	assert.equal(
		admitArtifact(dir, {
			type: "decision",
			identity: "decision/effect-3",
			body: "# decision/effect-3\n",
			decisionKind: "approval",
			principal: "legal@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/external" } }],
		}).ok,
		true,
	);
	assert.equal(
		registerExternalEffect(
			dir,
			effectInput({
				id: "effect/ticket-comment-delete",
				version: "2",
				operation: "comment.delete",
				compensation: { kind: "irreversible" },
				decision: { identity: "decision/effect-3", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const drifted = authorizeExternalEffect(
		dir,
		{
			id: "request/undo-1",
			approval: "approval/external-2",
			decisionIdentity: "decision/external-consume-2",
			body: "# Authorize compensation\n",
		},
		{ now: NOW },
	);
	assert.equal(drifted.ok, false);
	assert.equal(drifted.code, "AMBER_E_EXTERNAL_DRIFT");
});
