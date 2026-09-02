"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
	resolveCommandId,
	runGovernedCommand,
} = require("../../scripts/lib/core/governed-runner");
const { appendLedgerRecord, readLedger } = require("../../scripts/lib/core/loop-ledger");
const { registerPrincipal } = require("../../scripts/lib/core/principal-registry");
const { showEvidence } = require("../../scripts/lib/core/evidence-receipts");

function tempTarget(label) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `amber-governed-${label}-`));
}

function writeRules(target, rules) {
	const governanceDir = path.join(target, ".amber", "governance");
	fs.mkdirSync(governanceDir, { recursive: true });
	fs.writeFileSync(path.join(governanceDir, "rules.json"), JSON.stringify(rules));
}

function gitTarget(label, rules) {
	const target = tempTarget(label);
	execFileSync("git", ["init", "-q"], { cwd: target });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: target });
	execFileSync("git", ["config", "user.name", "Amber test"], { cwd: target });
	fs.writeFileSync(path.join(target, ".gitignore"), ".amber/\n");
	fs.writeFileSync(path.join(target, "fixture.txt"), "fixture\n");
	execFileSync("git", ["add", "."], { cwd: target });
	execFileSync("git", ["commit", "-qm", "fixture"], { cwd: target });
	writeRules(target, rules);
	return target;
}

function highConfidenceRules(rule) {
	return {
		schemaVersion: 1,
		defaultAction: "deny",
		confidence_gating: {
			enabled: true,
			byRule: { [rule.id]: "high" },
			defaultConfidence: "low",
		},
		rules: [rule],
	};
}

function runWithNamedCommand(target, commandId, ledgerName = "named") {
	const ledgerPath = path.join(target, ".amber", "loops", ledgerName, "ledger.jsonl");
	appendLedgerRecord(ledgerPath, {
		kind: "approved",
		approvalKey: `${ledgerName}:approval`,
	});
	return {
		ledgerPath,
		result: runGovernedCommand({
			target,
			commandId,
			ledgerPath,
			label: ledgerName,
		}),
	};
}

test("resolveCommandId accepts only one exact allow rule and returns its pattern", () => {
	const rule = {
		id: "allow-node-version",
		action: "allow",
		match: "exact",
		pattern: "node --version",
	};
	const resolved = resolveCommandId(rule.id, { rules: [rule] });
	assert.deepEqual(resolved, { ok: true, commandId: rule.id, command: rule.pattern, matchedRule: rule.id, rule });
});

test("resolveCommandId distinguishes unknown, non-allow, and non-exact rules", () => {
	const cases = [
		{
			id: "missing",
			rules: [],
			message: /does not resolve to a rule/,
		},
		{
			id: "deny-node",
			rules: [{ id: "deny-node", action: "deny", match: "exact", pattern: "node --version" }],
			message: /action is "deny".*require action "allow"/,
		},
		{
			id: "allow-node",
			rules: [{ id: "allow-node", action: "allow", match: "prefix", pattern: "node " }],
			message: /match "prefix".*require match "exact"/,
		},
	];

	for (const entry of cases) {
		const resolved = resolveCommandId(entry.id, { rules: entry.rules });
		assert.equal(resolved.ok, false);
		assert.match(resolved.reason, entry.message);
	}
});

test("named command resolution refuses caller text and leaves a denied ledger record", () => {
	const target = tempTarget("caller-text");
	const rules = highConfidenceRules({
		id: "allow-node-version",
		action: "allow",
		match: "exact",
		pattern: "node --version",
	});
	writeRules(target, rules);
	const ledgerPath = path.join(target, ".amber", "loops", "caller-text", "ledger.jsonl");
	const result = runGovernedCommand({
		target,
		commandId: "allow-node-version",
		command: "node -e process.exit(42)",
		ledgerPath,
	});

	assert.match(result.errors.join("\n"), /AMBER_E_COMMAND_ID_UNRESOLVED/);
	assert.equal(result.executed, undefined);
	const [record] = readLedger(ledgerPath);
	assert.equal(record.kind, "denied");
	assert.equal(record.commandId, "allow-node-version");
	assert.equal(record.command, undefined);
	fs.rmSync(target, { recursive: true, force: true });
});

test("named command execution records commandId and matchedRule in the result and ledger", () => {
	const rule = {
		id: "allow-node-version",
		action: "allow",
		match: "exact",
		pattern: "node --version",
	};
	const target = gitTarget("execute", highConfidenceRules(rule));
	const { ledgerPath, result } = runWithNamedCommand(target, rule.id);

	assert.deepEqual(result.errors, [], JSON.stringify(result));
	assert.equal(result.executed, true);
	assert.equal(result.commandId, rule.id);
	assert.equal(result.matchedRule, rule.id);
	assert.equal(result.command, rule.pattern);
	assert.equal(result.ledgerRecord.matchedRule, rule.id);
	assert.equal(result.ledgerRecord.commandId, rule.id);
	assert.equal(result.ledgerRecord.action.command, rule.pattern);
	assert.equal(readLedger(ledgerPath).at(-1).matchedRule, rule.id);
	fs.rmSync(target, { recursive: true, force: true });
});

// Spec F062 Testing Decisions: "A run produces an Evidence receipt carrying an
// output digest | traces to decision 5". A real git repo, a real named-command
// execution, and the receipt read back from disk — not an in-memory claim.
test("a named-command run produces an Evidence receipt carrying an output digest", () => {
	const rule = {
		id: "allow-node-version",
		action: "allow",
		match: "exact",
		pattern: "node --version",
	};
	const target = gitTarget("evidence-digest", highConfidenceRules(rule));
	registerPrincipal(target, { id: "ci@example.com", principalKind: "human" });

	const ledgerPath = path.join(target, ".amber", "loops", "evidence-digest", "ledger.jsonl");
	appendLedgerRecord(ledgerPath, { kind: "approved", approvalKey: "evidence-digest:approval" });
	const result = runGovernedCommand({
		target,
		commandId: rule.id,
		ledgerPath,
		label: "evidence-digest",
		producer: "ci@example.com",
		evidenceId: "evidence/named/att-1",
		capabilityPin: "runner/ci@1.0.0#diagnose.check@1",
		requestId: "req-1",
		attemptId: "att-1",
	});

	assert.deepEqual(result.errors, [], JSON.stringify(result));
	assert.equal(result.executed, true);
	assert.ok(result.evidence, "an Evidence receipt is bound to the run");
	assert.match(result.outputDigest, /^sha256:[0-9a-f]{64}$/);

	// The receipt persists under .amber/evidence/ with the digest.
	const receipt = showEvidence(target, "evidence/named/att-1");
	assert.ok(receipt, "the receipt exists on disk");
	assert.match(receipt.outputDigest, /^sha256:[0-9a-f]{64}$/);
	assert.equal(receipt.assurance, "replayable");
	assert.equal(receipt.replayOf, "governed.named-command:node --version");

	// The executed ledger record carries the digest and evidence id.
	const executed = readLedger(ledgerPath).at(-1);
	assert.equal(executed.kind, "executed");
	assert.match(executed.outputDigest, /^sha256:[0-9a-f]{64}$/);
	assert.equal(executed.evidenceId, "evidence/named/att-1");
	fs.rmSync(target, { recursive: true, force: true });
});
