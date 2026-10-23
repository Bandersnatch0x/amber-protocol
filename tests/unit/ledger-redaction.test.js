"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { mkTarget } = require("../helpers/harness");
const { redactSecrets, redactDeep, PLACEHOLDER } = require("../../scripts/lib/core/redaction");
const { appendJSONL, writeJSONL, readJSONL } = require("../../scripts/lib/core/jsonl");
const {
	GENESIS_HASH,
	chainHash,
	chainLinkProblem,
	acquireLedgerLock,
	appendLedgerEvent,
} = require("../../scripts/lib/core/registry-ledger");
const {
	GENESIS,
	hashRecord,
	adoptUnanchoredLedger,
	appendLedgerRecord,
	readLedger,
	verifyLedgerChain,
} = require("../../scripts/lib/core/loop-ledger");
const {
	ledgerPath,
	recordInvalidation,
	listInvalidations,
} = require("../../scripts/lib/core/staleness-registry");
const { appendSessionEvent, readSessionEvents } = require("../../scripts/lib/session-timeline");

const FAKE_KEY = `sk-${"fake".repeat(8)}`;
const FAKE_ASSIGNMENT = "TOKEN=fake-ledger-token";
const OUTPUT_DIGEST = `sha256:${"a".repeat(64)}`;

for (const [name, input, expected] of [
	["API key", FAKE_KEY, PLACEHOLDER],
	["AWS key", `AKIA${"A".repeat(16)}`, PLACEHOLDER],
	["GitHub token", `ghp_${"a".repeat(30)}`, PLACEHOLDER],
	["Bearer token", "Bearer fake-ledger-token", `Bearer ${PLACEHOLDER}`],
	["environment assignment", FAKE_ASSIGNMENT, `TOKEN=${PLACEHOLDER}`],
]) {
	test(`${name} redaction is idempotent and preserves nested data shapes`, () => {
		const original = {
			payload: [input, { outputDigest: OUTPUT_DIGEST }],
			count: 2,
			ok: true,
			value: null,
		};
		const snapshot = structuredClone(original);
		assert.equal(redactSecrets(input), expected);
		const redacted = redactDeep(original);
		assert.deepEqual(redacted, {
			...original,
			payload: [expected, { outputDigest: OUTPUT_DIGEST }],
		});
		assert.deepEqual(redactDeep(redacted), redacted);
		assert.deepEqual(original, snapshot);
	});
}

test("appendJSONL persists redacted values without mutating its input or digest", () => {
	const file = path.join(mkTarget("redaction-jsonl"), "nested", "events.jsonl");
	const row = {
		payload: { key: FAKE_KEY, args: [FAKE_ASSIGNMENT] },
		outputDigest: OUTPUT_DIGEST,
	};
	const snapshot = structuredClone(row);
	const result = appendJSONL(file, row);
	const expected = {
		payload: { key: PLACEHOLDER, args: [`TOKEN=${PLACEHOLDER}`] },
		outputDigest: OUTPUT_DIGEST,
	};
	assert.deepEqual(readJSONL(file), [expected]);
	assert.deepEqual(result, expected);
	assert.deepEqual(row, snapshot);
});

// writeJSONL is the fixture/rebuild path, not a production writer: it must keep
// persisting arbitrary stored state verbatim, or an adversarial fixture (a
// deliberately broken chain, a secret-shaped value) could not be constructed.
test("writeJSONL persists values verbatim so adversarial fixtures stay expressible", () => {
	const file = path.join(mkTarget("redaction-jsonl-fixture"), "nested", "events.jsonl");
	const row = { payload: { key: FAKE_KEY, args: [FAKE_ASSIGNMENT] }, outputDigest: OUTPUT_DIGEST };
	writeJSONL(file, [row]);
	assert.deepEqual(readJSONL(file), [row]);
});

test("timeline append redacts new events and leaves historical bytes untouched", () => {
	const dir = mkTarget("redaction-timeline");
	const file = path.join(dir, "timeline.jsonl");
	const legacy = `${JSON.stringify({ type: "error", data: { key: FAKE_KEY } })}\n`;
	fs.writeFileSync(file, legacy);
	appendSessionEvent(dir, { type: "error", data: { key: FAKE_KEY, args: [FAKE_ASSIGNMENT] } });
	const events = readSessionEvents(dir, { strict: true });
	assert.equal(events[0].data.key, FAKE_KEY);
	assert.deepEqual(events[1].data, { key: PLACEHOLDER, args: [`TOKEN=${PLACEHOLDER}`] });
	assert.ok(events[1].timestamp);
	assert.ok(fs.readFileSync(file, "utf8").startsWith(legacy));
});

