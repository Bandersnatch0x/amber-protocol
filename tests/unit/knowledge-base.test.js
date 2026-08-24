"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	KNOWLEDGE_STATUSES,
	candidateKnowledge,
	admitKnowledge,
	readRecord,
	readRecordLineage,
	listRecords,
	reviewKnowledge,
	acceptKnowledge,
	markRefreshRequired,
	refreshKnowledge,
	supersedeRecord,
	checkFreshness,
	retireRecord,
	queryKnowledge,
} = require("../../scripts/lib/core/knowledge-base");
const { mkTarget, addPage } = require("../helpers/harness");

function source() {
	return { s1: { kind: "repo", ref: "a.md", rawHash: "sha256:" + "a".repeat(64) } };
}

// ── Constants ─────────────────────────────────────────────────

test("KNOWLEDGE_STATUSES enumerates the seven baseline lifecycle states", () => {
	assert.deepEqual([...KNOWLEDGE_STATUSES].sort(), [
		"accepted",
		"candidate",
		"refresh-required",
		"retired",
		"review",
		"stale",
		"superseded",
	]);
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
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const result = admitKnowledge(dir, { pageId: "p1", authorization: null });
	assert.equal(result.ok, false);
	assert.ok(
		result.errors.some((e) => e.includes("authorization")),
		"authorization required",
	);
});

test("admitKnowledge creates an immutable accepted record with provenance", () => {
	const dir = mkTarget("admit");
	addPage(dir, "p1", {
		title: "Page 1",
		sources: { s1: { kind: "repo", ref: "docs/spec.md", rawHash: "sha256:" + "a".repeat(64) } },
		blocks: [{ type: "text", text: "Claim", sources: ["s1"] }],
	});
	const result = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.ok(result.record);
	assert.equal(result.record.status, "accepted");
	assert.equal(result.record.provenance.length, 1);
	assert.match(result.record.recordId, /^[0-9a-f]{8}-/);
	assert.ok(result.record.admittedAt);
});

test("admitKnowledge record is immutable — content fields are frozen", () => {
	const dir = mkTarget("immutable");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const result = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	const record = result.record;
	assert.ok(Object.isFrozen(record), "record is immutable");
});

// ── candidate / review / accept ───────────────────────────────

test("candidateKnowledge creates a proposal that needs no authorization", () => {
	const dir = mkTarget("candidate");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const result = candidateKnowledge(dir, { pageId: "p1" });
	assert.equal(result.ok, true);
	assert.equal(result.record.status, "candidate");
});

test("reviewKnowledge moves a candidate into review (authorization required)", () => {
	const dir = mkTarget("review");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const { record } = candidateKnowledge(dir, { pageId: "p1" });
	const noAuth = reviewKnowledge(dir, record.recordId, { authorization: null });
	assert.equal(noAuth.ok, false);
	const reviewed = reviewKnowledge(dir, record.recordId, { authorization: "reviewer-1" });
	assert.equal(reviewed.ok, true);
	assert.equal(reviewed.record.status, "review");
	assert.ok(reviewed.record.reviewRequestedAt);
});

test("acceptKnowledge accepts only review/candidate records", () => {
	const dir = mkTarget("accept");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const { record } = candidateKnowledge(dir, { pageId: "p1" });
	reviewKnowledge(dir, record.recordId, { authorization: "reviewer-1" });
	const accepted = acceptKnowledge(dir, record.recordId, { authorization: "human-approve" });
	assert.equal(accepted.ok, true, JSON.stringify(accepted.errors));
	assert.equal(accepted.record.status, "accepted");
	// a second accept from accepted is refused
	const again = acceptKnowledge(dir, record.recordId, { authorization: "human-approve" });
	assert.equal(again.ok, false);
});

// ── readRecord / listRecords / lineage ────────────────────────

test("readRecord returns the current state of a record by id", () => {
	const dir = mkTarget("read");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const { record } = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	const found = readRecord(dir, record.recordId);
	assert.ok(found);
	assert.equal(found.recordId, record.recordId);
	assert.equal(found.status, "accepted");
});

test("listRecords returns the current state of every record", () => {
	const dir = mkTarget("list");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	addPage(dir, "p2", { title: "Page 2", sources: { s1: { kind: "repo", ref: "b.md" } } });
	admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	admitKnowledge(dir, { pageId: "p2", authorization: "human-approve" });
	const records = listRecords(dir);
	assert.equal(records.length, 2);
});

