"use strict";

// F050 ticket 2 (#227) — Evidence receipts & Assurance levels (unit seam).
//
// Tests assert externally visible behavior of the evidence core: the fixed
// four-level Assurance contract (verified is never recordable; only an
// independent registered principal's verification event promotes effective
// assurance), the registry-verified producer binding, replayOf provenance,
// the append-only recorded/verified event ledger with its hash chain and
// write lock, the size ceiling with env override, and fail-closed
// corruption/unsupported-version handling — every failure mode carries a
// stable AMBER_E_* code.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	EVIDENCE_SCHEMA_VERSION,
	SUPPORTED_EVIDENCE_SCHEMA_VERSIONS,
	ASSURANCE_LEVELS,
	RECORDABLE_ASSURANCE,
	EVIDENCE_STATUSES,
	DEFAULT_MAX_EVIDENCE_BYTES,
	GENESIS_HASH,
	chainHash,
	recordEvidence,
	verifyEvidence,
	showEvidence,
	listEvidence,
} = require("../../scripts/lib/core/evidence-receipts");
const { registerPrincipal, revokePrincipal } = require("../../scripts/lib/core/principal-registry");
const { writeJSONL } = require("../../scripts/lib/core/jsonl");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-evidence-${label}-`));
}

function ledgerPathOf(dir) {
	return path.join(dir, ".amber", "evidence", "receipts.jsonl");
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
 * A writer-shaped stored receipt for hand-built ledger fixtures: the record
 * writer always emits the FULL closed field set, so a stored receipt missing
 * a field is corruption in its own right — fixtures for other verdicts must
 * match the writer's shape or they trip the stored-shape check before the
 * verdict under test fires.
 */
function storedReceipt(overrides = {}) {
	return {
		id: "evidence/fixture-1",
		producer: {
			id: "ci-runner",
			principalKind: "service",
			role: null,
			membership: null,
			capability: null,
			scope: null,
			validFrom: null,
			validTo: null,
			issuer: null,
		},
		assurance: "observed",
		scope: null,
		subject: "spec/login@2",
		inputs: [],
		tools: [],
		environment: {},
		outputs: [],
		status: "pass",
		replayOf: null,
		recordedAt: "2026-08-01T00:00:00.000Z",
		...overrides,
	};
}

function recordedEvent(receipt, at = "2026-08-01T00:00:00.000Z") {
	return { kind: "recorded", schemaVersion: EVIDENCE_SCHEMA_VERSION, at, receipt };
}

function verifiedEvent(evidenceId, verifierId = "reviewer-alice", at = "2026-08-02T00:00:00.000Z") {
	return {
		kind: "verified",
		schemaVersion: EVIDENCE_SCHEMA_VERSION,
		at,
		evidenceId,
		verifier: {
			id: verifierId,
			principalKind: "human",
			role: null,
			membership: null,
			capability: null,
			scope: null,
			validFrom: null,
			validTo: null,
			issuer: null,
		},
	};
}

function seedPrincipals(dir) {
	const producer = registerPrincipal(dir, {
		id: "ci-runner",
		principalKind: "service",
		capability: "execute",
	});
	const reviewer = registerPrincipal(dir, {
		id: "reviewer-alice",
		principalKind: "human",
		role: "reviewer",
	});
	assert.equal(producer.ok, true, (producer.errors || []).join("; "));
	assert.equal(reviewer.ok, true, (reviewer.errors || []).join("; "));
}

function recordFixture(dir, id = "evidence/run-1", overrides = {}) {
	return recordEvidence(dir, {
		id,
		producer: "ci-runner",
		assurance: "observed",
		scope: "F050",
		subject: "spec/login@2",
		inputs: ["npm test"],
		tools: ["node"],
		environment: { os: "linux" },
		outputs: ["all green"],
		status: "pass",
		...overrides,
	});
}

// ── Contract constants ──

test("evidence constants pin the assurance vocabulary and the schema contract", () => {
	assert.deepEqual(ASSURANCE_LEVELS, ["unavailable", "observed", "replayable", "verified"]);
	assert.deepEqual(RECORDABLE_ASSURANCE, ["unavailable", "observed", "replayable"]);
	assert.equal(RECORDABLE_ASSURANCE.includes("verified"), false, "verified is not recordable");
	assert.deepEqual(EVIDENCE_STATUSES, ["pass", "fail"]);
	assert.equal(EVIDENCE_SCHEMA_VERSION, 1);
	assert.deepEqual(SUPPORTED_EVIDENCE_SCHEMA_VERSIONS, [1]);
	assert.equal(DEFAULT_MAX_EVIDENCE_BYTES, 1024 * 1024);
});

// ── record ──

test("record appends one immutable event and returns the derived receipt", () => {
	const dir = mkTarget("record");
	seedPrincipals(dir);
	const result = recordFixture(dir, "evidence/run-1", {
		assurance: "replayable",
		replayOf: "eval.instruction-surface",
	});
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.code, null);
	assert.equal(result.receipt.id, "evidence/run-1");
	assert.equal(result.receipt.assurance, "replayable");
	assert.equal(result.receipt.recordedAssurance, "replayable");
	assert.deepEqual(result.receipt.verifiedBy, []);
	assert.equal(result.receipt.producer.id, "ci-runner");
	assert.equal(result.receipt.producer.principalKind, "service");
	assert.equal(result.receipt.producer.capability, "execute");
	assert.equal(result.receipt.status, "pass");
	assert.match(result.receipt.recordedAt, /^\d{4}-\d{2}-\d{2}T/);

	const events = fs
		.readFileSync(ledgerPathOf(dir), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.equal(events.length, 1, "one recorded event");
	assert.equal(events[0].kind, "recorded");
	assert.equal(events[0].schemaVersion, 1);
	assert.equal(events[0].receipt.id, "evidence/run-1");
	assert.deepEqual(Object.keys(events[0]).sort(), [
		"at",
		"hash",
		"kind",
		"prevHash",
		"receipt",
		"schemaVersion",
	]);
	assert.equal(events[0].prevHash, GENESIS_HASH);
	assert.equal(events[0].hash, chainHash(events[0], GENESIS_HASH));
});

test("record refuses the verified level — a Runner can never award itself proof", () => {
	const dir = mkTarget("verified-refused");
	seedPrincipals(dir);
	const result = recordFixture(dir, "evidence/run-1", { assurance: "verified" });
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_EVIDENCE_ASSURANCE_FORBIDDEN");
	assert.equal(fs.existsSync(ledgerPathOf(dir)), false, "no ledger line is written");
});

test("explicit null collection fields are normalized, never stored — a stored null would read back as corruption", () => {
	const dir = mkTarget("null-seam");
	seedPrincipals(dir);
	const result = recordEvidence(dir, {
		id: "evidence/null-seam",
		producer: "ci-runner",
		assurance: "observed",
		scope: null,
		subject: "spec/login@2",
		inputs: null,
		tools: null,
		environment: null,
		outputs: null,
		status: "pass",
	});
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.deepEqual(result.receipt.inputs, []);
	assert.deepEqual(result.receipt.tools, []);
	assert.deepEqual(result.receipt.environment, {});
	assert.deepEqual(result.receipt.outputs, []);
	const raw = JSON.parse(fs.readFileSync(ledgerPathOf(dir), "utf8").trim().split("\n")[0]);
	assert.deepEqual(raw.receipt.inputs, []);
	assert.deepEqual(raw.receipt.tools, []);
	assert.deepEqual(raw.receipt.environment, {});
	assert.deepEqual(raw.receipt.outputs, []);
	assert.deepEqual(showEvidence(dir, "evidence/null-seam").inputs, []);
});

test("record requires an assurance from the recordable set — a dropped flag must not JSON-drop the field", () => {
	const dir = mkTarget("assurance-required");
	seedPrincipals(dir);
	const missing = recordFixture(dir, "evidence/run-1", { assurance: undefined });
	assert.equal(missing.ok, false);
	assert.equal(missing.code, "AMBER_E_INVALID_ARG");
	const foreign = recordFixture(dir, "evidence/run-1", { assurance: "probabilistic" });
	assert.equal(foreign.ok, false);
	assert.equal(foreign.code, "AMBER_E_INVALID_ARG");
	assert.equal(fs.existsSync(ledgerPathOf(dir)), false);
});

test("replayable requires replayOf; replayOf is forbidden on other levels", () => {
	const dir = mkTarget("replay-of");
	seedPrincipals(dir);
	const bare = recordFixture(dir, "evidence/run-1", { assurance: "replayable" });
	assert.equal(bare.ok, false);
	assert.equal(bare.code, "AMBER_E_EVIDENCE_REPLAY_OF_CONFLICT");
	const carried = recordFixture(dir, "evidence/run-1", { replayOf: "eval.x" });
	assert.equal(carried.ok, false);
	assert.equal(carried.code, "AMBER_E_EVIDENCE_REPLAY_OF_CONFLICT");
	const replayable = recordFixture(dir, "evidence/run-1", {
		assurance: "replayable",
		replayOf: "eval.instruction-surface",
	});
	assert.equal(replayable.ok, true, (replayable.errors || []).join("; "));
});

test("record binds a registry-verified producer; unregistered and revoked producers fail closed", () => {
	const dir = mkTarget("producer-binding");
	seedPrincipals(dir);
	const ghost = recordEvidence(dir, {
		id: "evidence/run-1",
		producer: "ghost-bot",
		assurance: "observed",
		subject: "spec/login@2",
		status: "pass",
	});
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_PRINCIPAL_NOT_FOUND");
	const revoked = revokePrincipal(dir, { id: "ci-runner", reason: "rotated" });
	assert.equal(revoked.ok, true);
	const dead = recordFixture(dir, "evidence/run-1");
	assert.equal(dead.ok, false);
	assert.equal(dead.code, "AMBER_E_PRINCIPAL_REVOKED");
	assert.equal(fs.existsSync(ledgerPathOf(dir)), false);
});

test("record refuses a duplicate evidence id both pre-lock and under the lock", () => {
	const dir = mkTarget("duplicate");
	seedPrincipals(dir);
	const first = recordFixture(dir, "evidence/run-1");
	assert.equal(first.ok, true, (first.errors || []).join("; "));
	const second = recordFixture(dir, "evidence/run-1", { status: "fail" });
	assert.equal(second.ok, false);
	assert.equal(second.code, "AMBER_E_EVIDENCE_ALREADY_RECORDED");
	const events = fs.readFileSync(ledgerPathOf(dir), "utf8").trim().split("\n");
	assert.equal(events.length, 1, "the duplicate wrote nothing");
});

test("record keeps first-recorded order across receipts and both statuses round-trip", () => {
	const dir = mkTarget("ordering");
	seedPrincipals(dir);
	assert.equal(recordFixture(dir, "evidence/run-1").ok, true);
	assert.equal(recordFixture(dir, "evidence/run-2", { status: "fail" }).ok, true);
	const list = listEvidence(dir);
	assert.deepEqual(
		list.map((record) => [record.id, record.status]),
		[
			["evidence/run-1", "pass"],
			["evidence/run-2", "fail"],
		],
	);
});

// ── verify ──

test("verify promotes effective assurance without rewriting the receipt", () => {
	const dir = mkTarget("verify");
	seedPrincipals(dir);
	assert.equal(recordFixture(dir).ok, true);
	const result = verifyEvidence(dir, { id: "evidence/run-1", verifier: "reviewer-alice" });
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.receipt.assurance, "verified");
	assert.equal(result.receipt.recordedAssurance, "observed", "the stored claim is untouched");
	assert.equal(result.receipt.verifiedBy.length, 1);
	assert.equal(result.receipt.verifiedBy[0].verifier.id, "reviewer-alice");
	assert.equal(result.receipt.verifiedBy[0].verifier.principalKind, "human");
	assert.match(result.receipt.verifiedBy[0].verifiedAt, /^\d{4}-\d{2}-\d{2}T/);

	const events = fs
		.readFileSync(ledgerPathOf(dir), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.equal(events.length, 2, "recorded + verified");
	assert.equal(events[1].kind, "verified");
	assert.equal(events[1].evidenceId, "evidence/run-1");
	assert.deepEqual(Object.keys(events[1]).sort(), [
		"at",
		"evidenceId",
		"hash",
		"kind",
		"prevHash",
		"schemaVersion",
		"verifier",
	]);
});

test("verify refuses self-verification — the producer cannot award itself proof", () => {
	const dir = mkTarget("self-verify");
	seedPrincipals(dir);
	assert.equal(recordFixture(dir).ok, true);
	const result = verifyEvidence(dir, { id: "evidence/run-1", verifier: "ci-runner" });
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_EVIDENCE_SELF_VERIFICATION");
	const events = fs.readFileSync(ledgerPathOf(dir), "utf8").trim().split("\n");
	assert.equal(events.length, 1, "the refused verification wrote nothing");
	assert.equal(showEvidence(dir, "evidence/run-1").assurance, "observed");
});

test("verify requires a recorded evidence id and a registered verifier", () => {
	const dir = mkTarget("verify-missing");
	seedPrincipals(dir);
	const unrecorded = verifyEvidence(dir, { id: "evidence/nope", verifier: "reviewer-alice" });
	assert.equal(unrecorded.ok, false);
	assert.equal(unrecorded.code, "AMBER_E_EVIDENCE_NOT_FOUND");
	assert.equal(recordFixture(dir).ok, true);
	const ghost = verifyEvidence(dir, { id: "evidence/run-1", verifier: "ghost" });
	assert.equal(ghost.ok, false);
	assert.equal(ghost.code, "AMBER_E_PRINCIPAL_NOT_FOUND");
});

test("verify is idempotent per verifier — a second verification by the same principal is refused", () => {
	const dir = mkTarget("verify-dupe");
	seedPrincipals(dir);
	assert.equal(recordFixture(dir).ok, true);
	assert.equal(verifyEvidence(dir, { id: "evidence/run-1", verifier: "reviewer-alice" }).ok, true);
	const again = verifyEvidence(dir, { id: "evidence/run-1", verifier: "reviewer-alice" });
	assert.equal(again.ok, false);
	assert.equal(again.code, "AMBER_E_EVIDENCE_ALREADY_VERIFIED");
	assert.match(again.errors.join("; "), /already verified/);
	const lines = fs.readFileSync(ledgerPathOf(dir), "utf8").trim().split("\n");
	assert.equal(lines.length, 2, "the refused verification wrote nothing");
	assert.equal(showEvidence(dir, "evidence/run-1").verifiedBy.length, 1);
	// A DIFFERENT independent principal can still add its own verification.
	const second = registerPrincipal(dir, {
		id: "reviewer-bob",
		principalKind: "human",
		role: "reviewer",
	});
	assert.equal(second.ok, true, (second.errors || []).join("; "));
	const bob = verifyEvidence(dir, { id: "evidence/run-1", verifier: "reviewer-bob" });
	assert.equal(bob.ok, true, (bob.errors || []).join("; "));
	assert.equal(showEvidence(dir, "evidence/run-1").verifiedBy.length, 2);
});

test("show returns null for an unrecorded id; the derived record is never stored", () => {
	const dir = mkTarget("show-null");
	seedPrincipals(dir);
	assert.equal(showEvidence(dir, "evidence/nope"), null);
	assert.equal(recordFixture(dir).ok, true);
	const shown = showEvidence(dir, "evidence/run-1");
	assert.equal(shown.assurance, "observed");
	const raw = JSON.parse(fs.readFileSync(ledgerPathOf(dir), "utf8").trim().split("\n")[0]);
	assert.equal("verifiedBy" in raw.receipt, false, "derived state lives only at the read seam");
	assert.equal("recordedAssurance" in raw.receipt, false);
});

// ── Fold: tamper evidence and closed field sets ──

function foldThrows(dir, code, needle) {
	try {
		listEvidence(dir);
	} catch (err) {
		assert.equal(err.amberCode, code, `expected ${code}, got ${err.amberCode}: ${err.message}`);
		if (needle) assert.ok(err.message.includes(needle), err.message);
		return;
	}
	assert.fail(`expected a typed ${code} throw`);
}

function writeLedger(dir, events) {
	fs.mkdirSync(path.dirname(ledgerPathOf(dir)), { recursive: true });
	writeJSONL(ledgerPathOf(dir), events);
}

test("an in-place edit of a recorded receipt fails closed as corruption", () => {
	const dir = mkTarget("tamper");
	seedPrincipals(dir);
	assert.equal(recordFixture(dir).ok, true);
	const events = fs
		.readFileSync(ledgerPathOf(dir), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	events[0].receipt.status = "fail";
	writeLedger(dir, events);
	foldThrows(dir, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "hash that does not match its content");
});

test("a tampered nested environment entry — even one named hash — fails closed as corruption", () => {
	const dir = mkTarget("tamper-nested");
	seedPrincipals(dir);
	assert.equal(
		recordFixture(dir, "evidence/run-1", {
			environment: { os: "linux", hash: "sha256:deadbeef" },
		}).ok,
		true,
	);
	// The writer->fold round trip preserves a nested key literally named
	// "hash": the canonical event hash excludes only the event's OWN
	// top-level hash field, never nested content.
	assert.deepEqual(showEvidence(dir, "evidence/run-1").environment, {
		os: "linux",
		hash: "sha256:deadbeef",
	});
	const events = fs
		.readFileSync(ledgerPathOf(dir), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	events[0].receipt.environment.hash = "sha256:attacker";
	writeLedger(dir, events);
	foldThrows(dir, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "hash that does not match its content");
});

test("stored receipts with malformed bounded content fail closed on the fold", () => {
	const cases = [
		[
			"environment value of the wrong type",
			storedReceipt({ environment: { os: 7 } }),
			"environment is not an object of at most",
		],
		[
			"an oversized output entry",
			storedReceipt({ outputs: ["x".repeat(2001)] }),
			"outputs is not an array of at most",
		],
		[
			"an oversized inputs entry",
			storedReceipt({ inputs: ["x".repeat(2001)] }),
			"inputs is not an array of at most",
		],
		[
			"an empty scope string",
			storedReceipt({ scope: "" }),
			"scope is neither null nor a non-empty string",
		],
		[
			"a missing recordedAt",
			{ ...storedReceipt(), recordedAt: undefined },
			"no recordedAt timestamp",
		],
	];
	for (const [label, receipt, needle] of cases) {
		const dir = mkTarget("stored-bounds");
		writeLedger(dir, withChain([recordedEvent(receipt)]));
		try {
			listEvidence(dir);
			assert.fail(`case "${label}" must fail closed`);
		} catch (err) {
			assert.equal(
				err.amberCode,
				"AMBER_E_EVIDENCE_REGISTRY_CORRUPT",
				`case "${label}": ${err.message}`,
			);
			assert.ok(err.message.includes(needle), `case "${label}": ${err.message}`);
		}
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("a spliced middle event breaks the chain and fails closed", () => {
	const dir = mkTarget("splice");
	seedPrincipals(dir);
	assert.equal(recordFixture(dir, "evidence/run-1").ok, true);
	assert.equal(recordFixture(dir, "evidence/run-2").ok, true);
	const events = fs
		.readFileSync(ledgerPathOf(dir), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const spliced = [events[0], events[0], events[1]];
	writeLedger(dir, spliced);
	// The spliced copy's prevHash no longer matches the running chain head, so
	// the chain break fires before the duplicate-id verdict (which the
	// dupe-fold test covers on its own).
	foldThrows(dir, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "breaks the hash chain");
});

test("a duplicate recorded id in the ledger is corruption, not a re-record", () => {
	const dir = mkTarget("dupe-fold");
	writeLedger(dir, withChain([recordedEvent(storedReceipt()), recordedEvent(storedReceipt())]));
	foldThrows(dir, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "a second time");
});

test("a verification of an unrecorded id is corruption", () => {
	const dir = mkTarget("verify-unrecorded-fold");
	writeLedger(dir, withChain([verifiedEvent("evidence/ghost")]));
	foldThrows(dir, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "never recorded");
});

test("a self-verification inside the ledger is corruption", () => {
	const dir = mkTarget("self-verify-fold");
	const receipt = storedReceipt();
	writeLedger(
		dir,
		withChain([recordedEvent(receipt), verifiedEvent(receipt.id, receipt.producer.id)]),
	);
	foldThrows(dir, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "verifying its own evidence");
});

test("a duplicate verification by the same verifier inside the ledger is corruption", () => {
	const dir = mkTarget("dupe-verify-fold");
	const receipt = storedReceipt();
	writeLedger(
		dir,
		withChain([
			recordedEvent(receipt),
			verifiedEvent(receipt.id, "reviewer-alice"),
			verifiedEvent(receipt.id, "reviewer-alice", "2026-08-03T00:00:00.000Z"),
		]),
	);
	foldThrows(dir, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "a second time");
});

test("unknown event fields, kinds, and schema versions fail closed", () => {
	const dir = mkTarget("unknown-field");
	writeLedger(dir, withChain([{ ...recordedEvent(storedReceipt()), note: "hand-added" }]));
	foldThrows(dir, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "unknown field");

	const dirKind = mkTarget("unknown-kind");
	writeLedger(dirKind, withChain([{ ...recordedEvent(storedReceipt()), kind: "deleted" }]));
	foldThrows(dirKind, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "unknown kind");

	const dirVersion = mkTarget("bad-version");
	writeLedger(dirVersion, withChain([{ ...recordedEvent(storedReceipt()), schemaVersion: 99 }]));
	foldThrows(dirVersion, "AMBER_E_EVIDENCE_UNSUPPORTED_VERSION", "schemaVersion 99");
});

test("a stored receipt with a recordable-set violation is corruption", () => {
	const dir = mkTarget("stored-verified");
	writeLedger(dir, withChain([recordedEvent(storedReceipt({ assurance: "verified" }))]));
	foldThrows(dir, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "outside the recordable set");
});

test("a stored receipt with a malformed producer snapshot is corruption", () => {
	const dir = mkTarget("stored-snapshot");
	const receipt = storedReceipt();
	delete receipt.producer.scope;
	writeLedger(dir, withChain([recordedEvent(receipt)]));
	foldThrows(dir, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "frozen registry record fields");
});

test("a bare replayable receipt inside the ledger is corruption", () => {
	const dir = mkTarget("stored-bare-replayable");
	writeLedger(dir, withChain([recordedEvent(storedReceipt({ assurance: "replayable" }))]));
	foldThrows(dir, "AMBER_E_EVIDENCE_REGISTRY_CORRUPT", "no replayOf");
});

test("an empty ledger reads as empty; every record round-trips through the fold", () => {
	const dir = mkTarget("empty");
	seedPrincipals(dir);
	assert.deepEqual(listEvidence(dir), []);
	assert.equal(
		recordFixture(dir, "evidence/run-1", {
			assurance: "replayable",
			replayOf: "eval.instruction-surface",
		}).ok,
		true,
	);
	assert.equal(verifyEvidence(dir, { id: "evidence/run-1", verifier: "reviewer-alice" }).ok, true);
	const list = listEvidence(dir);
	assert.equal(list.length, 1);
	assert.equal(list[0].assurance, "verified");
	assert.equal(list[0].recordedAssurance, "replayable");
});

// ── Write lock ──

function lockPathOf(dir) {
	return path.join(dir, ".amber", "evidence", "receipts.lock");
}

test("a fresh evidence lock refuses a racing write; a stale lock is reclaimed", () => {
	const dir = mkTarget("lock");
	seedPrincipals(dir);
	fs.mkdirSync(path.dirname(lockPathOf(dir)), { recursive: true });
	fs.writeFileSync(lockPathOf(dir), "held", "utf8");
	const blocked = recordFixture(dir);
	assert.equal(blocked.ok, false);
	assert.equal(blocked.code, "AMBER_E_EVIDENCE_REGISTRY_LOCK");

	const stale = new Date(Date.now() - 60_000);
	fs.utimesSync(lockPathOf(dir), stale, stale);
	const reclaimed = recordFixture(dir);
	assert.equal(reclaimed.ok, true, (reclaimed.errors || []).join("; "));
	assert.equal(fs.existsSync(lockPathOf(dir)), false, "the writer released its lock");
});

// ── Size ceiling ──

test("the size ceiling refuses an append before any durable state is touched", () => {
	const dir = mkTarget("ceiling");
	seedPrincipals(dir);
	assert.equal(recordFixture(dir, "evidence/run-1").ok, true);
	process.env.AMBER_EVIDENCE_MAX_REGISTRY_BYTES = String(fs.statSync(ledgerPathOf(dir)).size + 8);
	try {
		const blocked = recordFixture(dir, "evidence/run-2");
		assert.equal(blocked.ok, false);
		assert.equal(blocked.code, "AMBER_E_EVIDENCE_SIZE_CEILING");
		assert.equal(listEvidence(dir).length, 1, "the refused append left the ledger untouched");
	} finally {
		delete process.env.AMBER_EVIDENCE_MAX_REGISTRY_BYTES;
	}
});

test("a garbage ceiling override fails closed instead of silently defaulting", () => {
	const dir = mkTarget("ceiling-garbage");
	seedPrincipals(dir);
	process.env.AMBER_EVIDENCE_MAX_REGISTRY_BYTES = "not-a-number";
	try {
		const blocked = recordFixture(dir);
		assert.equal(blocked.ok, false);
		assert.equal(blocked.code, "AMBER_E_INVALID_ARG");
		assert.equal(fs.existsSync(ledgerPathOf(dir)), false);
	} finally {
		delete process.env.AMBER_EVIDENCE_MAX_REGISTRY_BYTES;
	}
});
