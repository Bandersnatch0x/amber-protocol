"use strict";

// F050 ticket 3 (#228) — public CLI seam coverage for Gate evaluation:
// `amber gate evaluate/show/list`, always asserted through the JSON result
// envelope with the stable code. Gates are admitted through the existing
// `artifact admit --type gate` surface (the contract rides the extensions
// carrier), so this suite exercises that admission end-to-end too. The
// fail-closed spine of the ticket: evaluation is deterministic and
// fail-closed, a fail verdict is a completed evaluation (exit 0, outcome
// appended — never silently dropped), and the legacy plan gate keeps its
// bare `amber gate --plan` behavior unchanged.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "amber.js");

function runCli(args, cwd) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

function mkTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-cli-f050t3-${label}-`));
}

function payload(r) {
	const outer = JSON.parse(r.stdout);
	return outer.text ? JSON.parse(outer.text) : outer;
}

function envelope(r) {
	return JSON.parse(r.stdout);
}

function outcomeLedgerPath(dir) {
	return path.join(dir, ".amber", "gates", "outcomes.jsonl");
}

function seedPrincipals(dir) {
	const alice = runCli(
		[
			"principal",
			"register",
			"--id",
			"alice@example.com",
			"--kind",
			"human",
			"--role",
			"reviewer",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(alice.status, 0, alice.stderr);
	const bot = runCli(
		["principal", "register", "--id", "ci-bot", "--kind", "service", "--target", dir, "--json"],
		dir,
	);
	assert.equal(bot.status, 0, bot.stderr);
}

function recordEvidence(dir, id, extra = []) {
	const r = runCli(
		[
			"evidence",
			"record",
			"--id",
			id,
			"--producer",
			"ci-bot",
			"--assurance",
			"observed",
			"--subject",
			"spec/login@2",
			"--status",
			"pass",
			"--outputs",
			"87",
			...extra,
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
}

function admitGate(dir, extensions) {
	const r = runCli(
		[
			"artifact",
			"admit",
			"--type",
			"gate",
			"--id",
			"gate/login-gate",
			"--body",
			"# Gate: login readiness",
			...extensions.flatMap((extension) => ["--extension", extension]),
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(r.status, 0, r.stderr);
	return payload(r);
}

function evaluateGateCli(dir, extra = []) {
	return runCli(
		[
			"gate",
			"evaluate",
			"--gate",
			"gate/login-gate",
			"--subject",
			"spec/login@2",
			...extra,
			"--target",
			dir,
			"--json",
		],
		dir,
	);
}

// ── evaluate / show / list round-trip ──

test("evaluate appends an immutable pass outcome; show and list round-trip it", () => {
	const dir = mkTarget("round-trip");
	seedPrincipals(dir);
	recordEvidence(dir, "evidence/run-42");
	admitGate(dir, [
		'gate.require=[{"evidenceType":"spec/login@2","assurance":"observed","threshold":{"value":80,"comparator":"ge"}}]',
	]);

	const r = evaluateGateCli(dir);
	assert.equal(r.status, 0, r.stderr);
	const outcome = payload(r);
	assert.equal(outcome.kind, "evaluated");
	assert.equal(outcome.verdict, "pass");
	assert.equal(outcome.gate, "gate/login-gate");
	assert.equal(outcome.gateRevision, 1);
	assert.equal(outcome.subject, "spec/login@2");
	assert.equal(outcome.clockSource, "system");
	assert.equal(outcome.skewPolicy, "no-tolerance");
	assert.equal(outcome.index, 0);
	const requirement = outcome.details.requirements[0];
	assert.equal(requirement.satisfied, true);
	assert.equal(requirement.evidenceId, "evidence/run-42");
	assert.equal(requirement.effectiveAssurance, "observed");
	assert.deepEqual(requirement.threshold, { value: 80, comparator: "ge", actual: 87 });
	assert.equal(outcome.details.anyOf.length, 0);
	assert.match(outcome.gateContentHash, /^sha256:[0-9a-f]{64}$/);
	assert.match(outcome.hash, /^[0-9a-f]{64}$/);

	const byIndex = payload(runCli(["gate", "show", "--index", "0", "--target", dir, "--json"], dir));
	assert.equal(byIndex.verdict, "pass");
	const byGate = payload(
		runCli(["gate", "show", "--gate", "gate/login-gate", "--target", dir, "--json"], dir),
	);
	assert.equal(byGate.index, 0);

	const list = payload(runCli(["gate", "list", "--target", dir, "--json"], dir));
	assert.equal(list.length, 1);
	assert.equal(list[0].verdict, "pass");
	const failed = payload(
		runCli(["gate", "list", "--verdict", "fail", "--target", dir, "--json"], dir),
	);
	assert.equal(failed.length, 0);
});

test("a second evaluation appends a NEW outcome — history is never rewritten", () => {
	const dir = mkTarget("immutable");
	seedPrincipals(dir);
	recordEvidence(dir, "evidence/run-42");
	admitGate(dir, ['gate.require=[{"evidenceType":"spec/login@2","assurance":"observed"}]']);

	const first = evaluateGateCli(dir);
	assert.equal(first.status, 0, first.stderr);
	assert.equal(payload(first).index, 0);

	const second = evaluateGateCli(dir, ["--now", "2027-06-01T00:00:00.000Z"]);
	assert.equal(second.status, 0, second.stderr);
	const outcome = payload(second);
	assert.equal(outcome.index, 1);
	assert.equal(outcome.clockSource, "injected");
	assert.notEqual(outcome.at, payload(first).at);

	const list = payload(runCli(["gate", "list", "--target", dir, "--json"], dir));
	assert.equal(list.length, 2);
	assert.deepEqual(
		list.map((record) => record.index),
		[0, 1],
	);
});

// ── A fail verdict is a completed evaluation, not a command error ──

test("a fail verdict exits 0 with the outcome appended; verification promotes it to pass", () => {
	const dir = mkTarget("fail-verdict");
	seedPrincipals(dir);
	recordEvidence(dir, "evidence/run-42");
	admitGate(dir, ['gate.require=[{"evidenceType":"spec/login@2","assurance":"verified"}]']);

	const before = evaluateGateCli(dir);
	assert.equal(before.status, 0, before.stderr);
	const failed = payload(before);
	assert.equal(failed.verdict, "fail");
	assert.equal(failed.details.requirements[0].satisfied, false);
	assert.equal(failed.details.requirements[0].effectiveAssurance, "observed");

	const verify = runCli(
		[
			"evidence",
			"verify",
			"--id",
			"evidence/run-42",
			"--verifier",
			"alice@example.com",
			"--target",
			dir,
			"--json",
		],
		dir,
	);
	assert.equal(verify.status, 0, verify.stderr);

	const after = evaluateGateCli(dir);
	assert.equal(after.status, 0, after.stderr);
	assert.equal(payload(after).verdict, "pass");
	assert.equal(payload(after).details.requirements[0].effectiveAssurance, "verified");
});

// ── Fail-closed refusals (the gate never runs) ──

test("an unknown gate fails closed with the not-found code", () => {
	const dir = mkTarget("unknown-gate");
	seedPrincipals(dir);
	const r = evaluateGateCli(dir);
	assert.equal(r.status, 1);
	assert.equal(envelope(r).code, "AMBER_E_GATE_NOT_FOUND");
});

test("a malformed contract fails closed before any outcome is appended", () => {
	const dir = mkTarget("invalid-contract");
	seedPrincipals(dir);
	recordEvidence(dir, "evidence/run-42");
	admitGate(dir, ["gate.maxEvidenceAgeMs=3600000"]);

	const r = evaluateGateCli(dir);
	assert.equal(r.status, 1);
	assert.equal(envelope(r).code, "AMBER_E_GATE_CONTRACT_INVALID");
	assert.ok(!fs.existsSync(outcomeLedgerPath(dir)), "nothing was appended");
});

test("an expired gate refuses to run and appends nothing", () => {
	const dir = mkTarget("expired-gate");
	seedPrincipals(dir);
	recordEvidence(dir, "evidence/run-42");
	admitGate(dir, [
		'gate.require=[{"evidenceType":"spec/login@2","assurance":"observed"}]',
		"gate.expires=2026-01-01T00:00:00.000Z",
	]);

	const r = evaluateGateCli(dir);
	assert.equal(r.status, 1);
	assert.equal(envelope(r).code, "AMBER_E_GATE_EXPIRED");
	assert.ok(!fs.existsSync(outcomeLedgerPath(dir)), "nothing was appended");
});

test("a truncated value flag fails closed as an argument error", () => {
	const dir = mkTarget("truncated-flag");
	seedPrincipals(dir);
	// --target is the LAST token: it parses to undefined (a truncated
	// invocation), which the command seam fails closed — --json stays
	// visible to the parser so the verdict arrives as a JSON envelope.
	const r = runCli(
		[
			"gate",
			"evaluate",
			"--gate",
			"gate/login-gate",
			"--subject",
			"spec/login@2",
			"--json",
			"--target",
		],
		dir,
	);
	assert.equal(r.status, 1);
	assert.equal(envelope(r).code, "AMBER_E_INVALID_ARG");
});

test("show without --index or --gate names the required key", () => {
	const dir = mkTarget("show-no-key");
	seedPrincipals(dir);
	const r = runCli(["gate", "show", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
	assert.equal(envelope(r).code, "AMBER_E_INVALID_ARG");
});

test("show of an unrecorded outcome fails closed with the not-found code", () => {
	const dir = mkTarget("show-empty");
	seedPrincipals(dir);
	const r = runCli(["gate", "show", "--index", "0", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
	assert.equal(envelope(r).code, "AMBER_E_GATE_NOT_FOUND");
});

// ── Tamper evidence: the outcome ledger fails every read closed ──

test("an in-place edit of the outcome ledger fails every read closed", () => {
	const dir = mkTarget("tamper");
	seedPrincipals(dir);
	recordEvidence(dir, "evidence/run-42");
	admitGate(dir, ['gate.require=[{"evidenceType":"spec/login@2","assurance":"observed"}]']);
	assert.equal(evaluateGateCli(dir).status, 0);

	const ledger = fs.readFileSync(outcomeLedgerPath(dir), "utf8");
	fs.writeFileSync(outcomeLedgerPath(dir), ledger.replace('"verdict":"pass"', '"verdict":"fail"'));

	const show = runCli(["gate", "show", "--index", "0", "--target", dir, "--json"], dir);
	assert.equal(show.status, 1);
	assert.equal(envelope(show).code, "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT");

	const list = runCli(["gate", "list", "--target", dir, "--json"], dir);
	assert.equal(list.status, 1);
	assert.equal(envelope(list).code, "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT");

	const evaluate = evaluateGateCli(dir);
	assert.equal(evaluate.status, 1);
	assert.equal(envelope(evaluate).code, "AMBER_E_GATE_OUTCOME_REGISTRY_CORRUPT");
});

// ── The legacy plan gate keeps its surface under the same command ──

test("a bare gate --plan invocation routes to the legacy plan gate unchanged", () => {
	const dir = mkTarget("legacy-parity");
	const r = runCli(["gate", "--plan", "docs/plans/nope.md", "--target", dir, "--json"], dir);
	assert.equal(r.status, 1);
	assert.ok(
		envelope(r).errors.some((message) => message.startsWith("Plan file is missing:")),
		`the legacy plan-gate verdict was expected; got ${JSON.stringify(envelope(r).errors)}`,
	);
});

test("an unknown gate subcommand names the supported actions", () => {
	const r = runCli(["gate", "frobnicate", "--target", ROOT, "--json"], ROOT);
	assert.equal(r.status, 1);
	const out = envelope(r);
	assert.ok(
		out.errors.some((message) =>
			message.includes("gate requires evaluate, show, list, or --plan <path>."),
		),
	);
});

test("gate help documents the evaluate/show/list surface and the legacy path", () => {
	const r = runCli(["gate", "--help"], ROOT);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(r.stdout.includes("evaluate"));
	assert.ok(r.stdout.includes("--plan"));
});
