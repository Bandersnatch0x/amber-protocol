"use strict";

// Integration coverage for the Governed Memory Layer (spec
// docs/specs/2026-08-21-governed-memory-layer.md, batch A §13 step 9).
//
// Chain-level assertions (§14-5 dogfood replay): request → ingest → approve →
// book → status, with the §9 event payloads, the §4.1 state machine edges,
// the §5/§6 gates (identity, schema, binding, signal, α, γ), the F1/F3
// lineage rules, and the §11 doctor rules 1–11 (positive and negative).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "../..");
const { memoryDispatch } = require("../../scripts/lib/memory-commands");
const memoryStore = require("../../scripts/lib/core/memory-store");
const { hashFile } = require("../../scripts/lib/core/context-hash");
const { doctorMemoryRules } = require("../../scripts/lib/core/doctor");
const { buildGovernanceReport } = require("../../scripts/lib/core/governance-report");

function mkTarget() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-memory-int-"));
	const { spawnSync } = require("node:child_process");
	spawnSync("git", ["init", "-q", dir], { encoding: "utf8" });
	fs.writeFileSync(
		path.join(dir, "MEMORY.md"),
		["# Memory", "", "Durable project knowledge selected by humans.", "", "## Entries", ""].join(
			"\n",
		),
	);
	return dir;
}

function writePayload(target, name, body) {
	const file = `${name}.json`;
	fs.writeFileSync(path.join(target, file), JSON.stringify(body, null, 2));
	return file;
}

function entryFor(target, claim, overrides = {}) {
	const hashed = hashFile(path.join(target, "MEMORY.md"));
	return {
		schemaVersion: "1.0.0",
		claim,
		knowledgeKind: "pattern",
		targetSurface: "MEMORY.md",
		provenance: {
			sources: [
				{
					kind: "file",
					ref: "MEMORY.md",
					rawHash: hashed.rawHash,
					normHash: hashed.normHash,
					mutable: true,
				},
			],
		},
		...overrides,
	};
}

function requestFor(requestId, entries, provenance = { channel: "t1-writeback" }) {
	return {
		schemaVersion: "1.0.0",
		requestId,
		createdAt: new Date().toISOString(),
		triggerRef: { ref: "session-test-1" },
		provenance,
		entries,
		contract: { instructions: "test", constraints: { forbidNewFacts: true } },
		acceptance: [{ check: "entry schema", code: "AMBER_E_MEMORY_ENTRY_SCHEMA_INVALID" }],
	};
}

function run(target, sub, args = {}) {
	return memoryDispatch(sub, { target, json: true, yes: true, ...args }, target);
}

function events(target) {
	return memoryStore.readMemoryEvents(target, 0);
}

// ── §14-5 dogfood replay: the full T1 chain ──────────────────────────────────

test("T1 chain replays request → ingest → approve → book → status with §9 payloads", () => {
	const target = mkTarget();
	const payload = writePayload(
		target,
		"mem-payload",
		requestFor("mreq-chain-1", [entryFor(target, "Chain: prefer explicit --target over cwd")]),
	);

	const request = run(target, "request", { payload });
	assert.equal(request.exitCode, 0, JSON.stringify(request.result));
	assert.equal(request.result.requestId, "mreq-chain-1");
	const entryId = request.result.entryIds[0];
	assert.match(entryId, /^sha256:[0-9a-f]{64}$/);

	const ingest = run(target, "ingest", { request: "mreq-chain-1" });
	assert.equal(ingest.exitCode, 0, JSON.stringify(ingest.result));
	assert.equal(ingest.result.outcome, "admitted");
	assert.deepEqual(ingest.result.entryIds, [entryId]);
	assert.equal(memoryStore.readEntry(target, entryId).status, "proposal");

	const approve = run(target, "approve", { entryId, decision: "approve" });
	assert.equal(approve.exitCode, 0);
	assert.match(approve.result.text, /Memory creed/, "§5.4: approve surfaces the creed");

	const book = run(target, "book", { entryId });
	assert.equal(book.exitCode, 0);
	assert.equal(book.result.origin, "governed-promotion");
	assert.match(book.result.normHash, /^sha256:[0-9a-f]{64}$/);
	assert.equal(memoryStore.readEntry(target, entryId).status, "active");

	const status = run(target, "status");
	assert.equal(status.exitCode, 0);
	assert.equal(status.result.entries.active, 1);
	assert.equal(
		status.result.entries.pendingRequests,
		0,
		"§5.2-C5: book resolves the fully-disposed request",
	);
	assert.equal(status.result.gamma, undefined, "F089 retired the gamma projection");
	assert.equal(status.result.alpha, undefined, "F086 retired the alpha budget projection");
	assert.ok(Number.isInteger(status.result.surface.bytes));
	assert.equal(
		status.result.surface.entries,
		0,
		"surface reflects the physical file: booking registers a hash and never writes MEMORY.md",
	);

	const kinds = events(target).map((e) => e.kind);
	assert.deepEqual(kinds, [
		"memory-request-created",
		"memory-ingest",
		"memory-approval",
		"memory-book",
	]);
	const [created, ingested, approved, booked] = events(target);
	assert.equal(created.requestId, "mreq-chain-1");
	assert.equal(created.channel, "t1-writeback");
	assert.equal(created.triggerRef.ref, "session-test-1");
	assert.deepEqual(created.entryIds, [entryId]);
	assert.equal(ingested.outcome, "admitted");
	assert.deepEqual(ingested.entryIds, [entryId]);
	assert.equal(approved.decision, "approve");
	assert.equal(approved.decidedBy, "human");
	assert.equal(approved.entryId, entryId);
	assert.equal(booked.origin, "governed-promotion");
	assert.equal(booked.surfacePath, "MEMORY.md");
	assert.match(booked.normHash, /^sha256:/);
	assert.equal(booked.requestId, "mreq-chain-1");

	const doctorResult = doctorMemoryRules(target);
	assert.deepEqual(doctorResult.errors, [], doctorResult.errors.join("\n"));
	assert.deepEqual(doctorResult.warnings, [], doctorResult.warnings.join("\n"));
	fs.rmSync(target, { recursive: true, force: true });
});

