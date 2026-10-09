"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
	parseGovernedArgv,
	toSpawnArgv,
	evaluateGovernedPolicy,
	evaluateVerifyPolicy,
	DEFAULT_RULES,
} = require("../../scripts/lib/core/loop-policy");
const { executeInPreparedWorkspace } = require("../../scripts/lib/core/execution-domain-adapter");
const { runEvidenceCommand } = require("../../scripts/lib/core/evidence-runner");

function scratch(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-argv-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

const allowNode = {
	schemaVersion: 1,
	defaultAction: "deny",
	rules: [{ id: "allow-node", action: "allow", match: "prefix", pattern: "node " }],
};

test("toSpawnArgv resolves npm and npx for a shell-free Windows spawn", () => {
	// Node cannot launch the npm.cmd shim with shell:false, and npm ships only that
	// shim on a standard Windows install, so the two names the default policy allows
	// are rewritten to the Node entry point beside the running interpreter.
	const entry = path.join(
		path.dirname(process.execPath),
		"node_modules",
		"npm",
		"bin",
		"npm-cli.js",
	);
	const expected = fs.existsSync(entry) ? [process.execPath, entry, "test"] : ["npm", "test"];

	assert.deepEqual(toSpawnArgv(["npm", "test"], "win32"), expected);
});

test("toSpawnArgv leaves every other name and platform exactly as parsed", () => {
	assert.deepEqual(toSpawnArgv(["npm", "test"], "linux"), ["npm", "test"]);
	assert.deepEqual(toSpawnArgv(["npm", "test"], "darwin"), ["npm", "test"]);
	assert.deepEqual(toSpawnArgv(["node", "scripts/amber.js"], "win32"), [
		"node",
		"scripts/amber.js",
	]);
	assert.deepEqual(toSpawnArgv([], "win32"), []);
});

test("parseGovernedArgv splits plain words and keeps quoted literals whole", () => {
	assert.deepEqual(parseGovernedArgv("node scripts/amber.js status"), [
		"node",
		"scripts/amber.js",
		"status",
	]);
	assert.deepEqual(parseGovernedArgv(`node -e "require('fs').writeFileSync('a b','x')"`), [
		"node",
		"-e",
		"require('fs').writeFileSync('a b','x')",
	]);
	assert.deepEqual(parseGovernedArgv("node scripts/amber.js next --objective 'a $(b) `c`; d'"), [
		"node",
		"scripts/amber.js",
		"next",
		"--objective",
		"a $(b) `c`; d",
	]);
	assert.deepEqual(parseGovernedArgv(`echo "it's" ''`), ["echo", "it's", ""]);
});

test("parseGovernedArgv refuses every shell metacharacter outside single quotes", () => {
	const payloads = [
		'node scripts/amber.js "$(touch /tmp/x)"',
		'node scripts/amber.js "`touch /tmp/x`"',
		"node scripts/amber.js `touch /tmp/x`",
		"node scripts/amber.js $(touch /tmp/x)",
		"node scripts/amber.js $HOME",
		'node scripts/amber.js "${HOME}"',
		"node scripts/amber.js status\ntouch /tmp/x",
		"node scripts/amber.js status\rtouch /tmp/x",
		"node scripts/amber.js status; touch /tmp/x",
		"node scripts/amber.js status | sh",
		"node scripts/amber.js status && touch /tmp/x",
		"node scripts/amber.js status & touch /tmp/x",
		"node scripts/amber.js status > /tmp/x",
		"node scripts/amber.js status 2>&1",
		"node scripts/amber.js status < /etc/passwd",
		'node scripts/amber.js "unterminated',
		"node scripts/amber.js 'unterminated",
		"",
	];
	for (const payload of payloads) {
		assert.throws(
			() => parseGovernedArgv(payload),
			(error) => error.amberCode === "AMBER_E_POLICY_SHELL_META",
			JSON.stringify(payload),
		);
	}
});

test("evaluateGovernedPolicy refuses double-quoted command substitution with AMBER_E_POLICY_SHELL_META", () => {
	const verdict = evaluateGovernedPolicy(
		'node scripts/amber.js "$(touch /tmp/PWNED)"',
		DEFAULT_RULES,
	);
	assert.equal(verdict.allowed, false);
	assert.equal(verdict.code, "AMBER_E_POLICY_SHELL_META");
});

test("evaluateVerifyPolicy refuses double-quoted backticks even when an allow rule matches the head", () => {
	const verdict = evaluateVerifyPolicy('node -e "`id`"', allowNode);
	assert.equal(verdict.allowed, false);
	assert.equal(verdict.code, "AMBER_E_POLICY_SHELL_META");
});

test("policy rules match the parsed argv, so quoting cannot hide a destructive verb", () => {
	assert.equal(
		evaluateGovernedPolicy('rm "-rf" /tmp/x', { ...allowNode, defaultAction: "allow" }).allowed,
		false,
	);
	assert.equal(evaluateGovernedPolicy("node scripts/amber.js status", DEFAULT_RULES).allowed, true);
	const exact = {
		schemaVersion: 1,
		defaultAction: "deny",
		rules: [{ id: "x", action: "allow", match: "exact", pattern: `node -e "console.log(1)"` }],
	};
	assert.equal(evaluateGovernedPolicy("node -e 'console.log(1)'", exact).allowed, true);
	assert.equal(evaluateGovernedPolicy("node -e 'console.log(2)'", exact).allowed, false);
});

test("the governed spawn runs argv without a shell: substitution never executes", async (t) => {
	const dir = scratch(t);
	const marker = path.join(dir, "PWNED");
	const refused = await executeInPreparedWorkspace(dir, `node -e 1 "$(touch ${marker})"`, 1, {});
	assert.equal(fs.existsSync(marker), false);
	assert.match(String(refused.error), /AMBER_E_POLICY_SHELL_META/);

	const literal = await executeInPreparedWorkspace(
		dir,
		`node -e "process.stdout.write(process.argv[1])" '$(touch ${marker})'`,
		1,
		{},
	);
	assert.equal(literal.result.exitCode, 0);
	assert.equal(literal.result.stdout, `$(touch ${marker})`);
	assert.equal(fs.existsSync(marker), false);
});

test("the evidence runner records a refusal and runs nothing for a substitution payload", async (t) => {
	const dir = scratch(t);
	const marker = path.join(dir, "PWNED");
	fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "governance", "verify-rules.json"),
		JSON.stringify(allowNode),
	);
	const ledgerPath = path.join(dir, "ledger.jsonl");
	const outcome = await runEvidenceCommand({
		target: dir,
		command: `node -e 1 "$(touch ${marker})"`,
		ledgerPath,
	});
	assert.equal(outcome.denied, true);
	assert.equal(fs.existsSync(marker), false);
	const [record] = fs
		.readFileSync(ledgerPath, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	assert.equal(record.kind, "verification_denied");
	assert.match(record.reason, /AMBER_E_POLICY_SHELL_META/);

	const ran = await runEvidenceCommand({
		target: dir,
		command: `node -e "process.stdout.write(process.argv[1])" "plain literal"`,
		ledgerPath,
	});
	assert.equal(ran.exitCode, 0);
	assert.equal(ran.stdoutTail, "plain literal");
});
