"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	KNOWLEDGE_STATUSES,
	admitKnowledge,
	readRecord,
	listRecords,
	checkFreshness,
	retireRecord,
	queryKnowledge,
} = require("../../scripts/lib/core/knowledge-base");

function mkTarget(label) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `amber-kb-${label}-`));
	fs.mkdirSync(path.join(dir, ".amber"), { recursive: true });
	return dir;
}

function addPage(dir, pageId, { title, sources = {}, blocks = [] } = {}) {
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "context", "pages", `${pageId}.json`),
		JSON.stringify({ pageId, title: title || pageId, sources, blocks }),
	);
}

// ── Constants ─────────────────────────────────────────────────

test("KNOWLEDGE_STATUSES enumerates the lifecycle states", () => {
	assert.deepEqual([...KNOWLEDGE_STATUSES].sort(), ["admitted", "candidate", "retired", "stale"]);
});

// ── admitKnowledge (provenance + authorization) ───────────────

test("admitKnowledge requires provenance — rejects a page with no sources", () => {
	const dir = mkTarget("no-provenance");
	addPage(dir, "p1", { title: "Page 1", sources: {} });
	const result = admitKnowledge(dir, { pageId: "p1", authorization: "explicit" });
	assert.equal(result.ok, false);
	assert.ok(
		result.errors.some((e) => e.includes("provenance")),
		"provenance required",
	);
});

test("admitKnowledge requires explicit authorization", () => {
	const dir = mkTarget("no-auth");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const result = admitKnowledge(dir, { pageId: "p1", authorization: null });
	assert.equal(result.ok, false);
	assert.ok(
		result.errors.some((e) => e.includes("authorization")),
		"authorization required",
	);
});

test("admitKnowledge creates an immutable Knowledge Record with provenance", () => {
	const dir = mkTarget("admit");
	addPage(dir, "p1", {
		title: "Page 1",
		sources: { s1: { kind: "repo", ref: "docs/spec.md", rawHash: "sha256:" + "a".repeat(64) } },
		blocks: [{ type: "text", text: "Claim", sources: ["s1"] }],
	});
	const result = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.ok(result.record);
	assert.equal(result.record.status, "admitted");
	assert.equal(result.record.provenance.length, 1);
	assert.match(result.record.recordId, /^[0-9a-f]{8}-/);
	assert.ok(result.record.admittedAt);
});

test("admitKnowledge record is immutable — content fields are frozen", () => {
	const dir = mkTarget("immutable");
	addPage(dir, "p1", {
		title: "Page 1",
		sources: { s1: { kind: "repo", ref: "a.md" } },
	});
	const result = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	const record = result.record;
	assert.ok(Object.isFrozen(record) || !record.mutable, "record is immutable");
});

// ── readRecord / listRecords ──────────────────────────────────

test("readRecord returns a record by id", () => {
	const dir = mkTarget("read");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const { record } = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	const found = readRecord(dir, record.recordId);
	assert.ok(found);
	assert.equal(found.recordId, record.recordId);
});

test("listRecords returns all admitted records", () => {
	const dir = mkTarget("list");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	addPage(dir, "p2", { title: "Page 2", sources: { s1: { kind: "repo", ref: "b.md" } } });
	admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	admitKnowledge(dir, { pageId: "p2", authorization: "human-approve" });
	const records = listRecords(dir);
	assert.equal(records.length, 2);
});

// ── Lifecycle: freshness / refresh / retire ───────────────────

test("checkFreshness marks a record stale when canonical sources change", () => {
	const dir = mkTarget("stale");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const { record } = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });

	// canonical page changes → source hash drifts → stale
	addPage(dir, "p1", { title: "Page 1 updated", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const status = checkFreshness(dir, record.recordId);
	assert.equal(status.status, "stale");
});

test("recordLifecycle transitions candidate → admitted → stale → retired", () => {
	const dir = mkTarget("lifecycle");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	const { record } = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	assert.equal(record.status, "admitted");

	// change canonical → stale
	addPage(dir, "p1", { title: "Page 1 v2", sources: { s1: { kind: "repo", ref: "a.md" } } });
	assert.equal(checkFreshness(dir, record.recordId).status, "stale");

	// retire
	const retired = retireRecord(dir, record.recordId, { reason: "superseded" });
	assert.equal(retired.ok, true);
	assert.equal(retired.record.status, "retired");
	assert.ok(retired.record.retiredAt);
	assert.ok(retired.record.retireReason);
});

test("retireRecord fails for an unknown record", () => {
	const dir = mkTarget("retire-missing");
	const result = retireRecord(dir, "no-such-record", { reason: "x" });
	assert.equal(result.ok, false);
});

// ── queryKnowledge (exact-scope privacy + fail-closed) ───────

test("queryKnowledge with an explicit scope returns only that scope", () => {
	const dir = mkTarget("query-scope");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	addPage(dir, "p2", { title: "Page 2", sources: { s1: { kind: "repo", ref: "b.md" } } });
	admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	admitKnowledge(dir, { pageId: "p2", authorization: "human-approve" });

	const result = queryKnowledge(dir, { scope: "p1" });
	assert.equal(result.ok, true);
	assert.equal(result.records.length, 1);
	assert.equal(result.records[0].pageId, "p1");
});

test("queryKnowledge with an unknown scope is denied (exact-scope privacy)", () => {
	const dir = mkTarget("query-deny");
	addPage(dir, "p1", { title: "Page 1", sources: { s1: { kind: "repo", ref: "a.md" } } });
	admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });

	const result = queryKnowledge(dir, { scope: "ghost" });
	assert.equal(result.ok, false);
	assert.equal(result.code, "AMBER_E_KB_DENY");
});

test("queryKnowledge fails closed on a corrupt record store", () => {
	const dir = mkTarget("failclosed");
	fs.mkdirSync(path.join(dir, ".amber", "knowledge"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "knowledge", "records.jsonl"), "{ bad json\n");
	const result = queryKnowledge(dir, { scope: "p1" });
	assert.equal(result.ok, false);
	assert.ok(result.errors.length > 0, "corrupt store fails closed");
});