// ── F089: the non-TTY identity gate is retired ──────────────────────────────

test("non-TTY request/ingest approve/book run without --yes (no identity gate)", () => {
	const target = mkTarget();
	const payload = writePayload(
		target,
		"ungated",
		requestFor("mreq-ungated", [entryFor(target, "Ungated: non-TTY agents may admit")]),
	);
	const request = memoryDispatch("request", { target, json: true, payload }, target);
	assert.equal(request.exitCode, 0, JSON.stringify(request.result));
	assert.notEqual(request.result.code, "AMBER_E_MEMORY_APPROVAL_REQUIRED");

	const entryId = request.result.entryIds[0];
	const ingest = memoryDispatch("ingest", { target, json: true, request: "mreq-ungated" }, target);
	assert.equal(ingest.exitCode, 0, JSON.stringify(ingest.result));

	const approve = memoryDispatch(
		"approve",
		{ target, json: true, entryId, decision: "approve" },
		target,
	);
	assert.equal(approve.exitCode, 0, JSON.stringify(approve.result));

	const book = memoryDispatch("book", { target, json: true, entryId }, target);
	assert.equal(book.exitCode, 0, JSON.stringify(book.result));
	fs.rmSync(target, { recursive: true, force: true });
});

// ── §5.2/§5.3 schema + binding + signal gates ───────────────────────────────

test("request rejects payload files that violate the memory-request schema", () => {
	const target = mkTarget();
	const bad = writePayload(target, "bad", { ...requestFor("mreq-bad-schema"), entries: [] });
	const response = run(target, "request", { payload: bad });
	assert.equal(response.exitCode, 1);
	assert.equal(response.result.code, "AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID");
	fs.rmSync(target, { recursive: true, force: true });
});

test("ingest refuses entries whose source hashes no longer bind (checkRequestBinding reuse)", () => {
	const target = mkTarget();
	const payload = writePayload(
		target,
		"bind",
		requestFor("mreq-bind-1", [entryFor(target, "bind")]),
	);
	assert.equal(run(target, "request", { payload }).exitCode, 0);
	fs.appendFileSync(path.join(target, "MEMORY.md"), "late edit\n");
	const ingest = run(target, "ingest", { request: "mreq-bind-1" });
	assert.equal(ingest.exitCode, 1);
	assert.equal(ingest.result.code, "AMBER_E_MEMORY_BINDING_MISMATCH");
	fs.rmSync(target, { recursive: true, force: true });
});

test("conversion channels require a closed-set signal id at ingest", () => {
	const target = mkTarget();
	const payload = writePayload(target, "signal", {
		channel: "distill-conversion",
		entries: [entryFor(target, "signal")],
	});
	// Direct payload ingest bypasses the request schema's conditional, so the
	// ingest-stage signal gate (§5.3-M13) is the only remaining guard.
	const ingest = run(target, "ingest", { payload });
	assert.equal(ingest.exitCode, 1);
	assert.equal(ingest.result.code, "AMBER_E_MEMORY_SIGNAL_INVALID");
	fs.rmSync(target, { recursive: true, force: true });
});

// ── retired budgets: the α surface cap and the γ admission limit ────────────

test("ingest admits six entries in one batch (retired alpha and gamma limits)", () => {
	const target = mkTarget();
	const big = "B".repeat(2000);
	const payload = writePayload(
		target,
		"alpha",
		requestFor("mreq-alpha-1", [
			entryFor(target, big),
			entryFor(target, `${big} 2`),
			entryFor(target, `${big} 3`),
			entryFor(target, `${big} 4`),
			entryFor(target, `${big} 5`),
			entryFor(target, `${big} 6`),
		]),
	);
	assert.equal(run(target, "request", { payload }).exitCode, 0);
	const ingest = run(target, "ingest", { request: "mreq-alpha-1" });
	assert.equal(ingest.exitCode, 0);
	assert.equal(ingest.result.code, undefined);
	assert.equal(ingest.result.entryIds.length, 6, "no five-entry window may reappear");
	fs.rmSync(target, { recursive: true, force: true });
});

