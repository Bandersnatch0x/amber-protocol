"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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

// ── Fail-closed corruption fixtures (F035-S5, decision D4) ────
//
// Only an ABSENT ledger is a legitimate empty state. A corrupt or unreadable
// Knowledge ledger fails closed with the typed code AMBER_E_KB_CORRUPT.

const KB_CORRUPT = "AMBER_E_KB_CORRUPT";
const ORG_CORRUPT = "AMBER_E_ORG_CORRUPT";
const CORRUPT_CODES = new Set([KB_CORRUPT, ORG_CORRUPT]);

function ledgerFile(dir) {
	return path.join(dir, ".amber", "knowledge", "records.jsonl");
}

function goodLine(recordId = "r-1") {
	return JSON.stringify({ recordId, pageId: "p1", status: "accepted", title: "Page 1" });
}

// corrupt position matrix: first / middle / last JSONL line
const CORRUPT_LEDGERS = [
	["first line corrupt", ["{ not json", goodLine(), goodLine("r-2")]],
	["middle line corrupt", [goodLine(), "{ not json", goodLine("r-2")]],
	["last line corrupt", [goodLine(), goodLine("r-2"), "{ not json"]],
];

function writeLedger(dir, lines) {
	fs.mkdirSync(path.dirname(ledgerFile(dir)), { recursive: true });
	fs.writeFileSync(ledgerFile(dir), lines.join("\n") + "\n");
}

/** assert.throws validator: the error is a typed corruption failure. */
function assertTypedCorruption(err) {
	assert.ok(CORRUPT_CODES.has(err.amberCode), `typed corruption code, got: ${err.amberCode}`);
	assert.ok(err.message.includes(err.amberCode), "diagnostics carry the code");
	assert.ok(err.message.length > err.amberCode.length, "diagnostics are non-empty");
	return true;
}

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
	assert.equal(result.code, KB_CORRUPT, "corruption carries the explicit typed code");
	assert.deepEqual(result.records, [], "corruption yields an empty payload");
	assert.ok(result.errors.length > 0, "corrupt store fails closed");
	assert.ok(result.errors[0].includes(KB_CORRUPT), "diagnostics carry the code");
});

// ── Fail-closed corruption (F035-S5, decision D4) ────────────
//
// Only an ABSENT ledger is a legitimate empty state. A corrupt or unreadable
// Knowledge ledger produces a typed failure — never empty success, never a
// partial projection, and never a misreported "not found" or "scope denied".

test("current-state reads fail closed on a corrupt ledger (first/middle/last line)", () => {
	for (const [label, lines] of CORRUPT_LEDGERS) {
		const dir = mkTarget("corrupt-current");
		writeLedger(dir, lines);
		assert.throws(() => listRecords(dir), assertTypedCorruption, `listRecords: ${label}`);
		assert.throws(() => readRecord(dir, "r-1"), assertTypedCorruption, `readRecord: ${label}`);
	}
});

test("lineage reads fail closed on a corrupt ledger (first/middle/last line)", () => {
	for (const [label, lines] of CORRUPT_LEDGERS) {
		const dir = mkTarget("corrupt-lineage");
		writeLedger(dir, lines);
		assert.throws(
			() => readRecordLineage(dir, "r-1"),
			assertTypedCorruption,
			`readRecordLineage: ${label}`,
		);
	}
});

test("checkFreshness fails closed on a corrupt ledger instead of reporting not-found", () => {
	const dir = mkTarget("corrupt-freshness");
	writeLedger(dir, [goodLine(), "{ not json", goodLine("r-2")]);
	assert.throws(() => checkFreshness(dir, "r-1"), assertTypedCorruption);
});

test("queryKnowledge returns the typed corruption failure on a corrupt ledger", () => {
	for (const [label, lines] of CORRUPT_LEDGERS) {
		const dir = mkTarget("corrupt-query");
		writeLedger(dir, lines);
		for (const params of [{}, { scope: "p1" }]) {
			const result = queryKnowledge(dir, params);
			assert.equal(result.ok, false, `query ${JSON.stringify(params)}: ${label}`);
			assert.equal(result.code, KB_CORRUPT, `query code: ${label}`);
			assert.deepEqual(result.records, [], `empty payload: ${label}`);
			assert.ok(result.errors.length > 0, `non-empty diagnostics: ${label}`);
			assert.ok(result.errors[0].includes(KB_CORRUPT), `code in diagnostics: ${label}`);
		}
	}
});

test("lifecycle transitions fail closed on a corrupt ledger instead of reporting not-found", () => {
	const cases = [
		["reviewKnowledge", (dir) => reviewKnowledge(dir, "r-1", { authorization: "reviewer-1" })],
		["acceptKnowledge", (dir) => acceptKnowledge(dir, "r-1", { authorization: "human-approve" })],
		["markRefreshRequired", (dir) => markRefreshRequired(dir, "r-1", { reason: "drifted" })],
		["refreshKnowledge", (dir) => refreshKnowledge(dir, "r-1", { authorization: "human-approve" })],
		["supersedeRecord", (dir) => supersedeRecord(dir, "r-1", { byRecordId: "r-2" })],
		["retireRecord", (dir) => retireRecord(dir, "r-1", { reason: "obsolete" })],
	];
	for (const [name, transition] of cases) {
		const dir = mkTarget("corrupt-transition");
		writeLedger(dir, [goodLine(), "{ not json", goodLine("r-2")]);
		const result = transition(dir);
		assert.equal(result.ok, false, `${name}: a corrupt store refuses transitions`);
		assert.equal(result.code, KB_CORRUPT, `${name}: typed corruption code`);
		assert.equal(result.record, null, `${name}: empty payload`);
		assert.ok(result.errors.length > 0, `${name}: non-empty diagnostics`);
		assert.ok(result.errors[0].includes(KB_CORRUPT), `${name}: diagnostics carry the code`);
		assert.ok(
			!result.errors[0].includes("not found"),
			`${name}: corruption is never misreported as not-found`,
		);
	}
});

