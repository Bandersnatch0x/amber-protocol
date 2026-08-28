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
} = require("../../scripts/lib/core/retention-registry");
const { admitArtifact } = require("../../scripts/lib/core/canonical-artifacts");

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