test("approve --decision reject requires a reason and drives proposal → draft", () => {
	const target = mkTarget();
	const payload = writePayload(
		target,
		"rej",
		requestFor("mreq-rej-1", [entryFor(target, "reject me")]),
	);
	run(target, "request", { payload });
	const ingest = run(target, "ingest", { request: "mreq-rej-1" });
	const entryId = ingest.result.entryIds[0];

	const noReason = run(target, "approve", { entryId, decision: "reject" });
	assert.equal(noReason.exitCode, 1);
	assert.equal(noReason.result.code, "AMBER_E_MEMORY_STATE_INVALID");

	const rejected = run(target, "approve", {
		entryId,
		decision: "reject",
		reason: "session detail",
	});
	assert.equal(rejected.exitCode, 0);
	const entry = memoryStore.readEntry(target, entryId);
	assert.equal(entry.status, "draft");
	assert.equal(entry.lastRejection.reason, "session detail");
	const approval = events(target).find((e) => e.kind === "memory-approval");
	assert.equal(approval.decision, "reject");
	assert.equal(approval.reason, "session detail");

	const reApprove = run(target, "approve", { entryId, decision: "approve" });
	assert.equal(reApprove.exitCode, 1, "approve only accepts proposal state");
	assert.equal(reApprove.result.code, "AMBER_E_MEMORY_STATE_INVALID");
	fs.rmSync(target, { recursive: true, force: true });
});

test("β pair: approving a supersedeTarget completes the pair atomically", () => {
	const target = mkTarget();
	const first = writePayload(
		target,
		"beta-a",
		requestFor("mreq-beta-1", [entryFor(target, "beta old")]),
	);
	run(target, "request", { payload: first });
	const oldId = run(target, "ingest", { request: "mreq-beta-1" }).result.entryIds[0];
	run(target, "approve", { entryId: oldId, decision: "approve" });
	run(target, "book", { entryId: oldId });

	const second = writePayload(
		target,
		"beta-b",
		requestFor("mreq-beta-2", [entryFor(target, "beta new", { supersedeTarget: oldId })]),
	);
	run(target, "request", { payload: second });
	const newId = run(target, "ingest", { request: "mreq-beta-2" }).result.entryIds[0];
	const approve = run(target, "approve", { entryId: newId, decision: "approve" });
	assert.equal(approve.exitCode, 0);
	assert.equal(approve.result.supersededEntryId, oldId);
	assert.equal(memoryStore.readEntry(target, newId).approvedAt !== null, true);
	assert.equal(memoryStore.readEntry(target, oldId).status, "superseded");
	const approvals = events(target).filter((e) => e.kind === "memory-approval");
	assert.equal(
		approvals.filter((e) => e.entryId === newId).length,
		2,
		"β pair writes two same-call events for the approving entry",
	);
	assert.ok(
		approvals.some((e) => e.supersededEntryId === oldId),
		"second event carries supersededEntryId",
	);
	fs.rmSync(target, { recursive: true, force: true });
});

test("book guards: unknown ids fail and non-promotable states are refused", () => {
	const target = mkTarget();
	const missing = run(target, "book", { entryId: "sha256:" + "0".repeat(64) });
	assert.equal(missing.exitCode, 1);
	assert.equal(missing.result.code, "AMBER_E_MEMORY_ENTRY_NOT_FOUND");

	const payload = writePayload(
		target,
		"draft",
		requestFor("mreq-draft-1", [entryFor(target, "stay draft")]),
	);
	run(target, "request", { payload });
	const entryId = run(target, "ingest", { request: "mreq-draft-1" }).result.entryIds[0];
	run(target, "approve", { entryId, decision: "reject", reason: "reconstructible" });
	const booked = run(target, "book", { entryId });
	assert.equal(booked.exitCode, 1);
	assert.equal(booked.result.code, "AMBER_E_MEMORY_STATE_INVALID");
	fs.rmSync(target, { recursive: true, force: true });
});

test("abandon is terminal for entries and resolves requests", () => {
	const target = mkTarget();
	const payload = writePayload(
		target,
		"ab",
		requestFor("mreq-ab-1", [entryFor(target, "abandon me")]),
	);
	run(target, "request", { payload });
	const entryId = run(target, "ingest", { request: "mreq-ab-1" }).result.entryIds[0];

	const abandoned = run(target, "abandon", { entry: entryId });
	assert.equal(abandoned.exitCode, 0);
	assert.equal(memoryStore.readEntry(target, entryId).status, "abandoned");
	const abandonEvent = events(target).find((e) => e.kind === "memory-abandon");
	assert.equal(abandonEvent.scope, "entry");
	assert.equal(abandonEvent.triggerSource, "explicit");
	assert.equal(abandonEvent.targetId, entryId);

	const again = run(target, "abandon", { entry: entryId });
	assert.equal(again.exitCode, 1, "abandoned is terminal");
	assert.equal(again.result.code, "AMBER_E_MEMORY_STATE_INVALID");

	const both = run(target, "abandon", { entry: entryId, request: "mreq-ab-1" });
	assert.equal(both.exitCode, 1, "exactly one of --request or --entry");
	fs.rmSync(target, { recursive: true, force: true });
});