test("the ledger is append-only: retirement never rewrites the admitted line", () => {
	const dir = mkTarget("append-only");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const { record } = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	const admittedLine = fs
		.readFileSync(path.join(dir, ".amber", "knowledge", "records.jsonl"), "utf8")
		.trim();
	retireRecord(dir, record.recordId, { reason: "obsolete" });
	const lines = fs
		.readFileSync(path.join(dir, ".amber", "knowledge", "records.jsonl"), "utf8")
		.split(/\r?\n/)
		.filter(Boolean);
	assert.equal(lines.length, 2, "two immutable lines: admitted + retired");
	assert.equal(lines[0].trim(), admittedLine, "the admitted line is untouched");
	const lineage = readRecordLineage(dir, record.recordId);
	assert.equal(lineage.length, 2);
	assert.equal(lineage[0].status, "accepted");
	assert.equal(lineage[1].status, "retired");
	// current state resolves to the last line
	assert.equal(readRecord(dir, record.recordId).status, "retired");
});

// ── Lifecycle: freshness / refresh / supersede / retire ───────

test("checkFreshness marks a record stale when canonical sources change", () => {
	const dir = mkTarget("stale");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const { record } = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });

	// canonical page changes → source hash drifts → stale
	addPage(dir, "p1", { title: "Page 1 updated", sources: source() });
	const status = checkFreshness(dir, record.recordId);
	assert.equal(status.status, "stale");
});

test("markRefreshRequired and refreshKnowledge restore accepted status", () => {
	const dir = mkTarget("refresh");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const { record } = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	addPage(dir, "p1", { title: "Page 1 v2", sources: source() });

	const flagged = markRefreshRequired(dir, record.recordId, { reason: "drifted" });
	assert.equal(flagged.ok, true);
	assert.equal(flagged.record.status, "refresh-required");
	assert.ok(flagged.record.refreshRequiredAt);

	// refresh requires authorization
	const noAuth = refreshKnowledge(dir, record.recordId, { authorization: null });
	assert.equal(noAuth.ok, false);
	const refreshed = refreshKnowledge(dir, record.recordId, {
		authorization: "human-approve",
		reason: "page updated",
	});
	assert.equal(refreshed.ok, true, JSON.stringify(refreshed.errors));
	assert.equal(refreshed.record.status, "accepted");
	assert.equal(refreshed.record.refreshHistory.length, 1);
	// refreshed record is no longer stale
	assert.equal(checkFreshness(dir, record.recordId).status, "accepted");
});

test("supersedeRecord marks a record superseded with lineage", () => {
	const dir = mkTarget("supersede");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const { record } = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	const result = supersedeRecord(dir, record.recordId, {
		byRecordId: "new-record-1",
		reason: "replaced by p2",
	});
	assert.equal(result.ok, true, JSON.stringify(result.errors));
	assert.equal(result.record.status, "superseded");
	assert.equal(result.record.supersededBy, "new-record-1");
	assert.ok(result.record.supersededAt);
	// terminal: cannot transition onward
	const retire = retireRecord(dir, record.recordId, { reason: "x" });
	assert.equal(retire.ok, false);
	assert.ok(retire.errors.some((e) => e.includes("terminal")));
});

test("recordLifecycle transitions candidate → review → accepted → stale → refresh-required → accepted", () => {
	const dir = mkTarget("lifecycle");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const { record } = candidateKnowledge(dir, { pageId: "p1" });
	assert.equal(record.status, "candidate");

	reviewKnowledge(dir, record.recordId, { authorization: "reviewer-1" });
	assert.equal(readRecord(dir, record.recordId).status, "review");

	acceptKnowledge(dir, record.recordId, { authorization: "human-approve" });
	assert.equal(readRecord(dir, record.recordId).status, "accepted");

	// change canonical → stale
	addPage(dir, "p1", { title: "Page 1 v2", sources: source() });
	assert.equal(checkFreshness(dir, record.recordId).status, "stale");

	// refresh-required → refresh → accepted
	markRefreshRequired(dir, record.recordId, { reason: "drifted" });
	assert.equal(readRecord(dir, record.recordId).status, "refresh-required");
	refreshKnowledge(dir, record.recordId, { authorization: "human-approve" });
	assert.equal(readRecord(dir, record.recordId).status, "accepted");

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

test("checkFreshness reports terminal records as terminal, never stale", () => {
	const dir = mkTarget("terminal-fresh");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	const { record } = admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	retireRecord(dir, record.recordId, { reason: "obsolete" });
	addPage(dir, "p1", { title: "Page 1 drifted after retirement", sources: source() });
	assert.equal(checkFreshness(dir, record.recordId).status, "retired");
});

// ── queryKnowledge (exact-scope privacy + fail-closed) ───────

test("queryKnowledge with an explicit scope returns only that scope", () => {
	const dir = mkTarget("query-scope");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
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
	addPage(dir, "p1", { title: "Page 1", sources: source() });
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
