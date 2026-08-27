"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	ADAPTER_SCHEMA_VERSION,
	ADAPTER_READ_RECEIPT_SCHEMA_VERSION,
	GENESIS_HASH,
	chainHash,
	registerAdapter,
	showAdapter,
	listAdapters,
	readAdapterRecord,
	listReadReceipts,
	registryPath,
	receiptPath,
} = require("../../scripts/lib/core/adapter-registry");
const { writeJSONL } = require("../../scripts/lib/core/jsonl");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-adapter-${label}-`));
}

function adapter(overrides = {}) {
	return {
		id: "adapter/legacy",
		owner: "legacy-team",
		adapterVersion: "1",
		recordTypes: [{ type: "legacy-ticket", versions: ["v1"] }],
		scope: "F051",
		identityMapping: { strategy: "path" },
		freshness: { maxAgeMs: 86_400_000 },
		permissions: { readOnly: true, allowedPaths: ["legacy"] },
		...overrides,
	};
}

function registerFixture(dir, overrides = {}) {
	const result = registerAdapter(dir, adapter(overrides), {
		now: new Date("2026-08-27T00:00:00.000Z"),
	});
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	return result.adapter;
}

test("adapter registration records the closed read-only contract and show/list it", () => {
	const dir = mkTarget("register");
	const registered = registerFixture(dir);
	assert.equal(registered.id, "adapter/legacy");
	assert.equal(registered.owner, "legacy-team");
	assert.equal(registered.permissions.readOnly, true);
	assert.equal(registered.registeredAt, "2026-08-27T00:00:00.000Z");

	assert.equal(showAdapter(dir, "adapter/legacy").scope, "F051");
	assert.deepEqual(
		listAdapters(dir).map((entry) => entry.id),
		["adapter/legacy"],
	);

	const duplicate = registerAdapter(dir, adapter());
	assert.equal(duplicate.ok, false);
	assert.equal(duplicate.code, "AMBER_E_ADAPTER_INVALID");
});

test("invalid adapter contracts fail closed before writing", () => {
	const dir = mkTarget("invalid");
	const result = registerAdapter(
		dir,
		adapter({ permissions: { readOnly: false, allowedPaths: ["legacy"] } }),
	);
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_ADAPTER_INVALID");
	assert.equal(fs.existsSync(registryPath(dir)), false);
});

test("readAdapterRecord reads legacy bytes, appends a receipt, and does not create artifacts", () => {
	const dir = mkTarget("read");
	fs.mkdirSync(path.join(dir, "legacy"), { recursive: true });
	fs.writeFileSync(path.join(dir, "legacy", "item.json"), '{"id":"legacy-1"}\n');
	registerFixture(dir);

	const result = readAdapterRecord(
		dir,
		{ id: "adapter/legacy", source: "legacy/item.json", recordId: "legacy-1" },
		{ now: new Date("2026-08-28T00:00:00.000Z") },
	);
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.source.bytes, '{"id":"legacy-1"}\n');
	assert.equal(result.receipt.kind, "read");
	assert.equal(result.receipt.schemaVersion, ADAPTER_READ_RECEIPT_SCHEMA_VERSION);
	assert.equal(result.receipt.adapterId, "adapter/legacy");
	assert.equal(result.receipt.recordType, "legacy-ticket");
	assert.equal(result.receipt.scope, "F051");
	assert.match(result.receipt.sourceHash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(fs.existsSync(path.join(dir, ".amber", "artifacts")), false);
	assert.equal(listReadReceipts(dir).length, 1);
});

test("read boundaries refuse undeclared source, scope, type, missing adapter, and missing source", () => {
	const dir = mkTarget("boundaries");
	fs.mkdirSync(path.join(dir, "legacy"), { recursive: true });
	fs.mkdirSync(path.join(dir, "other"), { recursive: true });
	fs.writeFileSync(path.join(dir, "legacy", "item.json"), "ok");
	fs.writeFileSync(path.join(dir, "other", "item.json"), "nope");
	registerFixture(dir);

	assert.equal(
		readAdapterRecord(dir, { id: "adapter/nope", source: "legacy/item.json", recordId: "x" }).code,
		"AMBER_E_ADAPTER_NOT_FOUND",
	);
	assert.equal(
		readAdapterRecord(dir, { id: "adapter/legacy", source: "other/item.json", recordId: "x" }).code,
		"AMBER_E_ADAPTER_READ_FORBIDDEN",
	);
	assert.equal(
		readAdapterRecord(dir, {
			id: "adapter/legacy",
			source: "legacy/item.json",
			recordId: "x",
			scope: "other",
		}).code,
		"AMBER_E_ADAPTER_READ_FORBIDDEN",
	);
	assert.equal(
		readAdapterRecord(dir, {
			id: "adapter/legacy",
			source: "legacy/item.json",
			recordId: "x",
			recordType: "other",
		}).code,
		"AMBER_E_ADAPTER_READ_FORBIDDEN",
	);
	assert.equal(
		readAdapterRecord(dir, { id: "adapter/legacy", source: "legacy/missing.json", recordId: "x" })
			.code,
		"AMBER_E_ADAPTER_SOURCE_MISSING",
	);
	assert.equal(fs.existsSync(receiptPath(dir)), false);
});

test("tampered adapter registry and read receipts fail closed", () => {
	const dir = mkTarget("tamper");
	registerFixture(dir);
	const event = JSON.parse(fs.readFileSync(registryPath(dir), "utf8"));
	event.adapter.owner = "edited";
	writeJSONL(registryPath(dir), [event]);
	assert.throws(
		() => listAdapters(dir),
		(err) => err.amberCode === "AMBER_E_ADAPTER_REGISTRY_CORRUPT",
	);

	const dir2 = mkTarget("receipt-tamper");
	fs.mkdirSync(path.join(dir2, "legacy"), { recursive: true });
	fs.writeFileSync(path.join(dir2, "legacy", "item.json"), "ok");
	registerFixture(dir2);
	readAdapterRecord(dir2, { id: "adapter/legacy", source: "legacy/item.json", recordId: "x" });
	const receipt = JSON.parse(fs.readFileSync(receiptPath(dir2), "utf8"));
	receipt.recordId = "edited";
	writeJSONL(receiptPath(dir2), [receipt]);
	assert.throws(
		() => listReadReceipts(dir2),
		(err) => err.amberCode === "AMBER_E_ADAPTER_READ_RECEIPT_CORRUPT",
	);
});

test("adapter registry supports multiple registrations without exposing chain internals", () => {
	const dir = mkTarget("multiple");
	registerFixture(dir, { id: "adapter/a" });
	registerFixture(dir, { id: "adapter/b" });
	assert.deepEqual(
		listAdapters(dir).map((entry) => entry.id),
		["adapter/a", "adapter/b"],
	);
	assert.equal(Object.prototype.hasOwnProperty.call(listAdapters(dir)[0], "hash"), false);
});