// ── §5.6-F1 / §3.5-F3 lineage rules ─────────────────────────────────────────

test("F1(i): three ingest rejections auto-abandon the request lineage", () => {
	const target = mkTarget();
	// Binding drift (not schema shape) so the request itself is created and the
	// rejection is an ingest-stage verdict — three refusals abandon the lineage.
	const payload = writePayload(target, "f1", requestFor("mreq-f1-1", [entryFor(target, "f1")]));
	run(target, "request", { payload });
	fs.appendFileSync(path.join(target, "MEMORY.md"), "drift\n");
	for (let i = 0; i < 3; i += 1) {
		const ingest = run(target, "ingest", { request: "mreq-f1-1" });
		assert.equal(ingest.exitCode, 1);
		assert.equal(ingest.result.code, "AMBER_E_MEMORY_BINDING_MISMATCH");
	}
	const stored = memoryStore.readRequests(target).find((r) => r.requestId === "mreq-f1-1");
	assert.equal(stored.status, "resolved");
	const auto = events(target)
		.filter((e) => e.kind === "memory-abandon")
		.pop();
	assert.equal(auto.scope, "request");
	assert.equal(auto.triggerSource, "auto-threshold");
	assert.equal(auto.targetId, "mreq-f1-1");
	fs.rmSync(target, { recursive: true, force: true });
});

test("F3: re-ingest (rebuild) never re-admits abandoned entries", () => {
	const target = mkTarget();
	const payload = writePayload(
		target,
		"f3",
		requestFor("mreq-f3-1", [entryFor(target, "f3 entry")]),
	);
	run(target, "request", { payload });
	const entryId = run(target, "ingest", { request: "mreq-f3-1" }).result.entryIds[0];
	run(target, "abandon", { entry: entryId });

	// §5.6-F1(i)/C5: abandoning the request's only entry resolves it — the
	// lineage is terminal and re-ingest is refused, never re-admitted.
	const refused = run(target, "ingest", { request: "mreq-f3-1" });
	assert.equal(refused.exitCode, 1);
	assert.equal(refused.result.code, "AMBER_E_MEMORY_STATE_INVALID");
	assert.match(refused.result.errors[0], /resolved.*derivedFrom|derivedFrom.*resolved/);
	assert.equal(memoryStore.readEntry(target, entryId).status, "abandoned");

	// Rebuild path: a still-open request whose candidate went abandoned via a
	// direct registry write (no verb, so no C5 resolution) ingests as no-change.
	const payload2 = writePayload(
		target,
		"f3b",
		requestFor("mreq-f3-2", [entryFor(target, "f3 entry two")]),
	);
	run(target, "request", { payload: payload2 });
	const entryId2 = run(target, "ingest", { request: "mreq-f3-2" }).result.entryIds[0];
	const stored = memoryStore.readEntry(target, entryId2);
	stored.status = "abandoned";
	memoryStore.writeEntry(target, stored);

	const rebuild = run(target, "ingest", { request: "mreq-f3-2" });
	assert.equal(rebuild.exitCode, 0);
	assert.equal(
		rebuild.result.outcome,
		"no-change",
		"§5.3-M3: an all-abandoned batch is a legal no-change",
	);
	assert.deepEqual(rebuild.result.entryIds, [], "abandoned entry is not re-admitted");
	assert.match(rebuild.result.text, /F3 rebuild exclusion/, "skip is surfaced in the outcome text");
	assert.equal(memoryStore.readEntry(target, entryId2).status, "abandoned");
	const noChangeEvent = events(target)
		.filter((e) => e.kind === "memory-ingest")
		.filter((e) => e.requestId === "mreq-f3-2")
		.pop();
	assert.equal(noChangeEvent.outcome, "no-change");
	assert.deepEqual(noChangeEvent.entryIds, []);
	assert.deepEqual(noChangeEvent.skippedAbandoned, [entryId2]);
	fs.rmSync(target, { recursive: true, force: true });
});

// ── §11 doctor rules 1–5 (fail-closed consistency + drift) ──────────────────

test("doctor rule 1: registry entries without a ledger trail are fail-closed errors", () => {
	const target = mkTarget();
	const payload = writePayload(target, "r1", requestFor("mreq-r1-1", [entryFor(target, "orphan")]));
	run(target, "request", { payload });
	const entryId = run(target, "ingest", { request: "mreq-r1-1" }).result.entryIds[0];
	// Simulate ledger loss: drop the events file, keep the registry entry.
	fs.rmSync(path.join(target, ".amber", "context", "events.jsonl"));
	const result = doctorMemoryRules(target);
	assert.ok(
		result.errors.some((e) => e.includes("no memory-ingest trail")),
		result.errors.join("\n"),
	);
	assert.equal(memoryStore.readEntry(target, entryId).status, "proposal");
	fs.rmSync(target, { recursive: true, force: true });
});