test("reads fail closed on an unreadable ledger (filesystem read error)", () => {
	const dir = mkTarget("corrupt-unreadable");
	// a directory where the ledger file is expected → readFileSync fails
	fs.mkdirSync(ledgerFile(dir), { recursive: true });
	assert.throws(() => listRecords(dir), assertTypedCorruption);
	assert.throws(() => readRecordLineage(dir, "r-1"), assertTypedCorruption);
	assert.throws(() => readRecord(dir, "r-1"), assertTypedCorruption);
});

test("an absent knowledge ledger is a legitimate empty state", () => {
	const dir = mkTarget("absent-ledger");
	assert.deepEqual(listRecords(dir), [], "absent ledger lists empty");
	assert.deepEqual(readRecordLineage(dir, "r-1"), [], "absent ledger has empty lineage");
	assert.equal(readRecord(dir, "r-1"), null);
	const query = queryKnowledge(dir, {});
	assert.equal(query.ok, true);
	assert.deepEqual(query.records, []);
	// a missing record on a healthy (absent) ledger is not-found, never corruption
	const missing = retireRecord(dir, "no-such-record", { reason: "x" });
	assert.equal(missing.ok, false);
	assert.equal(missing.code ?? null, null, "not-found is not typed as corruption");
	assert.ok(missing.errors[0].includes("not found"));
});

test("an unknown-scope denial is never misreported as corruption", () => {
	const dir = mkTarget("deny-vs-corrupt");
	addPage(dir, "p1", { title: "Page 1", sources: source() });
	admitKnowledge(dir, { pageId: "p1", authorization: "human-approve" });
	const denied = queryKnowledge(dir, { scope: "ghost" });
	assert.equal(denied.ok, false);
	assert.equal(denied.code, "AMBER_E_KB_DENY");
	assert.ok(!denied.errors[0].includes(KB_CORRUPT), "denial diagnostics do not claim corruption");
});

test("F035-S5 invariant: no distributed-governance read surface converts corruption into empty success", () => {
	const {
		listAuditEvents,
		checkIsolation,
		auditCrossRepository,
	} = require("../../scripts/lib/core/organization-audit");
	// Every read surface over the Knowledge and Organization audit ledgers.
	// Corrupt input must surface as a typed failure (thrown typed error, or a
	// result object with ok:false + explicit *_CORRUPT code + non-empty
	// diagnostics) — never as an array, a null, or an ok:true empty result.
	const readSurfaces = [
		["knowledge.listRecords", (dir) => listRecords(dir)],
		["knowledge.readRecord", (dir) => readRecord(dir, "r-1")],
		["knowledge.readRecordLineage", (dir) => readRecordLineage(dir, "r-1")],
		["knowledge.checkFreshness", (dir) => checkFreshness(dir, "r-1")],
		["knowledge.queryKnowledge", (dir) => queryKnowledge(dir, {})],
		["knowledge.retireRecord", (dir) => retireRecord(dir, "r-1", { reason: "x" })],
		["orgAudit.listAuditEvents", (dir) => listAuditEvents(dir)],
		["orgAudit.checkIsolation", (dir) => checkIsolation(dir, { tenantId: "tenant-a" })],
		[
			"orgAudit.auditCrossRepository",
			(dir) => auditCrossRepository(dir, { tenantId: "tenant-a", scope: "repo-1" }),
		],
	];
	for (const [name, read] of readSurfaces) {
		const dir = mkTarget("invariant-corrupt");
		// both distributed ledgers corrupt: bad first line on each
		fs.mkdirSync(path.join(dir, ".amber", "knowledge"), { recursive: true });
		fs.writeFileSync(path.join(dir, ".amber", "knowledge", "records.jsonl"), "{ not json\n");
		fs.mkdirSync(path.join(dir, ".amber", "audit"), { recursive: true });
		fs.writeFileSync(path.join(dir, ".amber", "audit", "events.jsonl"), "{ not json\n");

		let outcome;
		try {
			outcome = { threw: false, value: read(dir) };
		} catch (err) {
			outcome = { threw: true, error: err };
		}
		if (outcome.threw) {
			assert.ok(
				CORRUPT_CODES.has(outcome.error.amberCode),
				`${name}: corruption must throw a typed error, got: ${outcome.error.message}`,
			);
			continue;
		}
		const value = outcome.value;
		const masqueradesAsData =
			value === null ||
			typeof value !== "object" ||
			Array.isArray(value) ||
			typeof value.ok !== "boolean";
		assert.equal(
			masqueradesAsData,
			false,
			`${name}: corruption surfaced as data (${JSON.stringify(value)?.slice(0, 60)}) instead of a typed failure`,
		);
		assert.equal(value.ok, false, `${name}: corruption is never empty success`);
		assert.ok(CORRUPT_CODES.has(value.code), `${name}: explicit corruption code`);
		assert.ok(value.errors.length > 0, `${name}: non-empty diagnostics`);
		for (const key of ["records", "events"]) {
			if (Array.isArray(value[key]))
				assert.deepEqual(value[key], [], `${name}: empty ${key} payload`);
		}
	}
});