test("registry append hashes redacted object and factory bodies while preserving historical verification", () => {
	const dir = mkTarget("redaction-registry");
	const file = path.join(dir, "registry.jsonl");
	const legacyBody = { kind: "legacy", payload: FAKE_KEY };
	const legacy = `${JSON.stringify({ ...legacyBody, prevHash: GENESIS_HASH, hash: chainHash(legacyBody, GENESIS_HASH) })}\n`;
	fs.writeFileSync(file, legacy);
	const fold = () => {
		const events = readJSONL(file, { onCorrupt: "throw" });
		let prevHash = GENESIS_HASH;
		for (const [index, event] of events.entries()) {
			assert.equal(chainLinkProblem(event, prevHash, index + 1, "test registry"), null);
			prevHash = event.hash;
		}
		return events;
	};
	const options = {
		path: () => file,
		fold,
		acquire: () =>
			acquireLedgerLock({
				dirPath: dir,
				lockName: "registry.lock",
				conflictCode: "AMBER_E_TEST_LOCK",
				corruptCode: "AMBER_E_TEST_CORRUPT",
				label: "test registry",
			}),
		envName: "AMBER_TEST_REDACTION_MAX_BYTES",
		defaultBytes: 1024 * 1024,
		label: "test registry",
		corruptCode: "AMBER_E_TEST_CORRUPT",
		sizeCeilingCode: "AMBER_E_TEST_SIZE",
	};
	for (const body of [
		{ kind: "created", payload: { key: FAKE_KEY }, outputDigest: OUTPUT_DIGEST },
		() => ({ kind: "updated", payload: { key: FAKE_ASSIGNMENT }, outputDigest: OUTPUT_DIGEST }),
	]) {
		const result = appendLedgerEvent(
			dir,
			options,
			body,
			() => null,
			(events) => events.at(-1),
		);
		assert.equal(result.ok, true, result.errors.join("; "));
		assert.equal(result.record.outputDigest, OUTPUT_DIGEST);
	}
	const events = fold();
	assert.equal(events.length, 3);
	assert.equal(events[0].payload, FAKE_KEY);
	assert.equal(events[1].payload.key, PLACEHOLDER);
	assert.equal(events[2].payload.key, `TOKEN=${PLACEHOLDER}`);
	assert.ok(fs.readFileSync(file, "utf8").startsWith(legacy));
});

test("loop append persists redacted bodies and keeps mixed historical chains intact", () => {
	const file = path.join(mkTarget("redaction-loop"), "ledger.jsonl");
	const legacyBody = { kind: "legacy", payload: FAKE_KEY, prevHash: GENESIS };
	const legacy = `${JSON.stringify({ ...legacyBody, hash: hashRecord(legacyBody, GENESIS) })}\n`;
	fs.writeFileSync(file, legacy);
	adoptUnanchoredLedger(file);
	for (const [payload, expected] of [
		[FAKE_KEY, PLACEHOLDER],
		[FAKE_ASSIGNMENT, `TOKEN=${PLACEHOLDER}`],
	]) {
		const record = appendLedgerRecord(file, {
			kind: "executed",
			payload,
			outputDigest: OUTPUT_DIGEST,
		});
		assert.equal(record.payload, expected);
		assert.equal(record.outputDigest, OUTPUT_DIGEST);
	}
	assert.deepEqual(
		readLedger(file).map((record) => record.payload),
		[FAKE_KEY, PLACEHOLDER, `TOKEN=${PLACEHOLDER}`],
	);
	assert.deepEqual(verifyLedgerChain(file), { intact: true, brokenAt: null, records: 3 });
	assert.ok(fs.readFileSync(file, "utf8").startsWith(legacy));
	fs.writeFileSync(
		file,
		fs.readFileSync(file, "utf8").replace(FAKE_KEY, `sk-${"other".repeat(8)}`),
	);
	assert.equal(verifyLedgerChain(file).intact, false);
});

test("staleness append hashes redacted reasons and preserves historical receipt bytes", () => {
	const dir = mkTarget("redaction-staleness");
	const file = ledgerPath(dir);
	const body = {
		kind: "invalidated",
		schemaVersion: 1,
		at: "2026-10-24T00:00:00.000Z",
		subject: "intent/redaction@1",
		dependency: { type: "policy", identity: "policy/test", revision: null, contentHash: null },
		reason: FAKE_KEY,
	};
	const legacy = `${JSON.stringify({ ...body, prevHash: GENESIS_HASH, hash: chainHash(body, GENESIS_HASH) })}\n`;
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, legacy);
	const result = recordInvalidation(dir, { ...body, reason: FAKE_ASSIGNMENT });
	assert.equal(result.ok, true, result.errors.join("; "));
	assert.equal(result.receipt.reason, `TOKEN=${PLACEHOLDER}`);
	assert.deepEqual(
		listInvalidations(dir).map((receipt) => receipt.reason),
		[FAKE_KEY, `TOKEN=${PLACEHOLDER}`],
	);
	assert.ok(fs.readFileSync(file, "utf8").startsWith(legacy));
});