test("doctor rules 2+4: drift moves active → needs-re-review; re-book resets the surface hash", () => {
	const target = mkTarget();
	const payload = writePayload(
		target,
		"r4",
		requestFor("mreq-r4-1", [entryFor(target, "drift me")]),
	);
	run(target, "request", { payload });
	const entryId = run(target, "ingest", { request: "mreq-r4-1" }).result.entryIds[0];
	run(target, "approve", { entryId, decision: "approve" });
	run(target, "book", { entryId });
	assert.equal(memoryStore.readEntry(target, entryId).status, "active");

	fs.appendFileSync(path.join(target, "MEMORY.md"), "\n### human edit\n");
	const drifted = doctorMemoryRules(target);
	assert.ok(
		drifted.errors.some(
			(e) => /SURFACE_DRIFT|SOURCE_STALE/.test(e) && e.includes("needs-re-review"),
		),
		drifted.errors.join("\n"),
	);
	assert.equal(memoryStore.readEntry(target, entryId).status, "needs-re-review");

	const rebased = run(target, "book", { entryId });
	assert.equal(rebased.exitCode, 0, "§4.1: needs-re-review → active via re-book");
	assert.equal(memoryStore.readEntry(target, entryId).status, "active");
	fs.rmSync(target, { recursive: true, force: true });
});

test("doctor rule 7: booking without a prior approve flags ratification-class", () => {
	const target = mkTarget();
	const payload = writePayload(target, "r7", requestFor("mreq-r7-1", [entryFor(target, "ratify")]));
	run(target, "request", { payload });
	const entryId = run(target, "ingest", { request: "mreq-r7-1" }).result.entryIds[0];
	const booked = run(target, "book", { entryId });
	assert.equal(booked.exitCode, 0);
	assert.match(booked.result.warnings[0], /ratification-class/);
	const result = doctorMemoryRules(target);
	assert.ok(
		result.warnings.some((w) => w.includes("ratification-class")),
		result.warnings.join("\n"),
	);
	fs.rmSync(target, { recursive: true, force: true });
});

test("doctor rule 8: gitignored MEMORY.md is an acknowledged divergence with a remedy", () => {
	const target = mkTarget();
	fs.writeFileSync(path.join(target, ".gitignore"), "MEMORY.md\n");
	const payload = writePayload(
		target,
		"r8",
		requestFor("mreq-r8-1", [entryFor(target, "diverge")]),
	);
	run(target, "request", { payload });
	const result = doctorMemoryRules(target);
	assert.ok(
		result.warnings.some((w) => w.includes("acknowledged divergence") && w.includes("!")),
		result.warnings.join("\n"),
	);
	fs.rmSync(target, { recursive: true, force: true });
});

test("doctor rule 9: pack triplet divergence between memory-maintenance and bootstrap is an error", () => {
	const target = mkTarget();
	const packs = path.join(target, "workflow-packs");
	fs.mkdirSync(packs, { recursive: true });
	const triplet = (approvalPolicy) => ({
		approvalPolicy,
		loopLedger: { enabled: true },
		workspaceIsolation: { enabled: false },
	});
	fs.writeFileSync(
		path.join(packs, "memory-maintenance.pack.json"),
		JSON.stringify(triplet("human")),
	);
	fs.writeFileSync(
		path.join(packs, "safe-amber-bootstrap.pack.json"),
		JSON.stringify(triplet("system")),
	);
	const result = doctorMemoryRules(target);
	assert.ok(
		result.errors.some((e) => e.includes("approvalPolicy/loopLedger/workspaceIsolation")),
		result.errors.join("\n"),
	);
	fs.rmSync(target, { recursive: true, force: true });
});

test("governance report projects the memory nomination channel mix (§6.1)", () => {
	const target = mkTarget();
	const payload = writePayload(target, "mix", requestFor("mreq-mix-1", [entryFor(target, "mix")]));
	run(target, "request", { payload });
	const report = buildGovernanceReport(target);
	assert.equal(report.memoryChannelMix.totalRequests, 1);
	assert.equal(report.memoryChannelMix.automaticNominations, 1);
	assert.equal(report.memoryChannelMix.humanSharePct, 0);
	const { renderGovernanceReportMarkdown } = require("../../scripts/lib/core/governance-report");
	const text = renderGovernanceReportMarkdown(report);
	assert.match(text, /Memory Nomination Mix/);
	assert.match(text, /t1-writeback: 1/);
	fs.rmSync(target, { recursive: true, force: true });
});

// ── §8.1 CLI surface (real invocation, spec step 9) ─────────────────────────

