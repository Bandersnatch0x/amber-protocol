"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runEvidenceCommand } = require("../../scripts/lib/core/evidence-runner");

// Write a verification governance policy that allows only commands beginning with "node ".
function seedPolicy(root) {
	const dir = path.join(root, ".amber", "governance");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "verify-rules.json"),
		JSON.stringify({
			schemaVersion: 1,
			defaultAction: "deny",
			rules: [{ id: "allow-node", action: "allow", match: "prefix", pattern: "node " }],
		}),
	);
}

function tmp() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-ev-"));
	seedPolicy(dir);
	return dir;
}

test("runs an allowed command and records verification_passed on exit 0", () => {
	const dir = tmp();
	const ledgerPath = path.join(dir, ".amber", "sessions", "s1", "ledger.jsonl");
	const r = runEvidenceCommand({
		target: dir,
		command: 'node -e "process.stdout.write(\\"hello\\"); process.exit(0)"',
		ledgerPath,
		subject: { sessionId: "s1", stage: "verify" },
	});
	assert.equal(r.executed, true);
	assert.equal(r.denied, false);
	assert.equal(r.exitCode, 0);
	const recs = fs.readFileSync(ledgerPath, "utf8").trim().split("\n").map(JSON.parse);
	assert.equal(recs.length, 1);
	assert.equal(recs[0].kind, "verification_passed");
	assert.equal(recs[0].exitCode, 0);
	assert.ok(recs[0].hash);
	assert.match(recs[0].stdoutTail, /hello/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("records verification_failed on a non-zero exit", () => {
	const dir = tmp();
	const ledgerPath = path.join(dir, ".amber", "sessions", "s2", "ledger.jsonl");
	const r = runEvidenceCommand({
		target: dir,
		command: 'node -e "process.stderr.write(\\"boom\\"); process.exit(3)"',
		ledgerPath,
		subject: { sessionId: "s2", stage: "verify" },
	});
	assert.equal(r.executed, true);
	assert.equal(r.exitCode, 3);
	const recs = fs.readFileSync(ledgerPath, "utf8").trim().split("\n").map(JSON.parse);
	assert.equal(recs[0].kind, "verification_failed");
	assert.match(recs[0].stderrTail, /boom/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("uses verify-rules.json and ignores rules.json for verification policy", () => {
	const dir = tmp();
	const gov = path.join(dir, ".amber", "governance");
	// rules.json denies everything that verify-rules.json allows.
	fs.writeFileSync(
		path.join(gov, "rules.json"),
		JSON.stringify({ schemaVersion: 1, defaultAction: "deny", rules: [] }),
	);
	const ledgerPath = path.join(dir, ".amber", "sessions", "s4", "ledger.jsonl");
	const r = runEvidenceCommand({
		target: dir,
		command: 'node -e "process.exit(0)"',
		ledgerPath,
		subject: { sessionId: "s4", stage: "verify" },
	});
	assert.equal(r.executed, true);
	assert.equal(r.denied, false);
	assert.equal(r.exitCode, 0);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("denies a command the policy does not allow; nothing runs", () => {
	const dir = tmp();
	const ledgerPath = path.join(dir, ".amber", "sessions", "s3", "ledger.jsonl");
	const r = runEvidenceCommand({
		target: dir,
		command: "git status",
		ledgerPath,
		subject: { sessionId: "s3", stage: "verify" },
	});
	assert.equal(r.executed, false);
	assert.equal(r.denied, true);
	const recs = fs.readFileSync(ledgerPath, "utf8").trim().split("\n").map(JSON.parse);
	assert.equal(recs[0].kind, "verification_denied");
	assert.equal(recs[0].executesAnything, false);
	assert.equal(recs[0].stdoutTail, undefined);
	assert.equal(recs[0].stderrTail, undefined);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("denies a shell-composite command even when its head is allow-listed; nothing runs (B2)", () => {
	const dir = tmp(); // policy allows the "node " prefix
	const sideEffect = path.join(dir, "pwned.txt");
	const ledgerPath = path.join(dir, ".amber", "sessions", "s5", "ledger.jsonl");
	const r = runEvidenceCommand({
		target: dir,
		command: `node -e "process.exit(0)" && node -e "require('fs').writeFileSync(${JSON.stringify(sideEffect)},'x')"`,
		ledgerPath,
		subject: { sessionId: "s5", stage: "verify" },
	});
	assert.equal(r.executed, false, "the composite is refused before anything runs");
	assert.equal(r.denied, true);
	assert.equal(fs.existsSync(sideEffect), false, "the chained side effect never ran");
	const recs = fs.readFileSync(ledgerPath, "utf8").trim().split("\n").map(JSON.parse);
	assert.equal(recs[0].kind, "verification_denied");
	fs.rmSync(dir, { recursive: true, force: true });
});

// #315: the verification budget resolves from the flag, the env override, or
// the 5-minute default — and fails closed on garbage.
const { resolveBudgetMinutes } = require("../../scripts/lib/core/evidence-runner");

test("resolveBudgetMinutes defaults to 5, honors the env override, and validates the flag range", () => {
	assert.equal(resolveBudgetMinutes(undefined), 5);
	assert.equal(resolveBudgetMinutes(null), 5);
	assert.equal(resolveBudgetMinutes(1), 1);
	assert.equal(resolveBudgetMinutes(15), 15);
	assert.equal(resolveBudgetMinutes(60), 60);
	for (const bad of [0, -1, 61, 5.5, Number.NaN, "10"]) {
		assert.throws(
			() => resolveBudgetMinutes(bad),
			(error) => {
				assert.match(String(error.message), /between 1 and 60/);
				return true;
			},
			`expected ${JSON.stringify(bad)} to be refused`,
		);
	}

	process.env.AMBER_VERIFY_BUDGET_MINUTES = "30";
	try {
		assert.equal(resolveBudgetMinutes(undefined), 30);
		assert.equal(resolveBudgetMinutes(15), 15, "an explicit request wins over the env default");
	} finally {
		delete process.env.AMBER_VERIFY_BUDGET_MINUTES;
	}

	process.env.AMBER_VERIFY_BUDGET_MINUTES = "abc";
	try {
		assert.throws(
			() => resolveBudgetMinutes(undefined),
			/error/i,
			"a set-but-garbage env override fails closed",
		);
	} finally {
		delete process.env.AMBER_VERIFY_BUDGET_MINUTES;
	}
});
