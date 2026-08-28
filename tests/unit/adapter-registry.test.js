"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
	prepareMigrationCandidate,
	compareAdapterShadow,
	listShadowComparisons,
	listReadReceipts,
	registryPath,
	receiptPath,
	comparisonPath,
} = require("../../scripts/lib/core/adapter-registry");
const { admitArtifact, showArtifact } = require("../../scripts/lib/core/canonical-artifacts");
const { writeJSONL } = require("../../scripts/lib/core/jsonl");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-adapter-${label}-`));
}

function sha256Bytes(buffer) {
	return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
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
	assert.equal(result.source.bytesBase64, Buffer.from('{"id":"legacy-1"}\n').toString("base64"));
	assert.equal(result.receipt.kind, "read");
	assert.equal(result.receipt.schemaVersion, ADAPTER_READ_RECEIPT_SCHEMA_VERSION);
	assert.equal(result.receipt.adapterId, "adapter/legacy");
	assert.equal(result.receipt.recordType, "legacy-ticket");
	assert.equal(result.receipt.recordVersion, "v1");
	assert.equal(result.receipt.status, "fresh");
	assert.equal(result.receipt.expectedSourceHash, null);
	assert.equal(result.receipt.stateReason, null);
	assert.equal(result.receipt.scope, "F051");
	assert.equal(result.receipt.sourceHash, sha256Bytes(Buffer.from('{"id":"legacy-1"}\n')));
	assert.equal(result.receipt.sourceBytes, Buffer.from('{"id":"legacy-1"}\n').toString("base64"));
	assert.equal(result.receipt.sourceByteLength, Buffer.byteLength('{"id":"legacy-1"}\n'));
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
		readAdapterRecord(dir, {
			id: "adapter/legacy",
			source: "legacy/../other/item.json",
			recordId: "x",
		}).code,
		"AMBER_E_ADAPTER_READ_FORBIDDEN",
	);
	assert.equal(
		readAdapterRecord(dir, {
			id: "adapter/legacy",
			source: "legacy/item.json",
			recordId: "x",
			scope: "",
		}).code,
		"AMBER_E_INVALID_ARG",
	);
	assert.equal(
		readAdapterRecord(dir, {
			id: "adapter/legacy",
			source: "legacy/item.json",
			recordId: "x",
			recordType: "",
		}).code,
		"AMBER_E_INVALID_ARG",
	);
	assert.equal(
		readAdapterRecord(dir, {
			id: "adapter/legacy",
			source: "legacy/item.json",
			recordId: "x",
			recordVersion: "",
		}).code,
		"AMBER_E_INVALID_ARG",
	);
	const missingSource = readAdapterRecord(dir, {
		id: "adapter/legacy",
		source: "legacy/missing.json",
		recordId: "x",
	});
	assert.equal(missingSource.code, "AMBER_E_ADAPTER_SOURCE_MISSING");
	assert.equal(missingSource.receipt.status, "unavailable");
	assert.equal(missingSource.receipt.sourceHash, null);
	assert.equal(missingSource.receipt.sourceBytes, null);
	assert.equal(missingSource.receipt.sourceByteLength, 0);
	assert.match(missingSource.receipt.stateReason, /source not found/);
	assert.equal(listReadReceipts(dir).length, 1);
});

test("freshness, raw bytes, and recordVersion are enforced and receipted", () => {
	const staleDir = mkTarget("stale");
	fs.mkdirSync(path.join(staleDir, "legacy"), { recursive: true });
	fs.writeFileSync(path.join(staleDir, "legacy", "old.json"), "old");
	registerFixture(staleDir, { freshness: { maxAgeMs: 1 } });
	const old = new Date("2000-01-01T00:00:00.000Z");
	fs.utimesSync(path.join(staleDir, "legacy", "old.json"), old, old);
	const stale = readAdapterRecord(
		staleDir,
		{ id: "adapter/legacy", source: "legacy/old.json", recordId: "old" },
		{ now: new Date("2026-08-27T00:00:00.000Z") },
	);
	assert.equal(stale.ok, false);
	assert.equal(stale.code, "AMBER_E_ADAPTER_STALE");
	assert.equal(stale.receipt.status, "stale");
	assert.match(stale.receipt.stateReason, /stale/);

	const conflictDir = mkTarget("hash-conflict");
	fs.mkdirSync(path.join(conflictDir, "legacy"), { recursive: true });
	const original = Buffer.from("original");
	fs.writeFileSync(path.join(conflictDir, "legacy", "item.json"), original);
	registerFixture(conflictDir);
	fs.writeFileSync(path.join(conflictDir, "legacy", "item.json"), "changed");
	const conflict = readAdapterRecord(conflictDir, {
		id: "adapter/legacy",
		source: "legacy/item.json",
		recordId: "legacy-1",
		expectedSourceHash: sha256Bytes(original),
	});
	assert.equal(conflict.ok, false);
	assert.equal(conflict.code, "AMBER_E_ADAPTER_CONFLICT");
	assert.equal(conflict.receipt.status, "conflict");
	assert.equal(conflict.receipt.expectedSourceHash, sha256Bytes(original));
	assert.equal(conflict.receipt.sourceHash, sha256Bytes(Buffer.from("changed")));
	assert.match(conflict.receipt.stateReason, /hash changed/);
	const invalidHash = readAdapterRecord(conflictDir, {
		id: "adapter/legacy",
		source: "legacy/item.json",
		recordId: "legacy-1",
		expectedSourceHash: "not-a-hash",
	});
	assert.equal(invalidHash.code, "AMBER_E_INVALID_ARG");
	assert.equal(listReadReceipts(conflictDir).length, 1);

	const binaryDir = mkTarget("binary");
	fs.mkdirSync(path.join(binaryDir, "legacy"), { recursive: true });
	const raw = Buffer.from([0xff, 0xfe, 0x00, 0x61]);
	fs.writeFileSync(path.join(binaryDir, "legacy", "bin.dat"), raw);
	registerFixture(binaryDir, {
		recordTypes: [{ type: "legacy-ticket", versions: ["v1", "v2"] }],
	});
	const read = readAdapterRecord(binaryDir, {
		id: "adapter/legacy",
		source: "legacy/bin.dat",
		recordId: "bin",
		recordVersion: "v2",
	});
	assert.equal(read.ok, true, (read.errors || []).join("; "));
	assert.equal(read.receipt.recordVersion, "v2");
	assert.equal(read.receipt.sourceHash, sha256Bytes(raw));
	assert.equal(read.receipt.sourceBytes, raw.toString("base64"));
	assert.equal(read.receipt.sourceByteLength, raw.length);
	assert.equal(
		readAdapterRecord(binaryDir, {
			id: "adapter/legacy",
			source: "legacy/bin.dat",
			recordId: "bin",
			recordVersion: "v3",
		}).code,
		"AMBER_E_ADAPTER_READ_FORBIDDEN",
	);
});

test("adapter read receipts record same-record state transitions", () => {
	const dir = mkTarget("state-transitions");
	fs.mkdirSync(path.join(dir, "legacy"), { recursive: true });
	const item = path.join(dir, "legacy", "item.json");
	const original = Buffer.from("original");
	fs.writeFileSync(item, original);
	registerFixture(dir, { freshness: { maxAgeMs: 1 } });
	const fresh = readAdapterRecord(
		dir,
		{ id: "adapter/legacy", source: "legacy/item.json", recordId: "legacy-1" },
		{ now: new Date("2026-08-27T00:00:00.000Z") },
	);
	assert.equal(fresh.ok, true, (fresh.errors || []).join("; "));
	fs.writeFileSync(item, "changed");
	const conflict = readAdapterRecord(
		dir,
		{
			id: "adapter/legacy",
			source: "legacy/item.json",
			recordId: "legacy-1",
			expectedSourceHash: sha256Bytes(original),
		},
		{ now: new Date("2026-08-27T00:00:00.000Z") },
	);
	assert.equal(conflict.code, "AMBER_E_ADAPTER_CONFLICT");
	const old = new Date("2000-01-01T00:00:00.000Z");
	fs.utimesSync(item, old, old);
	const stale = readAdapterRecord(
		dir,
		{ id: "adapter/legacy", source: "legacy/item.json", recordId: "legacy-1" },
		{ now: new Date("2026-08-27T00:00:00.000Z") },
	);
	assert.equal(stale.code, "AMBER_E_ADAPTER_STALE");
	fs.rmSync(item);
	const unavailable = readAdapterRecord(dir, {
		id: "adapter/legacy",
		source: "legacy/item.json",
		recordId: "legacy-1",
	});
	assert.equal(unavailable.code, "AMBER_E_ADAPTER_SOURCE_MISSING");
	assert.deepEqual(
		listReadReceipts(dir).map((receipt) => receipt.status),
		["fresh", "conflict", "stale", "unavailable"],
	);
});

test("migration candidates are prepared read-only and re-admitted through canonical validation", () => {
	const dir = mkTarget("candidate");
	fs.mkdirSync(path.join(dir, "legacy"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "legacy", "candidate.json"),
		`${JSON.stringify({
			id: "legacy-1",
			scope: "F051",
			artifact: {
				type: "intent",
				identity: "intent/from-legacy",
				body: "# From legacy\n",
			},
		})}\n`,
	);
	registerFixture(dir);

	const result = prepareMigrationCandidate(dir, {
		id: "adapter/legacy",
		source: "legacy/candidate.json",
		recordId: "legacy-1",
	});
	assert.equal(result.ok, true, (result.errors || []).join("; "));
	assert.equal(result.state, "fresh");
	assert.equal(result.receipt.status, "fresh");
	assert.equal(result.candidate.type, "intent");
	assert.equal(result.candidate.identity, "intent/from-legacy");
	assert.equal(result.candidate.scope, "F051");
	assert.equal(showArtifact(dir, "intent/from-legacy"), null);

	const admitted = admitArtifact(dir, result.candidate);
	assert.equal(admitted.ok, true, (admitted.errors || []).join("; "));
	assert.equal(showArtifact(dir, "intent/from-legacy").body, "# From legacy\n");

	const invalidDir = mkTarget("candidate-invalid-type");
	fs.mkdirSync(path.join(invalidDir, "legacy"), { recursive: true });
	fs.writeFileSync(
		path.join(invalidDir, "legacy", "candidate.json"),
		`${JSON.stringify({
			id: "legacy-1",
			scope: "F051",
			artifact: {
				type: "unknown-type",
				identity: "intent/not-admitted",
				body: "# Invalid\n",
			},
		})}\n`,
	);
	registerFixture(invalidDir);
	const invalid = prepareMigrationCandidate(invalidDir, {
		id: "adapter/legacy",
		source: "legacy/candidate.json",
		recordId: "legacy-1",
	});
	assert.equal(invalid.ok, true, (invalid.errors || []).join("; "));
	const rejected = admitArtifact(invalidDir, invalid.candidate);
	assert.equal(rejected.ok, false);
	assert.equal(rejected.code, "AMBER_E_ARTIFACT_UNKNOWN_TYPE");
	assert.equal(showArtifact(invalidDir, "intent/not-admitted"), null);
});

test("migration candidates record unmapped and conflict states without bypassing validation", () => {
	const unknownDir = mkTarget("candidate-unmapped");
	fs.mkdirSync(path.join(unknownDir, "legacy"), { recursive: true });
	fs.writeFileSync(path.join(unknownDir, "legacy", "bad.json"), '{"id":"legacy-1"}\n');
	registerFixture(unknownDir);
	const unknown = prepareMigrationCandidate(unknownDir, {
		id: "adapter/legacy",
		source: "legacy/bad.json",
		recordId: "legacy-1",
	});
	assert.equal(unknown.ok, false);
	assert.equal(unknown.code, "AMBER_E_ADAPTER_UNMAPPED");
	assert.equal(unknown.state, "unmapped");
	assert.equal(unknown.receipt.status, "unmapped");
	assert.equal(showArtifact(unknownDir, "intent/from-legacy"), null);

	const duplicateDir = mkTarget("candidate-duplicate");
	fs.mkdirSync(path.join(duplicateDir, "legacy"), { recursive: true });
	fs.writeFileSync(
		path.join(duplicateDir, "legacy", "items.json"),
		`${JSON.stringify({
			records: [
				{
					id: "a",
					scope: "F051",
					artifact: { type: "intent", identity: "intent/dup", body: "# A\n" },
				},
				{
					id: "b",
					scope: "F051",
					artifact: { type: "intent", identity: "intent/dup", body: "# B\n" },
				},
			],
		})}\n`,
	);
	registerFixture(duplicateDir);
	const duplicate = prepareMigrationCandidate(duplicateDir, {
		id: "adapter/legacy",
		source: "legacy/items.json",
		recordId: "a",
	});
	assert.equal(duplicate.ok, false);
	assert.equal(duplicate.code, "AMBER_E_ADAPTER_CONFLICT");
	assert.equal(duplicate.receipt.status, "conflict");

	const crossScopeDir = mkTarget("candidate-cross-scope");
	fs.mkdirSync(path.join(crossScopeDir, "legacy"), { recursive: true });
	fs.writeFileSync(
		path.join(crossScopeDir, "legacy", "item.json"),
		`${JSON.stringify({
			id: "legacy-1",
			scope: "other-tenant",
			artifact: { type: "intent", identity: "intent/cross", body: "# Cross\n" },
		})}\n`,
	);
	registerFixture(crossScopeDir);
	const crossScope = prepareMigrationCandidate(crossScopeDir, {
		id: "adapter/legacy",
		source: "legacy/item.json",
		recordId: "legacy-1",
	});
	assert.equal(crossScope.ok, false);
	assert.equal(crossScope.code, "AMBER_E_ADAPTER_CONFLICT");
	assert.match(crossScope.receipt.stateReason, /scoped/);

	const aliasDir = mkTarget("candidate-alias-conflict");
	fs.mkdirSync(path.join(aliasDir, "legacy"), { recursive: true });
	fs.writeFileSync(
		path.join(aliasDir, "legacy", "item.json"),
		`${JSON.stringify({
			id: "legacy-1",
			scope: "F051",
			tenant: "other-tenant",
			artifact: { type: "intent", identity: "intent/alias", body: "# Alias\n" },
		})}\n`,
	);
	registerFixture(aliasDir);
	const alias = prepareMigrationCandidate(aliasDir, {
		id: "adapter/legacy",
		source: "legacy/item.json",
		recordId: "legacy-1",
	});
	assert.equal(alias.ok, false);
	assert.equal(alias.code, "AMBER_E_ADAPTER_CONFLICT");
	assert.match(alias.receipt.stateReason, /contradictory scope and tenant/);

	const identityAliasDir = mkTarget("candidate-id-alias-conflict");
	fs.mkdirSync(path.join(identityAliasDir, "legacy"), { recursive: true });
	fs.writeFileSync(
		path.join(identityAliasDir, "legacy", "item.json"),
		`${JSON.stringify({
			id: "legacy-a",
			recordId: "legacy-b",
			scope: "F051",
			artifact: { type: "intent", identity: "intent/id-alias", body: "# Alias\n" },
		})}\n`,
	);
	registerFixture(identityAliasDir);
	const identityAlias = prepareMigrationCandidate(identityAliasDir, {
		id: "adapter/legacy",
		source: "legacy/item.json",
		recordId: "legacy-b",
	});
	assert.equal(identityAlias.ok, false);
	assert.equal(identityAlias.code, "AMBER_E_ADAPTER_CONFLICT");
	assert.match(identityAlias.receipt.stateReason, /contradictory id and recordId/);

	const headAliasDir = mkTarget("candidate-head-alias-conflict");
	fs.mkdirSync(path.join(headAliasDir, "legacy"), { recursive: true });
	fs.writeFileSync(
		path.join(headAliasDir, "legacy", "item.json"),
		`${JSON.stringify({
			id: "legacy-1",
			scope: "F051",
			artifact: {
				type: "intent",
				identity: "intent/head-alias",
				body: "# Alias\n",
				supersedes: 1,
				expectedHead: 2,
			},
		})}\n`,
	);
	registerFixture(headAliasDir);
	const headAlias = prepareMigrationCandidate(headAliasDir, {
		id: "adapter/legacy",
		source: "legacy/item.json",
		recordId: "legacy-1",
	});
	assert.equal(headAlias.ok, false);
	assert.equal(headAlias.code, "AMBER_E_ADAPTER_CONFLICT");
	assert.match(headAlias.receipt.stateReason, /contradictory supersedes and expectedHead/);

	const contradictionDir = mkTarget("candidate-contradiction");
	fs.mkdirSync(path.join(contradictionDir, "legacy"), { recursive: true });
	fs.writeFileSync(
		path.join(contradictionDir, "legacy", "items.json"),
		`${JSON.stringify({
			records: [
				{
					id: "legacy-1",
					scope: "F051",
					artifact: { type: "intent", identity: "intent/one", body: "# One\n" },
				},
				{
					id: "legacy-1",
					scope: "F051",
					artifact: { type: "intent", identity: "intent/two", body: "# Two\n" },
				},
			],
		})}\n`,
	);
	registerFixture(contradictionDir);
	const contradiction = prepareMigrationCandidate(contradictionDir, {
		id: "adapter/legacy",
		source: "legacy/items.json",
		recordId: "legacy-1",
	});
	assert.equal(contradiction.ok, false);
	assert.equal(contradiction.code, "AMBER_E_ADAPTER_CONFLICT");
	assert.match(contradiction.receipt.stateReason, /contradictory/);
});

test("shadow comparison records coverage, hashes, dispositions, and deterministic replay", () => {
	const dir = mkTarget("shadow");
	fs.mkdirSync(path.join(dir, "legacy"), { recursive: true });
	registerFixture(dir);
	const mappedBody = "# Mapped\n";
	assert.equal(
		admitArtifact(dir, {
			type: "intent",
			identity: "intent/mapped",
			body: mappedBody,
			scope: "F051",
		}).ok,
		true,
	);
	assert.equal(
		admitArtifact(dir, {
			type: "intent",
			identity: "intent/scope-mismatch",
			body: "# Scope\n",
			scope: "other-scope",
		}).ok,
		true,
	);
	fs.writeFileSync(
		path.join(dir, "legacy", "mapped.json"),
		`${JSON.stringify({ id: "mapped", scope: "F051", artifact: { type: "intent", identity: "intent/mapped", body: mappedBody } })}\n`,
	);
	fs.writeFileSync(
		path.join(dir, "legacy", "unmapped.json"),
		`${JSON.stringify({ id: "unmapped", scope: "F051", artifact: { type: "intent", identity: "intent/new", body: "# New\n" } })}\n`,
	);
	fs.writeFileSync(
		path.join(dir, "legacy", "scope-mismatch.json"),
		`${JSON.stringify({ id: "scope-mismatch", scope: "F051", artifact: { type: "intent", identity: "intent/scope-mismatch", body: "# Scope\n" } })}\n`,
	);
	fs.writeFileSync(
		path.join(dir, "legacy", "stale.json"),
		`${JSON.stringify({ id: "stale", scope: "F051", artifact: { type: "intent", identity: "intent/stale", body: "# Stale\n" } })}\n`,
	);
	const original = Buffer.from(JSON.stringify({ id: "changed" }));
	fs.writeFileSync(path.join(dir, "legacy", "changed.json"), original);
	fs.writeFileSync(
		path.join(dir, "legacy", "changed.json"),
		JSON.stringify({ id: "changed", v: 2 }),
	);
	const old = new Date("2000-01-01T00:00:00.000Z");
	fs.utimesSync(path.join(dir, "legacy", "stale.json"), old, old);
	const fixture = {
		id: "adapter/legacy",
		fixtureId: "shadow-fixture",
		expectedTotal: 6,
		items: [
			{
				recordId: "mapped",
				source: "legacy/mapped.json",
				target: { type: "intent", identity: "intent/mapped", revision: 1 },
			},
			{ recordId: "unmapped", source: "legacy/unmapped.json", disposition: "defer" },
			{
				recordId: "scope-mismatch",
				source: "legacy/scope-mismatch.json",
				target: { type: "intent", identity: "intent/scope-mismatch", revision: 1 },
			},
			{ recordId: "stale", source: "legacy/stale.json", disposition: "refresh-source" },
			{
				recordId: "changed",
				source: "legacy/changed.json",
				expectedSourceHash: sha256Bytes(original),
				disposition: "resolve-conflict",
			},
			{ recordId: "missing", source: "legacy/missing.json", disposition: "restore-source" },
		],
	};
	const first = compareAdapterShadow(dir, fixture, { now: new Date("2026-08-27T00:00:00.000Z") });
	assert.equal(first.ok, true, (first.errors || []).join("; "));
	assert.deepEqual(first.receipt.coverage, {
		scope: "F051",
		total: 6,
		mapped: 1,
		unmapped: 1,
		stale: 1,
		conflict: 2,
		unavailable: 1,
	});
	assert.match(first.receipt.sourceSetHash, /^sha256:[0-9a-f]{64}$/);
	assert.match(first.receipt.targetSetHash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(
		first.receipt.items[0].target.contentHash,
		showArtifact(dir, "intent/mapped").contentHash,
	);
	assert.equal(first.receipt.items[2].status, "conflict");
	assert.match(first.receipt.items[2].reason, /scope/);
	assert.equal(first.receipt.items[1].disposition, "defer");
	const second = compareAdapterShadow(dir, fixture, { now: new Date("2026-08-27T00:00:00.000Z") });
	assert.equal(second.ok, true, (second.errors || []).join("; "));
	assert.equal(second.receipt.comparisonHash, first.receipt.comparisonHash);
	assert.equal(listShadowComparisons(dir).length, 2);
});

test("shadow comparison requires unmapped disposition and detects tampering", () => {
	const dir = mkTarget("shadow-errors");
	fs.mkdirSync(path.join(dir, "legacy"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, "legacy", "unmapped.json"),
		`${JSON.stringify({ id: "unmapped", scope: "F051", artifact: { type: "intent", identity: "intent/new", body: "# New\n" } })}\n`,
	);
	registerFixture(dir);
	const missingFixtureId = compareAdapterShadow(dir, {
		id: "adapter/legacy",
		expectedTotal: 1,
		items: [{ recordId: "unmapped", source: "legacy/unmapped.json", disposition: "defer" }],
	});
	assert.equal(missingFixtureId.ok, false);
	assert.equal(missingFixtureId.code, "AMBER_E_ADAPTER_COMPARISON_INVALID");
	const missingCoverage = compareAdapterShadow(dir, {
		id: "adapter/legacy",
		fixtureId: "missing-coverage",
		expectedTotal: 2,
		items: [{ recordId: "unmapped", source: "legacy/unmapped.json", disposition: "defer" }],
	});
	assert.equal(missingCoverage.ok, false);
	assert.equal(missingCoverage.code, "AMBER_E_ADAPTER_COMPARISON_COVERAGE_MISSING");
	const missingDisposition = compareAdapterShadow(dir, {
		id: "adapter/legacy",
		fixtureId: "missing-disposition",
		expectedTotal: 1,
		items: [{ recordId: "unmapped", source: "legacy/unmapped.json" }],
	});
	assert.equal(missingDisposition.ok, false);
	assert.equal(missingDisposition.code, "AMBER_E_ADAPTER_COMPARISON_COVERAGE_MISSING");
	const ok = compareAdapterShadow(dir, {
		id: "adapter/legacy",
		fixtureId: "with-disposition",
		expectedTotal: 1,
		items: [{ recordId: "unmapped", source: "legacy/unmapped.json", disposition: "defer" }],
	});
	assert.equal(ok.ok, true, (ok.errors || []).join("; "));
	const event = JSON.parse(fs.readFileSync(comparisonPath(dir), "utf8"));
	event.fixtureHash = sha256Bytes(Buffer.from("tampered"));
	event.hash = chainHash(event, GENESIS_HASH);
	writeJSONL(comparisonPath(dir), [event]);
	assert.throws(
		() => listShadowComparisons(dir),
		(err) => err.amberCode === "AMBER_E_ADAPTER_COMPARISON_CORRUPT",
	);

	const nonObjectDir = mkTarget("shadow-non-object");
	writeJSONL(comparisonPath(nonObjectDir), [null]);
	assert.throws(
		() => listShadowComparisons(nonObjectDir),
		(err) => err.amberCode === "AMBER_E_ADAPTER_COMPARISON_CORRUPT",
	);
});

test("schema v1 read receipts remain readable after v2 state fields", () => {
	const dir = mkTarget("receipt-v1");
	const body = {
		kind: "read",
		schemaVersion: 1,
		at: "2026-08-27T00:00:00.000Z",
		adapterId: "adapter/legacy",
		adapterVersion: "1",
		recordId: "legacy-1",
		recordType: "legacy-ticket",
		recordVersion: "v1",
		scope: "F051",
		source: "legacy/item.json",
		sourceHash: sha256Bytes(Buffer.from("ok")),
		sourceBytes: Buffer.from("ok").toString("base64"),
		sourceByteLength: 2,
		status: "fresh",
		provenance: "adapter:adapter/legacy@1",
	};
	writeJSONL(receiptPath(dir), [
		{ ...body, prevHash: GENESIS_HASH, hash: chainHash(body, GENESIS_HASH) },
	]);
	const receipts = listReadReceipts(dir);
	assert.equal(receipts.length, 1);
	assert.equal(receipts[0].schemaVersion, 1);
	assert.equal(Object.prototype.hasOwnProperty.call(receipts[0], "stateReason"), false);

	const conflictDir = mkTarget("receipt-v1-conflict");
	writeJSONL(receiptPath(conflictDir), [
		{
			...body,
			status: "conflict",
			prevHash: GENESIS_HASH,
			hash: chainHash({ ...body, status: "conflict" }, GENESIS_HASH),
		},
	]);
	assert.throws(
		() => listReadReceipts(conflictDir),
		(err) => err.amberCode === "AMBER_E_ADAPTER_READ_RECEIPT_CORRUPT",
	);

	const freshReasonDir = mkTarget("receipt-v2-fresh-reason");
	const v2 = {
		...body,
		schemaVersion: ADAPTER_READ_RECEIPT_SCHEMA_VERSION,
		expectedSourceHash: null,
		stateReason: "not allowed",
	};
	writeJSONL(receiptPath(freshReasonDir), [
		{ ...v2, prevHash: GENESIS_HASH, hash: chainHash(v2, GENESIS_HASH) },
	]);
	assert.throws(
		() => listReadReceipts(freshReasonDir),
		(err) => err.amberCode === "AMBER_E_ADAPTER_READ_RECEIPT_CORRUPT",
	);

	const unavailableBytesDir = mkTarget("receipt-unavailable-bytes");
	const unavailableWithBytes = {
		...body,
		schemaVersion: ADAPTER_READ_RECEIPT_SCHEMA_VERSION,
		expectedSourceHash: null,
		status: "unavailable",
		stateReason: "missing",
	};
	writeJSONL(receiptPath(unavailableBytesDir), [
		{
			...unavailableWithBytes,
			prevHash: GENESIS_HASH,
			hash: chainHash(unavailableWithBytes, GENESIS_HASH),
		},
	]);
	assert.throws(
		() => listReadReceipts(unavailableBytesDir),
		(err) => err.amberCode === "AMBER_E_ADAPTER_READ_RECEIPT_CORRUPT",
	);

	const hashMismatchDir = mkTarget("receipt-hash-mismatch");
	const hashMismatch = {
		...body,
		schemaVersion: ADAPTER_READ_RECEIPT_SCHEMA_VERSION,
		expectedSourceHash: null,
		stateReason: null,
		sourceHash: sha256Bytes(Buffer.from("other")),
	};
	writeJSONL(receiptPath(hashMismatchDir), [
		{ ...hashMismatch, prevHash: GENESIS_HASH, hash: chainHash(hashMismatch, GENESIS_HASH) },
	]);
	assert.throws(
		() => listReadReceipts(hashMismatchDir),
		(err) => err.amberCode === "AMBER_E_ADAPTER_READ_RECEIPT_CORRUPT",
	);
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