test("doctor rules 3/6/10/11: pointers, forced review, git detection, abandoned stats", () => {
	const target = mkTarget();
	// Rule 3: dangling related pointer + unresolvable backref (best-effort warnings).
	const entry = entryFor(target, "pointer carrier");
	entry.entryId = memoryStore.computeEntryId(
		JSON.stringify({ claim: entry.claim, knowledgeKind: entry.knowledgeKind }),
	);
	entry.status = "active";
	entry.related = ["sha256:" + "c".repeat(64)];
	entry.provenance.sources[0].backref = "docs/gone.md";
	entry.bookedSurface = {
		path: "MEMORY.md",
		normHash: "sha256:" + "d".repeat(64),
		bookedAt: new Date().toISOString(),
	};
	memoryStore.writeEntry(target, entry);
	let result = doctorMemoryRules(target);
	assert.ok(
		result.warnings.some((w) => w.includes("related pointer") && w.includes("best-effort")),
		result.warnings.join("\n"),
	);
	assert.ok(
		result.warnings.some((w) => w.includes("backref docs/gone.md")),
		result.warnings.join("\n"),
	);

	// Retired rule 6: a half-full alpha budget no longer forces a review.
	const fat = ["# Memory", "", "## Entries", ""];
	for (let i = 0; i < 25; i += 1) fat.push(`### forced-review entry ${i}`);
	fs.writeFileSync(path.join(target, "MEMORY.md"), fat.join("\n") + "\n");
	result = doctorMemoryRules(target);
	assert.equal(
		result.warnings.some((w) => w.includes("forced review")),
		false,
		`F086 retired the 50% review trigger: ${result.warnings.join("\n")}`,
	);

	// Rule 10: booked surface outside a git working tree (non-blocking).
	fs.rmSync(path.join(target, ".git"), { recursive: true, force: true });
	result = doctorMemoryRules(target);
	assert.ok(
		result.warnings.some((w) => w.includes("not a git working tree")),
		result.warnings.join("\n"),
	);

	// Rule 11: abandoned entries surface as a statistics-only warning.
	entry.status = "abandoned";
	memoryStore.writeEntry(target, entry);
	result = doctorMemoryRules(target);
	assert.ok(
		result.warnings.some((w) => w.includes("abandoned") && w.includes("statistics only")),
		result.warnings.join("\n"),
	);
	fs.rmSync(target, { recursive: true, force: true });
});

test("β pointer may supersede a needs-re-review entry (§4.1 edge)", () => {
	const target = mkTarget();
	const first = writePayload(target, "b1", requestFor("mreq-b1", [entryFor(target, "stale old")]));
	run(target, "request", { payload: first });
	const oldId = run(target, "ingest", { request: "mreq-b1" }).result.entryIds[0];
	run(target, "approve", { entryId: oldId, decision: "approve" });
	run(target, "book", { entryId: oldId });
	fs.appendFileSync(path.join(target, "MEMORY.md"), "drift\n");
	const drifted = doctorMemoryRules(target);
	assert.equal(memoryStore.readEntry(target, oldId).status, "needs-re-review");
	assert.equal(drifted.errors.length > 0, true);

	const second = writePayload(
		target,
		"b2",
		requestFor("mreq-b2", [entryFor(target, "replacement", { supersedeTarget: oldId })]),
	);
	run(target, "request", { payload: second });
	const newId = run(target, "ingest", { request: "mreq-b2" }).result.entryIds[0];
	const approve = run(target, "approve", { entryId: newId, decision: "approve" });
	assert.equal(approve.exitCode, 0, "supersedeTarget accepts needs-re-review targets");
	assert.equal(memoryStore.readEntry(target, oldId).status, "superseded");
	fs.rmSync(target, { recursive: true, force: true });
});

test("ratification track: book --ratify --claim creates an active entry directly, γ-free", () => {
	const target = mkTarget();
	fs.appendFileSync(path.join(target, "MEMORY.md"), "\n### prefer explicit --target over cwd\n");

	const ratified = run(target, "book", {
		ratify: true,
		claim: "prefer explicit --target over cwd",
	});
	assert.equal(ratified.exitCode, 0, JSON.stringify(ratified.result));
	assert.equal(ratified.result.origin, "human-direct-ratification");
	const entryId = ratified.result.entryId;
	assert.match(entryId, /^sha256:[0-9a-f]{64}$/);

	const entry = memoryStore.readEntry(target, entryId);
	assert.equal(entry.status, "active");
	assert.equal(entry.origin, "human-direct-ratification");
	assert.equal(entry.knowledgeKind, "unspecified");
	const source = entry.provenance.sources[0];
	assert.equal(source.kind, "surface");
	assert.match(source.rawHash, /^sha256:[0-9a-f]{64}$/);
	assert.match(source.normHash, /^sha256:[0-9a-f]{64}$/);

	const bookEvent = events(target).find((e) => e.kind === "memory-book");
	assert.equal(bookEvent.origin, "human-direct-ratification");
	assert.equal(bookEvent.requestId, undefined, "§9: the ratification track carries no requestId");
	assert.deepEqual(bookEvent.entryIds, [entryId]);

	// No ingest ran, so the projection has no entry counts from admission.
	const status = run(target, "status");
	assert.equal(status.result.entries.proposal, 0);

	// Missing claim is refused; a duplicate claim is idempotent-refused.
	const noClaim = run(target, "book", { ratify: true });
	assert.equal(noClaim.exitCode, 1);
	assert.equal(noClaim.result.code, "AMBER_E_MEMORY_STATE_INVALID");
	const dup = run(target, "book", { ratify: true, claim: "prefer explicit --target over cwd" });
	assert.equal(dup.exitCode, 1, "already registered entry must not be re-created");
	fs.rmSync(target, { recursive: true, force: true });
});

