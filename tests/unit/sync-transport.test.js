"use strict";

// F041 Slice 1 (red-first): the AMBER_E_SYNC_TRANSPORT_* catalog family and the
// transport approval primitive — a hash-chained `approved` record on
// .amber/sync/transport/ledger.jsonl that is consumable exactly once via
// latestUnconsumedApproval (loop-ledger shape, ADR-0020 Stage A).

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync, spawnSync } = require("node:child_process");

const { CATALOG } = require("../../scripts/lib/core/error-catalog");
const {
	approveTransport,
	executeTransport,
	transportLedgerPath,
} = require("../../scripts/lib/core/sync-transport");
const {
	readLedger,
	verifyLedgerChain,
	latestUnconsumedApproval,
} = require("../../scripts/lib/core/loop-ledger");

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-transport-${label}-`));
}

function mkRepo(label) {
	const dir = mkTarget(label);
	execSync("git init", { cwd: dir, encoding: "utf8" });
	execSync('git config user.email "t@example.com"', { cwd: dir, encoding: "utf8" });
	execSync('git config user.name "T"', { cwd: dir, encoding: "utf8" });
	return dir;
}

function git(dir, args) {
	const res = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	assert.equal(res.status, 0, (res.stderr || "").toString());
	return (res.stdout || "").trim();
}

function seedEnvelope(dir) {
	fs.mkdirSync(path.join(dir, ".amber", "context", "pages"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".amber", "context", "pages", "page.json"), "# Page\n");
	const { packEnvelope } = require("../../scripts/lib/core/sync-remote");
	const { envelope, errors } = packEnvelope(dir, "context-page", ".amber/context/pages/page.json");
	assert.deepEqual(errors, []);
	return envelope;
}

function writeRules(dir, rules) {
	fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "governance", "rules.json"),
		JSON.stringify(rules, null, 2),
	);
}

function allowTransportRules() {
	return {
		schemaVersion: 1,
		defaultAction: "deny",
		rules: [
			{
				id: "allow-sync-transport-add",
				action: "allow",
				match: "prefix",
				pattern: "git add .amber/sync/",
			},
			{
				id: "allow-sync-transport-commit",
				action: "allow",
				match: "prefix",
				pattern: 'git commit -m "amber sync:',
			},
		],
	};
}

function lastRecord(dir) {
	const recs = readLedger(transportLedgerPath(dir));
	return recs[recs.length - 1];
}

const FAMILY = [
	"AMBER_E_SYNC_TRANSPORT_APPROVAL_REQUIRED",
	"AMBER_E_SYNC_TRANSPORT_NOT_APPROVED",
	"AMBER_E_SYNC_TRANSPORT_POLICY_REFUSED",
	"AMBER_E_SYNC_TRANSPORT_DIRTY_TREE",
	"AMBER_E_SYNC_TRANSPORT_COMMIT_FAILED",
];

for (const code of FAMILY) {
	test(`catalog defines ${code} with title/cause/remedy/layer`, () => {
		const entry = CATALOG[code];
		assert.ok(entry, `${code} present in the catalog`);
		for (const field of ["title", "cause", "remedy", "layer"]) {
			assert.equal(typeof entry[field], "string", `${code}.${field} must be a non-empty string`);
			assert.ok(entry[field].length > 0, `${code}.${field} must not be empty`);
		}
	});
}

test("transport ledger lives under .amber/sync/transport/", () => {
	const dir = mkTarget("path");
	const lp = transportLedgerPath(dir);
	assert.ok(lp.endsWith(path.join(".amber", "sync", "transport", "ledger.jsonl")), lp);
});

test("approveTransport appends a hash-chained approved record with reviewer + UUID approvalKey", () => {
	const dir = mkTarget("approve");
	const result = approveTransport({ target: dir, reviewer: "alice" });
	assert.deepEqual(result.errors, []);
	const lp = transportLedgerPath(dir);
	assert.ok(fs.existsSync(lp), "the transport ledger is created on approve");

	const records = readLedger(lp);
	assert.equal(records.length, 1);
	const record = records[0];
	assert.equal(record.kind, "approved");
	assert.equal(record.reviewer, "alice");
	assert.equal(record.executesAnything, false);
	assert.ok(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(record.approvalKey),
		"approvalKey is a UUID",
	);
	assert.equal(result.approvalKey, record.approvalKey);
	assert.equal(verifyLedgerChain(lp).intact, true, "the chain is intact");
});

test("approveTransport requires an explicit reviewer", () => {
	const dir = mkTarget("no-reviewer");
	const result = approveTransport({ target: dir });
	assert.ok(result.errors.length > 0, "missing reviewer is refused");
	assert.match(result.errors[0], /--reviewer/);
	assert.ok(!fs.existsSync(transportLedgerPath(dir)), "no ledger record is written on refusal");
});

test("approved records are single-use: consumed by an executed record referencing the approvalKey", () => {
	const dir = mkTarget("single-use");
	const a1 = approveTransport({ target: dir, reviewer: "alice" });
	const lp = transportLedgerPath(dir);
	assert.equal(latestUnconsumedApproval(readLedger(lp))?.approvalKey, a1.approvalKey);

	const { appendLedgerRecord } = require("../../scripts/lib/core/loop-ledger");
	appendLedgerRecord(lp, {
		schemaVersion: 2,
		kind: "executed",
		consumedApprovalKey: a1.approvalKey,
		executesAnything: true,
	});
	assert.equal(
		latestUnconsumedApproval(readLedger(lp)),
		null,
		"a consumed approval is never reusable",
	);
	assert.equal(verifyLedgerChain(lp).intact, true);
});

test("a second approve creates a fresh, independent approval record", () => {
	const dir = mkTarget("second-approve");
	const a1 = approveTransport({ target: dir, reviewer: "alice" });
	const a2 = approveTransport({ target: dir, reviewer: "bob" });
	assert.notEqual(a1.approvalKey, a2.approvalKey);
	const records = readLedger(transportLedgerPath(dir));
	assert.equal(records.length, 2);
	assert.equal(records[1].prevHash, records[0].hash, "the second record chains onto the first");
	assert.equal(verifyLedgerChain(transportLedgerPath(dir)).intact, true);
});

// ── Slice 2: executeTransport gate order (ADR-0020 Stage A) ──────────────────

test("no envelopes → typed no-change outcome, no approval or ledger needed", () => {
	const dir = mkRepo("nochange");
	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, false);
	assert.equal(r.outcome, "no-change");
	assert.deepEqual(r.errors, []);
	assert.ok(
		!fs.existsSync(transportLedgerPath(dir)),
		"a no-change outcome writes no ledger record",
	);
});

test("pending conflicts downgrade to preparation-only (exit-0 typed outcome, recorded)", () => {
	const dir = mkRepo("downgrade");
	seedEnvelope(dir);
	const { recordConflict } = require("../../scripts/lib/core/sync-conflicts");
	recordConflict(dir, {
		conflictType: "identity-mismatch",
		envelopeId: "env-test",
		artifactPath: ".amber/context/pages/page.json",
		detail: "seeded pending conflict",
	});
	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, false);
	assert.equal(r.outcome, "preparation-only");
	assert.deepEqual(r.errors, []);
	const rec = lastRecord(dir);
	assert.equal(rec.kind, "downgraded");
	assert.ok(rec.opsFingerprint, "the downgrade record carries the ops fingerprint");
	assert.equal(verifyLedgerChain(transportLedgerPath(dir)).intact, true);
});

test("identity gate: non-TTY without --yes fails closed (APPROVAL_REQUIRED)", () => {
	const dir = mkRepo("identity");
	seedEnvelope(dir);
	const r = executeTransport({ target: dir });
	assert.equal(r.executed, false);
	assert.equal(r.code, "AMBER_E_SYNC_TRANSPORT_APPROVAL_REQUIRED");
	assert.match(r.errors[0], /AMBER_E_SYNC_TRANSPORT_APPROVAL_REQUIRED/);
	assert.ok(!fs.existsSync(transportLedgerPath(dir)), "an identity-gate refusal records nothing");
});

test("approvalRequired envelope: TTY invocation without --yes gets the F019-shaped envelope", () => {
	const dir = mkRepo("envelope-shape");
	seedEnvelope(dir);
	const r = executeTransport({ target: dir, isTTY: true });
	assert.equal(r.approvalRequired, true);
	assert.equal(r.executed, false);
	assert.deepEqual(r.errors, []);
	assert.match(r.hint, /--yes/);
});

test("policy gate: missing rules.json refuses with a recorded denial", () => {
	const dir = mkRepo("policy-missing");
	seedEnvelope(dir);
	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, false);
	assert.equal(r.code, "AMBER_E_SYNC_TRANSPORT_POLICY_REFUSED");
	const rec = lastRecord(dir);
	assert.equal(rec.kind, "denied");
	assert.equal(rec.gate, "policy");
	assert.equal(rec.code, "AMBER_E_SYNC_TRANSPORT_POLICY_REFUSED");
});

test("policy gate: defaultAction=deny with no matching allow rule refuses", () => {
	const dir = mkRepo("policy-noallow");
	seedEnvelope(dir);
	writeRules(dir, {
		schemaVersion: 1,
		defaultAction: "deny",
		rules: [
			{
				id: "allow-unrelated",
				action: "allow",
				match: "prefix",
				pattern: "npm test",
			},
		],
	});
	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.code, "AMBER_E_SYNC_TRANSPORT_POLICY_REFUSED");
	assert.equal(lastRecord(dir).gate, "policy");
});

test("policy gate: an explicit deny rule beats the allow rules", () => {
	const dir = mkRepo("policy-deny");
	seedEnvelope(dir);
	const rules = allowTransportRules();
	rules.rules.push({
		id: "deny-sync-commit",
		action: "deny",
		match: "prefix",
		pattern: "git commit",
	});
	writeRules(dir, rules);
	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.code, "AMBER_E_SYNC_TRANSPORT_POLICY_REFUSED");
	const rec = lastRecord(dir);
	assert.equal(rec.gate, "policy");
	assert.match(rec.reason, /deny-sync-commit/);
});

test("approval gate: policy passes but no unconsumed approval → NOT_APPROVED (recorded)", () => {
	const dir = mkRepo("unapproved");
	seedEnvelope(dir);
	writeRules(dir, allowTransportRules());
	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, false);
	assert.equal(r.code, "AMBER_E_SYNC_TRANSPORT_NOT_APPROVED");
	const rec = lastRecord(dir);
	assert.equal(rec.kind, "denied");
	assert.equal(rec.gate, "approval");
});

test("confinement gate: a pre-staged index refuses (DIRTY_TREE) and keeps the approval unconsumed", () => {
	const dir = mkRepo("dirty");
	seedEnvelope(dir);
	writeRules(dir, allowTransportRules());
	approveTransport({ target: dir, reviewer: "alice" });
	fs.writeFileSync(path.join(dir, "outside.txt"), "staged by someone else\n");
	git(dir, ["add", "outside.txt"]);

	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, false);
	assert.equal(r.code, "AMBER_E_SYNC_TRANSPORT_DIRTY_TREE");
	const rec = lastRecord(dir);
	assert.equal(rec.kind, "denied");
	assert.equal(rec.gate, "confinement");
	assert.match(rec.reason, /outside\.txt/);
	assert.notEqual(
		latestUnconsumedApproval(readLedger(transportLedgerPath(dir))),
		null,
		"a confinement refusal must not consume the approval",
	);
});

test("confinement gate: symlinked envelopes dir resolving outside the repo refuses", () => {
	const dir = mkRepo("symlink-dir");
	seedEnvelope(dir);
	const envDir = path.join(dir, ".amber", "sync", "envelopes");
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "amber-outside-"));
	fs.renameSync(envDir, path.join(outside, "envelopes"));
	fs.symlinkSync(
		path.join(outside, "envelopes"),
		envDir,
		process.platform === "win32" ? "junction" : "dir",
	);
	writeRules(dir, allowTransportRules());
	approveTransport({ target: dir, reviewer: "alice" });

	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, false);
	assert.equal(r.code, "AMBER_E_SYNC_TRANSPORT_DIRTY_TREE");
	const rec = lastRecord(dir);
	assert.equal(rec.gate, "confinement");
	assert.match(rec.reason, /outside|envelopes/);
});

test("a tampered transport ledger refuses execution without appending", () => {
	const dir = mkRepo("tamper");
	seedEnvelope(dir);
	writeRules(dir, allowTransportRules());
	approveTransport({ target: dir, reviewer: "alice" });
	const lp = transportLedgerPath(dir);
	const lines = fs.readFileSync(lp, "utf8").trim().split("\n");
	const r0 = JSON.parse(lines[0]);
	r0.reviewer = "mallory";
	lines[0] = JSON.stringify(r0);
	fs.writeFileSync(lp, lines.join("\n") + "\n");

	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, false);
	assert.equal(r.code, "AMBER_E_LEDGER_TAMPERED");
	assert.equal(readLedger(lp).length, 1, "nothing is appended onto a tampered chain");
});

// ── Slice 3: governed execution (add + commit, never push) ───────────────────

test("execution: stages envelopes + decision record, commits with the derived message, records sha, consumes approval", () => {
	const dir = mkRepo("execute");
	const envelope = seedEnvelope(dir);
	writeRules(dir, allowTransportRules());
	const approval = approveTransport({ target: dir, reviewer: "alice" });

	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, true);
	assert.ok(r.commitSha, "the commit sha is returned");
	assert.equal(git(dir, ["rev-parse", "HEAD"]), r.commitSha);
	assert.equal(git(dir, ["log", "-1", "--pretty=%s"]), "amber sync: 1 envelope(s)");

	const committed = git(dir, ["show", "--name-only", "--pretty=format:", "HEAD"])
		.split(/\r?\n/)
		.filter(Boolean);
	assert.ok(
		committed.some((f) => f.startsWith(".amber/sync/envelopes/") && f.endsWith(".json")),
		"the envelope is committed",
	);
	assert.ok(
		committed.some((f) => f.startsWith(".amber/sync/transport/decisions/") && f.endsWith(".json")),
		"the decision record is committed alongside the envelopes",
	);
	assert.ok(
		!committed.some((f) => f.endsWith("ledger.jsonl")),
		"the transport ledger is never staged",
	);

	const rec = lastRecord(dir);
	assert.equal(rec.kind, "executed");
	assert.equal(rec.consumedApprovalKey, approval.approvalKey);
	assert.equal(rec.commitSha, r.commitSha);
	assert.equal(rec.executesAnything, true);
	assert.equal(rec.stopReason, "completed");
	assert.equal(verifyLedgerChain(transportLedgerPath(dir)).intact, true);

	const decisionsDir = path.join(dir, ".amber", "sync", "transport", "decisions");
	const decisionFiles = fs.readdirSync(decisionsDir);
	assert.equal(decisionFiles.length, 1);
	const decision = JSON.parse(fs.readFileSync(path.join(decisionsDir, decisionFiles[0]), "utf8"));
	assert.equal(decision.kind, "transport-decision");
	assert.equal(decision.approvalKey, approval.approvalKey);
	assert.ok(decision.batchId);
	assert.deepEqual(decision.envelopeIds, [envelope.envelopeId]);
	assert.ok(decision.opsFingerprint);
});

test("the approval is single-use: a second execute without a new approval is NOT_APPROVED", () => {
	const dir = mkRepo("single-use-exec");
	seedEnvelope(dir);
	writeRules(dir, allowTransportRules());
	approveTransport({ target: dir, reviewer: "alice" });
	const first = executeTransport({ target: dir, yes: true });
	assert.equal(first.executed, true);

	const second = executeTransport({ target: dir, yes: true });
	assert.equal(second.executed, false);
	assert.equal(second.code, "AMBER_E_SYNC_TRANSPORT_NOT_APPROVED");
});

test("retry after success with a fresh approval is a typed nothing-to-commit outcome", () => {
	const dir = mkRepo("idempotent");
	seedEnvelope(dir);
	writeRules(dir, allowTransportRules());
	approveTransport({ target: dir, reviewer: "alice" });
	const first = executeTransport({ target: dir, yes: true });
	assert.equal(first.executed, true);
	const headAfterFirst = git(dir, ["rev-parse", "HEAD"]);

	approveTransport({ target: dir, reviewer: "alice" });
	const retry = executeTransport({ target: dir, yes: true });
	assert.equal(retry.executed, false);
	assert.equal(retry.outcome, "nothing-to-commit");
	assert.deepEqual(retry.errors, []);
	assert.equal(
		git(dir, ["rev-parse", "HEAD"]),
		headAfterFirst,
		"no duplicate empty commit is created",
	);
});

test("a git failure is COMMIT_FAILED with captured stderr, recorded, and the approval is consumed", () => {
	const dir = mkRepo("commit-failed");
	seedEnvelope(dir);
	writeRules(dir, allowTransportRules());
	approveTransport({ target: dir, reviewer: "alice" });
	// A stale index lock makes every index write fail deterministically.
	fs.writeFileSync(path.join(dir, ".git", "index.lock"), "");

	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, false);
	assert.equal(r.code, "AMBER_E_SYNC_TRANSPORT_COMMIT_FAILED");
	assert.match(r.errors[0], /AMBER_E_SYNC_TRANSPORT_COMMIT_FAILED/);
	const rec = lastRecord(dir);
	assert.equal(rec.kind, "executed");
	assert.match(rec.action.stderr, /index\.lock/);
	assert.equal(
		latestUnconsumedApproval(readLedger(transportLedgerPath(dir))),
		null,
		"one approval = one execution attempt, even a failed one",
	);
});

// ── Slice 4: adversarial confinement ─────────────────────────────────────────

test("adversarial: a pre-staged file INSIDE .amber/sync refuses (the whole index commits)", () => {
	const dir = mkRepo("dirty-inside");
	seedEnvelope(dir);
	writeRules(dir, allowTransportRules());
	approveTransport({ target: dir, reviewer: "alice" });
	fs.writeFileSync(path.join(dir, ".amber", "sync", "hand-staged.txt"), "staged by hand\n");
	git(dir, ["add", ".amber/sync/hand-staged.txt"]);

	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, false);
	assert.equal(r.code, "AMBER_E_SYNC_TRANSPORT_DIRTY_TREE");
	assert.match(lastRecord(dir).reason, /hand-staged\.txt/);
});

test("adversarial: a symlinked FILE inside envelopes resolving outside the repo refuses", () => {
	const dir = mkRepo("symlink-file");
	const envelope = seedEnvelope(dir);
	const envDir = path.join(dir, ".amber", "sync", "envelopes");
	const envFile = path.join(envDir, `${envelope.envelopeId}.json`);
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "amber-outside-file-"));
	fs.renameSync(envFile, path.join(outside, "stolen.json"));
	fs.symlinkSync(
		path.join(outside, "stolen.json"),
		envFile,
		process.platform === "win32" ? "file" : "file",
	);
	writeRules(dir, allowTransportRules());
	approveTransport({ target: dir, reviewer: "alice" });

	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, false);
	assert.equal(r.code, "AMBER_E_SYNC_TRANSPORT_DIRTY_TREE");
	assert.equal(lastRecord(dir).gate, "confinement");
});

test("adversarial: a dirty working tree OUTSIDE .amber/sync does NOT block (nothing can be swept)", () => {
	const dir = mkRepo("dirty-outside");
	git(dir, ["commit", "--allow-empty", "-m", "baseline"]);
	seedEnvelope(dir);
	writeRules(dir, allowTransportRules());
	approveTransport({ target: dir, reviewer: "alice" });
	fs.writeFileSync(path.join(dir, "notes-draft.txt"), "unstaged working-tree change\n");

	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, true, "unstaged outside changes cannot ride the pathspec add");
	const committed = git(dir, ["show", "--name-only", "--pretty=format:", "HEAD"])
		.split(/\r?\n/)
		.filter(Boolean);
	assert.ok(!committed.includes("notes-draft.txt"), "the outside change is not swept");
	assert.ok(!committed.some((f) => f.endsWith("ledger.jsonl")), "the ledger is not swept");
});

test("adversarial: the transport ledger itself is never staged by execution", () => {
	const dir = mkRepo("ledger-never-staged");
	git(dir, ["commit", "--allow-empty", "-m", "baseline"]);
	seedEnvelope(dir);
	writeRules(dir, allowTransportRules());
	approveTransport({ target: dir, reviewer: "alice" });
	// A second approval grows the ledger to two records before executing.
	approveTransport({ target: dir, reviewer: "bob" });

	const r = executeTransport({ target: dir, yes: true });
	assert.equal(r.executed, true);
	const committed = git(dir, ["show", "--name-only", "--pretty=format:", "HEAD"])
		.split(/\r?\n/)
		.filter(Boolean);
	assert.ok(
		!committed.some((f) => f.startsWith(".amber/sync/transport/ledger")),
		"ledger.jsonl is local evidence, never transport cargo",
	);
	assert.ok(
		committed.some((f) => f.startsWith(".amber/sync/transport/decisions/")),
		"the decision record is the only transport/ file committed",
	);
});
