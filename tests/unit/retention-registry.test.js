"use strict";

// F055 T1 (#283) — retention classes & deterministic expiry evaluation.
//
// Tests assert externally visible behavior: classification binds the
// class basis from the pinned committed tenant Policy at classification
// time, re-classification appends (latest wins, nothing edited), declared
// sensitive content refuses without a minimization marker, expiry
// evaluation is a pure function of the recorded basis and an injected
// clock, and tampered ledgers fail every read closed with stable
// AMBER_E_RETENTION_* codes.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	RETENTION_SCHEMA_VERSION,
	SUPPORTED_RETENTION_SCHEMA_VERSIONS,
	DEFAULT_MAX_RETENTION_BYTES,
	MAX_RETENTION_TTL_MS,
	RETENTION_CLASSES,
	RETENTION_SENSITIVITIES,
	GENESIS_HASH,
	chainHash,
	classificationsPath,
	classify,
	evaluateRetention,
	listClassifications,
	RETENTION_DECISION_KINDS,
	HOLD_STATUSES,
	holdsPath,
	hold,
	releaseHold,
	listHolds,
	HOLDER_SURFACES,
	CANDIDATE_STATUSES,
	holdersPath,
	registerHolder,
	listHolders,
	candidatesPath,
	prepareDeletionCandidate,
	authorizeDeletion,
	showDeletionCandidate,
	listDeletionCandidates,
} = require("../../scripts/lib/core/retention-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { registerAdapter } = require("../../scripts/lib/core/adapter-registry");
const { grantApproval } = require("../../scripts/lib/core/approval-registry");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-retention-${label}-`));
}

const NOW = new Date("2026-08-29T00:00:00.000Z");
const HOUR_MS = 3_600_000;

/** One committed record + one committed retention Policy with two classes. */
function retentionFixture(dir) {
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
					classes: {
						operational: { ttlMs: HOUR_MS, legalBasis: "ops-contract" },
						audit: { ttlMs: 24 * HOUR_MS, legalBasis: "audit-obligation" },
					},
				},
			},
		}).ok,
		true,
	);
}

function classifyInput(overrides = {}) {
	return {
		record: { type: "intent", identity: "intent/login", revision: 1 },
		retentionClass: "operational",
		policy: { identity: "policy/tenant-retention", revision: 1 },
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

test("retention constants pin the class, sensitivity, and schema contracts", () => {
	assert.equal(RETENTION_SCHEMA_VERSION, 1);
	assert.deepEqual([...SUPPORTED_RETENTION_SCHEMA_VERSIONS], [1]);
	assert.equal(DEFAULT_MAX_RETENTION_BYTES, 1024 * 1024);
	assert.equal(MAX_RETENTION_TTL_MS, 100 * 365 * 24 * 3_600_000);
	assert.deepEqual([...RETENTION_CLASSES], ["ephemeral", "operational", "governance", "audit"]);
	assert.deepEqual([...RETENTION_SENSITIVITIES], ["none", "secret", "personal"]);
});

test("classify binds the class basis from the pinned committed Policy at classification time", () => {
	const dir = mkTarget("classify");
	retentionFixture(dir);
	const result = classify(dir, classifyInput(), { now: NOW });
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.deepEqual(result.record.record, { type: "intent", identity: "intent/login", revision: 1 });
	assert.equal(result.record.retentionClass, "operational");
	assert.equal(result.record.ttlMs, HOUR_MS);
	assert.equal(result.record.legalBasis, "ops-contract");
	assert.deepEqual(result.record.policy, { identity: "policy/tenant-retention", revision: 1 });
	assert.equal(result.record.sensitivity, "none");
	assert.equal(result.record.minimized, false);
	assert.equal(result.record.at, NOW.toISOString());
	const events = readEvents(classificationsPath(dir));
	assert.equal(events.length, 1);
	assert.equal(events[0].prevHash, GENESIS_HASH);
	assert.equal(events[0].hash, chainHash(events[0], GENESIS_HASH));
});

test("re-classification appends and the latest classification is effective", () => {
	const dir = mkTarget("reclassify");
	retentionFixture(dir);
	assert.equal(classify(dir, classifyInput(), { now: NOW }).ok, true);
	const upgraded = classify(dir, classifyInput({ retentionClass: "audit" }), { now: NOW });
	assert.equal(upgraded.ok, true, (upgraded.errors || []).join("; "));
	assert.equal(upgraded.record.retentionClass, "audit");
	assert.equal(upgraded.record.ttlMs, 24 * HOUR_MS);
	const all = listClassifications(dir);
	assert.equal(all.length, 2);
	assert.equal(all[0].current, false);
	assert.equal(all[1].current, true);
	// Append-only: the first event's bytes are a stable prefix.
	const events = readEvents(classificationsPath(dir));
	assert.equal(events[1].prevHash, events[0].hash);
	assert.equal(listClassifications(dir, { type: "spec" }).length, 0);
	assert.equal(listClassifications(dir, { identity: "intent/login" }).length, 2);
});

test("classification refuses unknown vocabulary, unresolved pins, and ghost records", () => {
	const dir = mkTarget("classify-refusals");
	retentionFixture(dir);
	const cases = [
		[classifyInput({ retentionClass: "forever" }), /retentionClass must be one of/],
		[
			classifyInput({ policy: { identity: "policy/ghost", revision: 1 } }),
			/does not resolve to a committed policy artifact revision/,
		],
		[
			classifyInput({ retentionClass: "ephemeral" }),
			/declares no basis for retention class "ephemeral"/,
		],
		[classifyInput({ command: "rm" }), /unknown field "command"/],
		[
			classifyInput({ record: { type: "intent", identity: "intent/login" } }),
			/record is missing field "revision"/,
		],
		[classifyInput({ sensitivity: "medical" }), /sensitivity must be one of/],
	];
	for (const [input, pattern] of cases) {
		const result = classify(dir, input, { now: NOW });
		assert.equal(result.ok, false, JSON.stringify(input));
		assert.equal(result.code, "AMBER_E_RETENTION_INVALID");
		assert.match(result.errors[0], pattern);
	}
	// A policy without the retention extensions carrier refuses.
	assert.equal(
		admitArtifact(dir, { type: "policy", identity: "policy/bare", body: "# P\n" }).ok,
		true,
	);
	const bare = classify(dir, classifyInput({ policy: { identity: "policy/bare", revision: 1 } }), {
		now: NOW,
	});
	assert.equal(bare.ok, false);
	assert.match(bare.errors[0], /declares no retention classes/);
	// A policy declaring an overflowing TTL refuses instead of classifying
	// something evaluation could never settle.
	assert.equal(
		admitArtifact(dir, {
			type: "policy",
			identity: "policy/forever",
			body: "# P\n",
			extensions: {
				retention: {
					classes: { operational: { ttlMs: Number.MAX_SAFE_INTEGER, legalBasis: "x" } },
				},
			},
		}).ok,
		true,
	);
	const overflowing = classify(
		dir,
		classifyInput({ policy: { identity: "policy/forever", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(overflowing.ok, false);
	assert.match(overflowing.errors[0], /declares an out-of-range ttlMs/);
	const ghost = classify(
		dir,
		classifyInput({ record: { type: "intent", identity: "intent/ghost", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_RETENTION_NOT_FOUND");
	assert.equal(fs.existsSync(classificationsPath(dir)), false);
});

test("declared sensitive content must carry a minimization marker", () => {
	const dir = mkTarget("sensitivity");
	retentionFixture(dir);
	const unsafe = classify(dir, classifyInput({ sensitivity: "personal" }), { now: NOW });
	assert.equal(unsafe.ok, false);
	assert.equal(unsafe.code, "AMBER_E_RETENTION_INVALID");
	assert.match(unsafe.errors[0], /must be minimized before classification/);
	const pointless = classify(dir, classifyInput({ minimized: true }), { now: NOW });
	assert.equal(pointless.ok, false);
	assert.match(pointless.errors[0], /requires declared secret or personal sensitivity/);
	const minimized = classify(dir, classifyInput({ sensitivity: "secret", minimized: true }), {
		now: NOW,
	});
	assert.equal(minimized.ok, true, (minimized.errors || []).join("; "));
	assert.equal(minimized.record.sensitivity, "secret");
	assert.equal(minimized.record.minimized, true);
});

test("expiry evaluation is a deterministic half-open function of the recorded basis", () => {
	const dir = mkTarget("evaluate");
	retentionFixture(dir);
	assert.equal(classify(dir, classifyInput(), { now: NOW }).ok, true);
	const justBefore = evaluateRetention(dir, {
		now: new Date(NOW.getTime() + HOUR_MS - 1),
	});
	assert.equal(justBefore.ok, true, (justBefore.errors || []).join("; "));
	assert.equal(justBefore.record.entries.length, 1);
	assert.equal(justBefore.record.entries[0].verdict, "retained");
	assert.equal(
		justBefore.record.entries[0].expiresAt,
		new Date(NOW.getTime() + HOUR_MS).toISOString(),
	);
	const atBoundary = evaluateRetention(dir, { now: new Date(NOW.getTime() + HOUR_MS) });
	assert.equal(atBoundary.record.entries[0].verdict, "expired-eligible");
	// Deterministic: the same clock always yields the same report.
	assert.deepEqual(
		evaluateRetention(dir, { now: new Date(NOW.getTime() + HOUR_MS) }).record,
		atBoundary.record,
	);
	// The LATEST classification governs: re-classify to audit (24h TTL).
	assert.equal(classify(dir, classifyInput({ retentionClass: "audit" }), { now: NOW }).ok, true);
	const upgraded = evaluateRetention(dir, { now: new Date(NOW.getTime() + HOUR_MS) });
	assert.equal(upgraded.record.entries.length, 1);
	assert.equal(upgraded.record.entries[0].verdict, "retained");
	assert.equal(upgraded.record.entries[0].retentionClass, "audit");
	// Evaluation is read-only: the ledger bytes never change.
	const before = fs.readFileSync(classificationsPath(dir), "utf8");
	evaluateRetention(dir, { now: NOW });
	assert.equal(fs.readFileSync(classificationsPath(dir), "utf8"), before);
});

test("a tampered classification ledger fails every read closed", () => {
	const dir = mkTarget("tamper");
	retentionFixture(dir);
	assert.equal(classify(dir, classifyInput(), { now: NOW }).ok, true);
	assert.equal(classify(dir, classifyInput({ retentionClass: "audit" }), { now: NOW }).ok, true);
	const events = readEvents(classificationsPath(dir));
	events[1].ttlMs = 1;
	writeEvents(classificationsPath(dir), events);
	assert.throws(
		() => listClassifications(dir),
		(err) =>
			err.amberCode === "AMBER_E_RETENTION_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	const evaluated = evaluateRetention(dir, { now: NOW });
	assert.equal(evaluated.ok, false);
	assert.equal(evaluated.code, "AMBER_E_RETENTION_CORRUPT");
	const blocked = classify(dir, classifyInput(), { now: NOW });
	assert.equal(blocked.ok, false);
	assert.equal(blocked.code, "AMBER_E_RETENTION_CORRUPT");
	// A validly re-chained forgery with a smuggled field fails shape
	// validation: raw content cannot ride a classification event.
	const { hash: _hash, ...rest } = events[0];
	const forged = { ...rest, rawContent: "secret dump" };
	forged.hash = chainHash(forged, forged.prevHash);
	writeEvents(classificationsPath(dir), [forged]);
	assert.throws(
		() => listClassifications(dir),
		(err) =>
			err.amberCode === "AMBER_E_RETENTION_CORRUPT" &&
			/unknown field "rawContent"/.test(err.message),
	);
});

/** Principal + intent + one committed human Decision per identity. */
function holdFixture(dir, decisionIdentities) {
	assert.equal(
		registerPrincipal(dir, { id: "legal@example.com", principalKind: "human" }).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/retention", body: "# R\n" }).ok,
		true,
	);
	for (const identity of decisionIdentities) {
		const decision = admitArtifact(dir, {
			type: "decision",
			identity,
			body: `# ${identity}\n`,
			decisionKind: "approval",
			principal: "legal@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/retention" } }],
		});
		assert.equal(decision.ok, true, (decision.errors || []).join("; "));
	}
}

