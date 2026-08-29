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
} = require("../../scripts/lib/core/external-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { registerAdapter } = require("../../scripts/lib/core/adapter-registry");
const { grantApproval, showApproval } = require("../../scripts/lib/core/approval-registry");

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
	assert.equal(EXTERNAL_SCHEMA_VERSION, 1);
	assert.deepEqual([...SUPPORTED_EXTERNAL_SCHEMA_VERSIONS], [1]);
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