test("surface size no longer gates admission, and supersession still pairs atomically", () => {
	const target = mkTarget();
	// Book one active entry first (the pair target).
	const first = writePayload(
		target,
		"pair-a",
		requestFor("mreq-pair-a", [entryFor(target, "pair old")]),
	);
	run(target, "request", { payload: first });
	const oldId = run(target, "ingest", { request: "mreq-pair-a" }).result.entryIds[0];
	run(target, "approve", { entryId: oldId, decision: "approve" });
	run(target, "book", { entryId: oldId });

	// Fill the surface past the retired entry ceiling (50 entries physically).
	const fat = ["# Memory", "", "## Entries", ""];
	for (let i = 0; i < 50; i += 1) fat.push(`### filler ${i}`);
	fs.writeFileSync(path.join(target, "MEMORY.md"), fat.join("\n") + "\n");

	// A bare new entry is admitted: the ceiling is retired.
	const bare = writePayload(
		target,
		"pair-b",
		requestFor("mreq-pair-b", [entryFor(target, "pair bare")]),
	);
	run(target, "request", { payload: bare });
	const bareIngest = run(target, "ingest", { request: "mreq-pair-b" });
	assert.equal(bareIngest.exitCode, 0, JSON.stringify(bareIngest.result));
	assert.equal(bareIngest.result.code, undefined);

	// A superseding entry is admitted and keeps its proposal state, so the
	// replacement pair is still available without any budget arithmetic.
	const pair = writePayload(
		target,
		"pair-c",
		requestFor("mreq-pair-c", [entryFor(target, "pair new", { supersedeTarget: oldId })]),
	);
	run(target, "request", { payload: pair });
	const pairIngest = run(target, "ingest", { request: "mreq-pair-c" });
	assert.equal(pairIngest.exitCode, 0, JSON.stringify(pairIngest.result));
	assert.equal(memoryStore.readEntry(target, pairIngest.result.entryIds[0]).status, "proposal");
	fs.rmSync(target, { recursive: true, force: true });
});

test("excerpt sources must carry a valid excerptHash seal at ingest", () => {
	const target = mkTarget();
	const { sha256 } = require("../../scripts/lib/core/context-hash");
	const excerpt = "session-log: operator confirmed prefer --target explicitly";
	const payload = writePayload(target, "exc", {
		channel: "human-escape-hatch",
		entries: [
			{
				schemaVersion: "1.0.0",
				claim: "prefer explicit --target over cwd",
				knowledgeKind: "pattern",
				targetSurface: "MEMORY.md",
				provenance: {
					sources: [
						{
							kind: "excerpt",
							ref: "manual",
							rawHash: sha256(excerpt),
							mutable: false,
							excerpt,
							excerptHash: sha256("tampered"),
						},
					],
				},
			},
		],
	});
	const ingest = run(target, "ingest", { payload });
	assert.equal(ingest.exitCode, 1);
	assert.equal(ingest.result.code, "AMBER_E_MEMORY_BINDING_MISMATCH");
	assert.match(ingest.result.errors[0], /excerptHash seal/);
	fs.rmSync(target, { recursive: true, force: true });
});

test("derivedFrom inherits the parent's rejection count across the lineage", () => {
	const target = mkTarget();
	const parent = writePayload(
		target,
		"lin-1",
		requestFor("mreq-lin-1", [entryFor(target, "lineage entry")]),
	);
	run(target, "request", { payload: parent });
	fs.appendFileSync(path.join(target, "MEMORY.md"), "drift\n");
	for (let i = 0; i < 2; i += 1) {
		const rejected = run(target, "ingest", { request: "mreq-lin-1" });
		assert.equal(rejected.exitCode, 1);
	}

	// Revised content = new entryId; a new request derives from the parent and
	// starts at rejectionCount 2 — the third strike abandons the lineage.
	const child = writePayload(target, "lin-2", {
		...requestFor("mreq-lin-2", [entryFor(target, "lineage entry revised")]),
		provenance: { channel: "human-escape-hatch", derivedFrom: "mreq-lin-1" },
	});
	run(target, "request", { payload: child });
	const childRequest = memoryStore.readRequests(target).find((r) => r.requestId === "mreq-lin-2");
	assert.equal(childRequest.rejectionCount, 2, "F2: the lineage count is inherited, not reset");

	// Drift again so the child's own ingest fails binding — the inherited
	// count makes this the third strike on the lineage.
	fs.appendFileSync(path.join(target, "MEMORY.md"), "drift-2" + String.fromCharCode(10));

	const third = run(target, "ingest", { request: "mreq-lin-2" });
	assert.equal(third.exitCode, 1);
	const auto = events(target)
		.filter((e) => e.kind === "memory-abandon")
		.pop();
	assert.equal(auto.triggerSource, "auto-threshold");
	assert.equal(auto.targetId, "mreq-lin-2");
	fs.rmSync(target, { recursive: true, force: true });
});