function holdInput(overrides = {}) {
	return {
		id: "hold/litigation-42",
		scope: { subject: "intent/login" },
		reason: "litigation hold",
		decision: { identity: "decision/hold-1", revision: 1 },
		...overrides,
	};
}

test("a Legal Hold binds scope, reason, issuer, and effective time immutably", () => {
	assert.deepEqual([...HOLD_STATUSES], ["active", "released"]);
	assert.deepEqual([...RETENTION_DECISION_KINDS], ["acceptance", "approval"]);
	const dir = mkTarget("hold");
	retentionFixture(dir);
	holdFixture(dir, ["decision/hold-1", "decision/hold-2"]);
	const created = hold(dir, holdInput(), { now: NOW });
	assert.equal(created.ok, true, (created.errors || []).join("; "));
	assert.equal(created.record.id, "hold/litigation-42");
	assert.deepEqual(created.record.scope, { subject: "intent/login" });
	assert.equal(created.record.reason, "litigation hold");
	assert.equal(created.record.effectiveAt, NOW.toISOString());
	assert.equal(created.record.status, "active");
	assert.equal(created.record.release, null);
	assert.deepEqual(created.record.issuer, {
		identity: "decision/hold-1",
		revision: 1,
		decisionKind: "approval",
		principal: "legal@example.com",
	});
	const duplicate = hold(
		dir,
		holdInput({ decision: { identity: "decision/hold-2", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(duplicate.ok, false);
	assert.equal(duplicate.code, "AMBER_E_RETENTION_INVALID");
	assert.match(duplicate.errors[0], /already exists/);
	// A record-scoped hold is also expressible.
	const recordScoped = hold(
		dir,
		holdInput({
			id: "hold/record-1",
			scope: { record: { type: "intent", identity: "intent/login", revision: 1 } },
			decision: { identity: "decision/hold-2", revision: 1 },
		}),
		{ now: NOW },
	);
	assert.equal(recordScoped.ok, true, (recordScoped.errors || []).join("; "));
});

test("Legal Hold overrides TTL and release restores ordinary expiry", () => {
	const dir = mkTarget("hold-priority");
	retentionFixture(dir);
	holdFixture(dir, ["decision/hold-1", "decision/release-1"]);
	assert.equal(classify(dir, classifyInput(), { now: NOW }).ok, true);
	const expired = new Date(NOW.getTime() + HOUR_MS);
	assert.equal(
		evaluateRetention(dir, { now: expired }).record.entries[0].verdict,
		"expired-eligible",
	);
	assert.equal(hold(dir, holdInput(), { now: NOW }).ok, true);
	const held = evaluateRetention(dir, { now: expired }).record.entries[0];
	assert.equal(held.verdict, "retained-by-hold");
	assert.deepEqual(held.heldBy, ["hold/litigation-42"]);
	const released = releaseHold(
		dir,
		{
			id: "hold/litigation-42",
			decision: { identity: "decision/release-1", revision: 1 },
		},
		{ now: expired },
	);
	assert.equal(released.ok, true, (released.errors || []).join("; "));
	assert.equal(released.record.status, "released");
	assert.deepEqual(released.record.release.decision.identity, "decision/release-1");
	// Ordinary expiry is restored, and the released hold stays listable.
	assert.equal(
		evaluateRetention(dir, { now: expired }).record.entries[0].verdict,
		"expired-eligible",
	);
	assert.equal(listHolds(dir).length, 1);
	assert.equal(listHolds(dir, { status: "released" }).length, 1);
	assert.equal(listHolds(dir, { status: "active" }).length, 0);
});

test("record-pinned holds retain exactly their revision; subject holds cover every revision", () => {
	const dir = mkTarget("hold-scope");
	retentionFixture(dir);
	holdFixture(dir, ["decision/hold-1", "decision/hold-2"]);
	// A second committed revision of the record, classified separately.
	assert.equal(
		admitArtifact(dir, {
			type: "intent",
			identity: "intent/login",
			body: "# L2\n",
			expectedHead: 1,
		}).ok,
		true,
	);
	assert.equal(classify(dir, classifyInput(), { now: NOW }).ok, true);
	assert.equal(
		classify(
			dir,
			classifyInput({ record: { type: "intent", identity: "intent/login", revision: 2 } }),
			{ now: NOW },
		).ok,
		true,
	);
	const expired = new Date(NOW.getTime() + HOUR_MS);
	// Record-pinned hold on revision 1 only.
	assert.equal(
		hold(
			dir,
			holdInput({
				id: "hold/rev-1",
				scope: { record: { type: "intent", identity: "intent/login", revision: 1 } },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	let entries = evaluateRetention(dir, { now: expired }).record.entries;
	assert.equal(entries.find((entry) => entry.record.revision === 1).verdict, "retained-by-hold");
	assert.deepEqual(entries.find((entry) => entry.record.revision === 1).heldBy, ["hold/rev-1"]);
	assert.equal(entries.find((entry) => entry.record.revision === 2).verdict, "expired-eligible");
	// Subject hold covers every revision of the identity.
	assert.equal(
		hold(
			dir,
			holdInput({
				id: "hold/subject",
				scope: { subject: "intent/login" },
				decision: { identity: "decision/hold-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	entries = evaluateRetention(dir, { now: expired }).record.entries;
	assert.deepEqual(entries.find((entry) => entry.record.revision === 1).heldBy, [
		"hold/rev-1",
		"hold/subject",
	]);
	assert.deepEqual(entries.find((entry) => entry.record.revision === 2).heldBy, ["hold/subject"]);
	assert.equal(entries.find((entry) => entry.record.revision === 2).verdict, "retained-by-hold");
});

test("hold and release Decisions are single-use and human-only", () => {
	const dir = mkTarget("hold-authority");
	retentionFixture(dir);
	holdFixture(dir, ["decision/hold-1", "decision/release-1"]);
	assert.equal(hold(dir, holdInput(), { now: NOW }).ok, true);
	// The creation Decision can never also create or release another hold.
	const reused = hold(dir, holdInput({ id: "hold/second", scope: { subject: "intent/other" } }), {
		now: NOW,
	});
	assert.equal(reused.ok, false);
	assert.match(reused.errors[0], /single-use across the hold ledger/);
	assert.equal(
		releaseHold(
			dir,
			{ id: "hold/litigation-42", decision: { identity: "decision/hold-1", revision: 1 } },
			{ now: NOW },
		).ok,
		false,
	);
	// Release settles once; double-release and ghost-release refuse.
	assert.equal(
		releaseHold(
			dir,
			{ id: "hold/litigation-42", decision: { identity: "decision/release-1", revision: 1 } },
			{ now: NOW },
		).ok,
		true,
	);
	const again = releaseHold(
		dir,
		{ id: "hold/litigation-42", decision: { identity: "decision/release-1", revision: 1 } },
		{ now: NOW },
	);
	assert.equal(again.ok, false);
	assert.match(again.errors[0], /already released/);
	// … and a spent release Decision can never create a new hold either.
	const spentRelease = hold(
		dir,
		holdInput({
			id: "hold/third",
			scope: { subject: "intent/third" },
			decision: { identity: "decision/release-1", revision: 1 },
		}),
		{ now: NOW },
	);
	assert.equal(spentRelease.ok, false);
	assert.match(spentRelease.errors[0], /already authorized the release of hold/);
	const ghost = releaseHold(
		dir,
		{ id: "hold/ghost", decision: { identity: "decision/release-1", revision: 1 } },
		{ now: NOW },
	);
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_RETENTION_NOT_FOUND");
	// Non-human and scoped Decisions refuse; ghosts refuse.
	const unknownDecision = hold(
		dir,
		holdInput({ id: "hold/x", decision: { identity: "decision/ghost", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(unknownDecision.ok, false);
	assert.match(unknownDecision.errors[0], /not a committed Decision artifact/);
	assert.equal(
		admitArtifact(dir, {
			type: "decision",
			identity: "decision/review-1",
			body: "# r\n",
			decisionKind: "review",
			principal: "legal@example.com",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/retention" } }],
		}).ok,
		true,
	);
	const review = hold(
		dir,
		holdInput({ id: "hold/x", decision: { identity: "decision/review-1", revision: 1 } }),
		{ now: NOW },
	);
	assert.equal(review.ok, false);
	assert.match(review.errors[0], /requires a human acceptance or approval Decision/);
	const bothScopes = hold(
		dir,
		holdInput({
			id: "hold/x",
			scope: {
				subject: "intent/login",
				record: { type: "intent", identity: "intent/login", revision: 1 },
			},
		}),
		{ now: NOW },
	);
	assert.equal(bothScopes.ok, false);
	assert.match(bothScopes.errors[0], /exactly one of record or subject/);
});

test("a tampered hold ledger fails every read closed", () => {
	const dir = mkTarget("hold-tamper");
	retentionFixture(dir);
	holdFixture(dir, ["decision/hold-1", "decision/hold-2"]);
	assert.equal(hold(dir, holdInput(), { now: NOW }).ok, true);
	assert.equal(
		hold(
			dir,
			holdInput({
				id: "hold/second",
				scope: { subject: "intent/other" },
				decision: { identity: "decision/hold-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const events = readEvents(holdsPath(dir));
	events[1].reason = "edited";
	writeEvents(holdsPath(dir), events);
	assert.throws(
		() => listHolds(dir),
		(err) =>
			err.amberCode === "AMBER_E_RETENTION_HOLD_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	const evaluated = evaluateRetention(dir, { now: NOW });
	assert.equal(evaluated.ok, false);
	assert.equal(evaluated.code, "AMBER_E_RETENTION_HOLD_CORRUPT");
	// A validly re-chained release of a released hold fails closed too.
	const clean = events.slice(0, 1);
	const releaseBody = {
		kind: "release",
		schemaVersion: 1,
		at: NOW.toISOString(),
		id: "hold/litigation-42",
		decision: clean[0].decision,
	};
	const chained = (body, prevHash) => ({ ...body, prevHash, hash: chainHash(body, prevHash) });
	const first = chained(releaseBody, clean[0].hash);
	writeEvents(holdsPath(dir), [clean[0], first, chained(releaseBody, first.hash)]);
	assert.throws(
		() => listHolds(dir),
		(err) =>
			err.amberCode === "AMBER_E_RETENTION_HOLD_CORRUPT" &&
			/releases an already-released hold/.test(err.message),
	);
});

/** Adapter + holder decisions on top of the hold fixture. */
function deletionFixture(dir) {
	retentionFixture(dir);
	holdFixture(dir, ["decision/hold-1", "decision/holder-1", "decision/holder-2"]);
	const registered = registerAdapter(dir, {
		id: "adapter/store",
		owner: "storage-team",
		adapterVersion: "1",
		recordTypes: [{ type: "canonical-record", versions: ["v1"] }],
		scope: "F055",
		identityMapping: { strategy: "path" },
		freshness: { maxAgeMs: 86_400_000 },
		permissions: { readOnly: true, allowedPaths: ["store"] },
	});
	assert.equal(registered.ok, true, (registered.errors || []).join("; "));
}

function holderInput(overrides = {}) {
	return {
		id: "holder/canonical-body",
		version: "1",
		surface: "canonical-body",
		adapter: { id: "adapter/store", version: "1" },
		decision: { identity: "decision/holder-1", revision: 1 },
		...overrides,
	};
}

test("a Holder binds one closed surface to a registered Adapter pin", () => {
	assert.deepEqual(
		[...HOLDER_SURFACES],
		["canonical-body", "raw-output", "cache", "index", "export", "subscription", "external"],
	);
	assert.deepEqual([...CANDIDATE_STATUSES], ["prepared", "authorized"]);
	const dir = mkTarget("holder");
	deletionFixture(dir);
	const registered = registerHolder(dir, holderInput(), { now: NOW });
	assert.equal(registered.ok, true, (registered.errors || []).join("; "));
	assert.equal(registered.record.surface, "canonical-body");
	assert.deepEqual(registered.record.adapter, { id: "adapter/store", version: "1" });
	assert.equal(registered.record.decision.principal, "legal@example.com");
	assert.equal(listHolders(dir).length, 1);
	const cases = [
		[holderInput({ surface: "everything" }), /surface must be one of/],
		[
			holderInput({ adapter: { id: "adapter/ghost", version: "1" } }),
			/adapter "adapter\/ghost" is not registered/,
		],
		[
			holderInput({ adapter: { id: "adapter/store", version: "9" } }),
			/registered at version "1", not the pinned "9"/,
		],
		[
			holderInput({ decision: { identity: "decision/holder-2", revision: 1 } }),
			/already registered; a changed declaration registers a new version/,
		],
		[
			holderInput({ id: "holder/second" }),
			/already authorized holder "holder\/canonical-body@1"; a registration Decision is single-use/,
		],
	];
	for (const [input, pattern] of cases) {
		const result = registerHolder(dir, input, { now: NOW });
		assert.equal(result.ok, false, JSON.stringify(input));
		assert.match(result.errors[0], pattern);
	}
});

test("a deletion candidate reviews everything and deletes nothing", () => {
	const dir = mkTarget("candidate");
	deletionFixture(dir);
	assert.equal(registerHolder(dir, holderInput(), { now: NOW }).ok, true);
	// Nothing eligible yet: preparing refuses instead of reviewing nothing.
	const premature = prepareDeletionCandidate(dir, { id: "deletion/1" }, { now: NOW });
	assert.equal(premature.ok, false);
	assert.match(premature.errors[0], /no record is expired-eligible/);
	assert.equal(classify(dir, classifyInput(), { now: NOW }).ok, true);
	const expired = new Date(NOW.getTime() + HOUR_MS);
	const before = {
		classifications: fs.readFileSync(classificationsPath(dir), "utf8"),
		holders: fs.readFileSync(holdersPath(dir), "utf8"),
	};
	const prepared = prepareDeletionCandidate(dir, { id: "deletion/1" }, { now: expired });
	assert.equal(prepared.ok, true, (prepared.errors || []).join("; "));
	assert.equal(prepared.record.status, "prepared");
	assert.equal(prepared.record.records.length, 1);
	assert.equal(prepared.record.records[0].legalBasis, "ops-contract");
	assert.deepEqual(prepared.record.records[0].record, {
		type: "intent",
		identity: "intent/login",
		revision: 1,
	});
	assert.deepEqual(prepared.record.excludedHeld, []);
	assert.equal(prepared.record.holders.length, 1);
	assert.equal(prepared.record.effects.length, 1);
	assert.equal(prepared.record.effects[0].effect, "delete");
	assert.match(prepared.record.candidateHash, /^sha256:[0-9a-f]{64}$/);
	// Governance-write only: the other retention ledgers are untouched
	// (no hold ledger exists yet, and none appears).
	assert.equal(fs.readFileSync(classificationsPath(dir), "utf8"), before.classifications);
	assert.equal(fs.readFileSync(holdersPath(dir), "utf8"), before.holders);
	assert.equal(fs.existsSync(holdsPath(dir)), false);
	const duplicate = prepareDeletionCandidate(dir, { id: "deletion/1" }, { now: expired });
	assert.equal(duplicate.ok, false);
	assert.match(duplicate.errors[0], /already exists/);
	// With the only record held, nothing is eligible and preparing refuses
	// (the exclusion listing is covered by the mixed-record test).
	assert.equal(hold(dir, holdInput(), { now: NOW }).ok, true);
	const heldCandidate = prepareDeletionCandidate(dir, { id: "deletion/2" }, { now: expired });
	assert.equal(heldCandidate.ok, false);
	assert.match(heldCandidate.errors[0], /no record is expired-eligible/);
});

test("a candidate names held exclusions while eligible records remain", () => {
	const dir = mkTarget("candidate-held");
	deletionFixture(dir);
	assert.equal(registerHolder(dir, holderInput(), { now: NOW }).ok, true);
	// Two records: one held, one eligible.
	assert.equal(
		admitArtifact(dir, { type: "intent", identity: "intent/other", body: "# O\n" }).ok,
		true,
	);
	assert.equal(classify(dir, classifyInput(), { now: NOW }).ok, true);
	assert.equal(
		classify(
			dir,
			classifyInput({ record: { type: "intent", identity: "intent/other", revision: 1 } }),
			{ now: NOW },
		).ok,
		true,
	);
	assert.equal(hold(dir, holdInput(), { now: NOW }).ok, true);
	const expired = new Date(NOW.getTime() + HOUR_MS);
	const prepared = prepareDeletionCandidate(dir, { id: "deletion/1" }, { now: expired });
	assert.equal(prepared.ok, true, (prepared.errors || []).join("; "));
	assert.equal(prepared.record.records.length, 1);
	assert.equal(prepared.record.records[0].record.identity, "intent/other");
	assert.equal(prepared.record.excludedHeld.length, 1);
	assert.equal(prepared.record.excludedHeld[0].record.identity, "intent/login");
	assert.deepEqual(prepared.record.excludedHeld[0].heldBy, ["hold/litigation-42"]);
	// Zero registered Holders refuses by construction.
	const bare = mkTarget("candidate-bare");
	retentionFixture(bare);
	assert.equal(classify(bare, classifyInput(), { now: NOW }).ok, true);
	const noHolder = prepareDeletionCandidate(bare, { id: "deletion/1" }, { now: expired });
	assert.equal(noHolder.ok, false);
	assert.match(noHolder.errors[0], /no Holder is registered/);
});

test("authorization is bounded to exactly what was reviewed", () => {
	const dir = mkTarget("authorize");
	deletionFixture(dir);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(registerHolder(dir, holderInput(), { now: NOW }).ok, true);
	assert.equal(classify(dir, classifyInput(), { now: NOW }).ok, true);
	const expired = new Date(NOW.getTime() + HOUR_MS);
	const prepared = prepareDeletionCandidate(dir, { id: "deletion/1" }, { now: expired });
	assert.equal(prepared.ok, true);
	const binding = `retention-deletion:${prepared.record.candidateHash}`;
	assert.equal(
		grantApproval(
			dir,
			{
				id: "approval/deletion-1",
				approver: "bob@example.com",
				scope: null,
				subject: binding,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: expired },
		).ok,
		true,
	);
	assert.equal(
		grantApproval(
			dir,
			{
				id: "approval/other",
				approver: "bob@example.com",
				scope: null,
				subject: "retention-deletion:sha256:" + "0".repeat(64),
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: expired },
		).ok,
		true,
	);
	const authorizeInput = (overrides = {}) => ({
		id: "deletion/1",
		approval: "approval/deletion-1",
		decisionIdentity: "decision/deletion-consume-1",
		body: "# Authorize deletion\n",
		traces: [{ type: "decides", to: { type: "intent", identity: "intent/retention" } }],
		scope: null,
		...overrides,
	});
	const mismatched = authorizeDeletion(dir, authorizeInput({ approval: "approval/other" }), {
		now: expired,
	});
	assert.equal(mismatched.ok, false);
	assert.match(mismatched.errors[0], /not this candidate's binding/);
	const ghost = authorizeDeletion(dir, authorizeInput({ id: "deletion/ghost" }), {
		now: expired,
	});
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_RETENTION_NOT_FOUND");
	const authorized = authorizeDeletion(dir, authorizeInput(), { now: expired });
	assert.equal(authorized.ok, true, (authorized.errors || []).join("; "));
	assert.equal(authorized.record.status, "authorized");
	assert.equal(authorized.record.authorization.approvalId, "approval/deletion-1");
	assert.equal(authorized.consumption.receipt.revision >= 1, true);
	assert.equal(showDeletionCandidate(dir, "deletion/1").status, "authorized");
	assert.equal(listDeletionCandidates(dir, { status: "authorized" }).length, 1);
	const again = authorizeDeletion(dir, authorizeInput(), { now: expired });
	assert.equal(again.ok, false);
	assert.match(again.errors[0], /already authorized; an authorization is single-use/);
});

test("drift between review and authorization refuses", () => {
	const dir = mkTarget("drift");
	deletionFixture(dir);
	assert.equal(registerPrincipal(dir, { id: "bob@example.com", principalKind: "human" }).ok, true);
	assert.equal(registerHolder(dir, holderInput(), { now: NOW }).ok, true);
	assert.equal(classify(dir, classifyInput(), { now: NOW }).ok, true);
	const expired = new Date(NOW.getTime() + HOUR_MS);
	const prepared = prepareDeletionCandidate(dir, { id: "deletion/1" }, { now: expired });
	assert.equal(prepared.ok, true);
	assert.equal(
		grantApproval(
			dir,
			{
				id: "approval/deletion-1",
				approver: "bob@example.com",
				scope: null,
				subject: `retention-deletion:${prepared.record.candidateHash}`,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: expired },
		).ok,
		true,
	);
	// A new Holder registered after review changes the coverage.
	assert.equal(
		registerHolder(
			dir,
			holderInput({
				id: "holder/cache",
				surface: "cache",
				decision: { identity: "decision/holder-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const drifted = authorizeDeletion(
		dir,
		{
			id: "deletion/1",
			approval: "approval/deletion-1",
			decisionIdentity: "decision/deletion-consume-1",
			body: "# Authorize deletion\n",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/retention" } }],
			scope: null,
		},
		{ now: expired },
	);
	assert.equal(drifted.ok, false);
	assert.equal(drifted.code, "AMBER_E_RETENTION_DRIFT");
	assert.match(drifted.errors[0], /no longer matches what was reviewed/);
	// A new Legal Hold covering a reviewed record drifts the candidate too.
	const second = prepareDeletionCandidate(dir, { id: "deletion/2" }, { now: expired });
	assert.equal(second.ok, true, (second.errors || []).join("; "));
	assert.equal(
		grantApproval(
			dir,
			{
				id: "approval/deletion-2",
				approver: "bob@example.com",
				scope: null,
				subject: `retention-deletion:${second.record.candidateHash}`,
				validUntil: "2036-01-01T00:00:00.000Z",
			},
			{ now: expired },
		).ok,
		true,
	);
	assert.equal(hold(dir, holdInput(), { now: NOW }).ok, true);
	const heldDrift = authorizeDeletion(
		dir,
		{
			id: "deletion/2",
			approval: "approval/deletion-2",
			decisionIdentity: "decision/deletion-consume-2",
			body: "# Authorize deletion\n",
			traces: [{ type: "decides", to: { type: "intent", identity: "intent/retention" } }],
			scope: null,
		},
		{ now: expired },
	);
	assert.equal(heldDrift.ok, false);
	assert.equal(heldDrift.code, "AMBER_E_RETENTION_DRIFT");
});

test("a tampered holder registry fails every read closed", () => {
	const dir = mkTarget("holder-tamper");
	deletionFixture(dir);
	assert.equal(registerHolder(dir, holderInput(), { now: NOW }).ok, true);
	assert.equal(
		registerHolder(
			dir,
			holderInput({
				id: "holder/cache",
				surface: "cache",
				decision: { identity: "decision/holder-2", revision: 1 },
			}),
			{ now: NOW },
		).ok,
		true,
	);
	const events = readEvents(holdersPath(dir));
	events[1].surface = "export";
	writeEvents(holdersPath(dir), events);
	assert.throws(
		() => listHolders(dir),
		(err) =>
			err.amberCode === "AMBER_E_RETENTION_HOLDER_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	assert.equal(classify(dir, classifyInput(), { now: NOW }).ok, true);
	const blocked = prepareDeletionCandidate(
		dir,
		{ id: "deletion/1" },
		{ now: new Date(NOW.getTime() + HOUR_MS) },
	);
	assert.equal(blocked.ok, false);
	assert.equal(blocked.code, "AMBER_E_RETENTION_HOLDER_CORRUPT");
});

test("a tampered candidate ledger fails every read closed", () => {
	const dir = mkTarget("candidate-tamper");
	deletionFixture(dir);
	assert.equal(registerHolder(dir, holderInput(), { now: NOW }).ok, true);
	assert.equal(classify(dir, classifyInput(), { now: NOW }).ok, true);
	const expired = new Date(NOW.getTime() + HOUR_MS);
	assert.equal(prepareDeletionCandidate(dir, { id: "deletion/1" }, { now: expired }).ok, true);
	const events = readEvents(candidatesPath(dir));
	events[0].candidateHash = `sha256:${"0".repeat(64)}`;
	writeEvents(candidatesPath(dir), events);
	assert.throws(
		() => listDeletionCandidates(dir),
		(err) =>
			err.amberCode === "AMBER_E_RETENTION_CANDIDATE_CORRUPT" &&
			/does not match its content/.test(err.message),
	);
	const blocked = prepareDeletionCandidate(dir, { id: "deletion/2" }, { now: expired });
	assert.equal(blocked.ok, false);
	assert.equal(blocked.code, "AMBER_E_RETENTION_CANDIDATE_CORRUPT");
});
