"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync } = require("node:child_process");
const {
	approveLoopContract,
	executeLoopContract,
	ledgerPath,
} = require("../../scripts/lib/core/loop-execution");
const { readLedger } = require("../../scripts/lib/core/loop-ledger");

const ALLOW_NODE = {
	schemaVersion: 1,
	defaultAction: "deny",
	confidence_gating: { enabled: true, byRule: { "allow-node": "high" }, defaultConfidence: "low" },
	rules: [{ id: "allow-node", action: "allow", match: "prefix", pattern: "node " }],
};

function repoWithPack(governed) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-pin-"));
	execSync("git init -q && git config user.email a@b.c && git config user.name t", { cwd: dir });
	fs.writeFileSync(path.join(dir, ".gitignore"), ".amber/\npack.json\n");
	fs.writeFileSync(path.join(dir, "x.txt"), "hi");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	fs.mkdirSync(path.join(dir, ".amber", "governance"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, ".amber", "governance", "rules.json"),
		JSON.stringify(ALLOW_NODE),
	);
	const packPath = path.join(dir, "pack.json");
	writePack(packPath, governed);
	return { dir, packPath };
}

function writePack(packPath, governed) {
	fs.writeFileSync(
		packPath,
		JSON.stringify({
			id: "p",
			version: "1",
			loopContracts: [
				{ id: "c1", governed: { requiresApproval: true, ...governed } },
				{ id: "c2", governed: { requiresApproval: true, command: "node --version" } },
			],
		}),
	);
}

function run(dir, packPath, contract = "c1") {
	return executeLoopContract({ file: packPath, contract, target: dir, execute: true });
}

function executedCount(dir, contract = "c1") {
	return readLedger(ledgerPath(dir, contract)).filter((r) => r.kind === "executed").length;
}

function cleanup(dir) {
	fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

test("a command swapped after approval is refused as contract drift and runs nothing", async () => {
	const { dir, packPath } = repoWithPack({ command: "node --version" });
	approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });
	writePack(packPath, { command: "node -e 0" });

	const r = await run(dir, packPath);

	assert.match(r.errors.join("\n"), /AMBER_E_LOOP_CONTRACT_DRIFT/);
	assert.equal(r.executed, undefined);
	assert.equal(executedCount(dir), 0);
	cleanup(dir);
});

test("rules swapped after approval are refused as contract drift", async () => {
	const deny = (pattern) => [{ id: "ctx-deny", action: "deny", match: "exact", pattern }];
	const { dir, packPath } = repoWithPack({ command: "node --version", rules: deny("node -e 1") });
	approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });
	writePack(packPath, { command: "node --version", rules: deny("node -e 2") });

	const r = await run(dir, packPath);

	assert.match(r.errors.join("\n"), /AMBER_E_LOOP_CONTRACT_DRIFT/);
	assert.equal(executedCount(dir), 0);
	cleanup(dir);
});

test("a pack allow rule is refused when the pack is read, for approve and run", async () => {
	const { dir, packPath } = repoWithPack({
		command: "python3 -V",
		rules: [{ id: "ctx-allow-py", action: "allow", match: "prefix", pattern: "python3" }],
	});

	const approved = approveLoopContract({ file: packPath, contract: "c1", target: dir });
	const r = await run(dir, packPath);

	assert.match(approved.errors.join("\n"), /ctx-allow-py.*AMBER_E_PACK_ALLOW_RULE/);
	assert.match(r.errors.join("\n"), /ctx-allow-py.*AMBER_E_PACK_ALLOW_RULE/);
	assert.equal(fs.existsSync(ledgerPath(dir, "c1")), false);
	cleanup(dir);
});

test("an unchanged contract executes exactly once", async () => {
	const { dir, packPath } = repoWithPack({ command: "node --version" });
	approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });

	const first = await run(dir, packPath);
	const second = await run(dir, packPath);

	assert.deepEqual(first.errors, []);
	assert.equal(first.exitCode, 0);
	assert.match(second.errors.join("\n"), /AMBER_E_LOOP_NOT_APPROVED/);
	assert.equal(executedCount(dir), 1);
	cleanup(dir);
});

test("reverting a drifted command to the approved one executes again", async () => {
	const { dir, packPath } = repoWithPack({ command: "node --version" });
	approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });
	writePack(packPath, { command: "node -e 0" });
	await run(dir, packPath);
	writePack(packPath, { command: "node --version" });

	const r = await run(dir, packPath);

	assert.deepEqual(r.errors, []);
	assert.equal(executedCount(dir), 1);
	cleanup(dir);
});

test("approvals pin distinct commands to distinct capability hashes", () => {
	const { dir, packPath } = repoWithPack({ command: "node --version" });
	const a = approveLoopContract({ file: packPath, contract: "c1", target: dir });
	writePack(packPath, { command: "node -e 0" });
	const b = approveLoopContract({ file: packPath, contract: "c1", target: dir });

	assert.notEqual(a.record.capabilityHash, b.record.capabilityHash);
	cleanup(dir);
});

test("a dry run after drift reports the drift without executing", async () => {
	const { dir, packPath } = repoWithPack({ command: "node --version" });
	approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });
	writePack(packPath, { command: "node -e 0" });

	const r = await executeLoopContract({
		file: packPath,
		contract: "c1",
		target: dir,
		dryRun: true,
	});

	assert.equal(r.mode, "dry-run");
	assert.match(r.warnings.join("\n"), /AMBER_E_LOOP_CONTRACT_DRIFT/);
	assert.equal(executedCount(dir), 0);
	cleanup(dir);
});