test("ingest rejects malformed --payload JSON with a coded error", () => {
	const target = mkTarget();
	fs.writeFileSync(path.join(target, "broken.json"), "{ not json ");
	const ingest = run(target, "ingest", { payload: "broken.json" });
	assert.equal(ingest.exitCode, 1);
	assert.equal(ingest.result.code, "AMBER_E_MEMORY_REQUEST_SCHEMA_INVALID");
	fs.rmSync(target, { recursive: true, force: true });
});

test("request and ingest refuse memory payloads outside the target, including symlinks", () => {
	const target = mkTarget();
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "amber-memory-payload-outside-"));
	const body = requestFor("mreq-path-boundary", [entryFor(target, "path boundary")]);
	const outsidePayload = path.join(outside, "payload.json");
	fs.writeFileSync(outsidePayload, JSON.stringify(body));
	const symlinkPayload = path.join(target, "payload-link.json");
	try {
		for (const payload of [
			path.join("..", path.basename(outside), "payload.json"),
			outsidePayload,
		]) {
			for (const verb of ["request", "ingest"]) {
				const result = run(target, verb, { payload });
				assert.equal(result.exitCode, 1, `${verb} should refuse ${payload}`);
				assert.equal(result.result.code, "AMBER_E_MEMORY_REQUEST_NOT_FOUND");
				assert.match(result.result.errors.join("\n"), /outside the target root/i);
			}
		}
		fs.symlinkSync(outsidePayload, symlinkPayload);
		for (const verb of ["request", "ingest"]) {
			const result = run(target, verb, { payload: "payload-link.json" });
			assert.equal(result.exitCode, 1, `${verb} should refuse symlink payload`);
			assert.equal(result.result.code, "AMBER_E_MEMORY_REQUEST_NOT_FOUND");
			assert.match(result.result.errors.join("\n"), /outside the target root/i);
		}
		assert.equal(fs.readFileSync(outsidePayload, "utf8"), JSON.stringify(body));
	} finally {
		fs.rmSync(target, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("doctor rules 4/8 fire for surface-only targets with no .amber/memory", () => {
	const target = mkTarget();
	// No registry use at all — human entries sit on MEMORY.md unratified.
	fs.appendFileSync(path.join(target, "MEMORY.md"), "\n### orphan human entry\n");
	fs.writeFileSync(path.join(target, ".gitignore"), "MEMORY.md\n");
	const result = doctorMemoryRules(target);
	assert.ok(
		result.warnings.some(
			(w) => w.includes("no registry entry is bound") && w.includes("--ratify --claim"),
		),
		result.warnings.join("\n"),
	);
	assert.ok(
		result.warnings.some((w) => w.includes("acknowledged divergence")),
		result.warnings.join("\n"),
	);
	fs.rmSync(target, { recursive: true, force: true });
});

test("approve output carries the full verbatim creed including the closing rule", () => {
	const target = mkTarget();
	const payload = writePayload(
		target,
		"creed",
		requestFor("mreq-creed-1", [entryFor(target, "creed entry")]),
	);
	run(target, "request", { payload });
	const entryId = run(target, "ingest", { request: "mreq-creed-1" }).result.entryIds[0];
	const approve = run(target, "approve", { entryId, decision: "approve" });
	assert.match(approve.result.text, /Every entry must change a future decision or be deleted\./);
	assert.match(approve.result.text, /capability, not ceremony/);
	assert.match(approve.result.text, /notes\.md owns that for the current session/);
	fs.rmSync(target, { recursive: true, force: true });
});

test("payload ingest honors a closed-set signal and --ratify/--entry-id are mutually exclusive", () => {
	const target = mkTarget();
	// Signal-required channel via the direct payload path with a valid signal.
	const ok = writePayload(target, "sig-ok", {
		channel: "distill-conversion",
		provenance: { channel: "distill-conversion", signal: "distill-count" },
		entries: [entryFor(target, "signal via payload")],
	});
	const admitted = run(target, "ingest", { payload: ok });
	assert.equal(admitted.exitCode, 0, JSON.stringify(admitted.result));
	assert.equal(admitted.result.outcome, "admitted");

	// --ratify and --entry-id are mutually exclusive.
	const both = run(target, "book", {
		ratify: true,
		entryId: admitted.result.entryIds[0],
		claim: "x",
	});
	assert.equal(both.exitCode, 1);
	assert.equal(both.result.code, "AMBER_E_MEMORY_STATE_INVALID");
	assert.match(both.result.errors[0], /mutually exclusive/);
	fs.rmSync(target, { recursive: true, force: true });
});

test("amber memory status --json round-trips through the real CLI", () => {
	const target = mkTarget();
	const result = spawnSync(
		process.execPath,
		[path.join(ROOT, "scripts", "amber.js"), "memory", "status", "--target", target, "--json"],
		{ cwd: ROOT, encoding: "utf-8" },
	);
	assert.equal(result.status, 0, result.stderr);
	const parsed = JSON.parse(result.stdout);
	assert.equal(parsed.entries.active, 0);
	assert.equal(parsed.alpha, undefined, "F086 retired the alpha projection");
	assert.equal(parsed.gamma, undefined, "F089 retired the gamma projection");
	assert.ok(Number.isInteger(parsed.surface.bytes));
	fs.rmSync(target, { recursive: true, force: true });
});
