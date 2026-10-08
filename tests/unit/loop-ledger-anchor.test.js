"use strict";

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execSync, spawn, spawnSync } = require("node:child_process");
const {
	approveLoopContract,
	executeLoopContract,
	verifyLoopLedger,
	ledgerPath,
} = require("../../scripts/lib/core/loop-execution");
const L = require("../../scripts/lib/core/loop-ledger");
const { setExecutionAdapter } = require("../../scripts/lib/core/governed-runner");
const { sealLedger, verifyAnchoring } = require("../../scripts/lib/core/ledger-seal");

const LEDGER_MODULE = path.resolve(__dirname, "../../scripts/lib/core/loop-ledger.js");

const ALLOW_NODE = {
	schemaVersion: 1,
	defaultAction: "deny",
	confidence_gating: { enabled: true, byRule: { "allow-node": "high" }, defaultConfidence: "low" },
	rules: [{ id: "allow-node", action: "allow", match: "prefix", pattern: "node " }],
};

const dirs = [];
afterEach(() => {
	setExecutionAdapter(null);
	for (const dir of dirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
});

function repoWithPack(contractId = "c1") {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-anchor-"));
	dirs.push(dir);
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
	fs.writeFileSync(
		packPath,
		JSON.stringify({
			id: "p",
			version: "1",
			loopContracts: [
				{ id: contractId, governed: { requiresApproval: true, command: "node --version" } },
			],
		}),
	);
	return { dir, packPath };
}

function countingAdapter({ delayMs = 0, crash = false } = {}) {
	const spawned = [];
	setExecutionAdapter({
		async executeInWorktree(_root, command) {
			spawned.push(command);
			if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
			if (crash) throw new Error("killed between spawn and the executed append");
			return { result: { command, exitCode: 0, stdout: "v", stderr: "" } };
		},
	});
	return spawned;
}

const approve = (dir, packPath) =>
	approveLoopContract({ file: packPath, contract: "c1", target: dir, reviewer: "me" });
const run = (dir, packPath) =>
	executeLoopContract({ file: packPath, contract: "c1", target: dir, execute: true });

function truncateToFirstRecord(lp) {
	const [first] = fs.readFileSync(lp, "utf8").split("\n");
	fs.writeFileSync(lp, `${first}\n`);
}

test("truncating the ledger after `approved` is reported as head-truncated and refuses the rerun", async () => {
	const { dir, packPath } = repoWithPack();
	const spawned = countingAdapter();
	approve(dir, packPath);
	await run(dir, packPath);
	const lp = ledgerPath(dir, "c1");
	truncateToFirstRecord(lp);

	const verify = L.verifyLedgerChain(lp);
	const rerun = await run(dir, packPath);

	assert.deepEqual(
		{ intact: verify.intact, reason: verify.reason },
		{ intact: false, reason: "head-truncated" },
	);
	assert.match(rerun.errors.join("\n"), /head-truncated.*AMBER_E_LEDGER_TAMPERED/);
	assert.equal(spawned.length, 1);
});

test("a spent approval replayed with a forged anchor is refused as consumed", async () => {
	const { dir, packPath } = repoWithPack();
	const spawned = countingAdapter();
	approve(dir, packPath);
	const lp = ledgerPath(dir, "c1");
	const anchorAfterApprove = fs.readFileSync(path.join(`${lp}.anchor`, "head.json"));
	await run(dir, packPath);
	truncateToFirstRecord(lp);
	fs.writeFileSync(path.join(`${lp}.anchor`, "head.json"), anchorAfterApprove);

	const rerun = await run(dir, packPath);

	assert.match(rerun.errors.join("\n"), /AMBER_E_LOOP_APPROVAL_CONSUMED/);
	assert.equal(spawned.length, 1);
});

test("a crash between spawn and the executed append leaves the approval consumed", async () => {
	const { dir, packPath } = repoWithPack();
	approve(dir, packPath);
	countingAdapter({ crash: true });
	await assert.rejects(run(dir, packPath), /killed between spawn/);
	const spawned = countingAdapter();

	const retry = await run(dir, packPath);

	assert.match(retry.errors.join("\n"), /AMBER_E_LOOP_APPROVAL_CONSUMED/);
	assert.equal(spawned.length, 0);
});

test("two concurrent runs on one approval execute exactly once", async () => {
	const { dir, packPath } = repoWithPack();
	const spawned = countingAdapter({ delayMs: 50 });
	approve(dir, packPath);

	const results = await Promise.all([run(dir, packPath), run(dir, packPath)]);

	assert.equal(spawned.length, 1);
	assert.equal(results.filter((r) => r.executed === true).length, 1);
	assert.equal(L.verifyLedgerChain(ledgerPath(dir, "c1")).intact, true);
});

test("a fresh approval after a consumed one executes once", async () => {
	const { dir, packPath } = repoWithPack();
	const spawned = countingAdapter();
	approve(dir, packPath);
	await run(dir, packPath);
	approve(dir, packPath);

	const second = await run(dir, packPath);
	const third = await run(dir, packPath);

	assert.equal(second.executed, true);
	assert.match(third.errors.join("\n"), /AMBER_E_LOOP_NOT_APPROVED/);
	assert.equal(spawned.length, 2);
});

test("deleting the anchor store refuses verify and run", async () => {
	const { dir, packPath } = repoWithPack();
	const spawned = countingAdapter();
	approve(dir, packPath);
	const lp = ledgerPath(dir, "c1");
	fs.rmSync(`${lp}.anchor`, { recursive: true });

	const verify = L.verifyLedgerChain(lp);
	const r = await run(dir, packPath);

	assert.deepEqual(
		{ intact: verify.intact, reason: verify.reason },
		{ intact: false, reason: "anchor-missing" },
	);
	assert.match(r.errors.join("\n"), /anchor-missing.*AMBER_E_LEDGER_TAMPERED/);
	assert.equal(spawned.length, 0);
});

test("a traversal contractId is refused and writes nothing outside the target", () => {
	const { dir, packPath } = repoWithPack("../../escape");
	const escaped = path.resolve(dir, ".amber", "loops", "../../escape");

	const approved = approveLoopContract({
		file: packPath,
		contract: "../../escape",
		target: dir,
		reviewer: "me",
	});
	const verified = verifyLoopLedger({ target: dir, contract: "../../escape" });

	assert.match(approved.errors.join("\n"), /AMBER_E_LOOP_CONTRACT_ID_INVALID/);
	assert.match(verified.errors.join("\n"), /AMBER_E_LOOP_CONTRACT_ID_INVALID/);
	assert.equal(fs.existsSync(escaped), false);
});

// The retry loop below tolerates the documented lock refusal, and the internal wait
// bound means a pathological hang would otherwise take tens of minutes to surface.
// This ceiling turns that into a failure instead.
test(
	"concurrent appends from separate processes keep one unbroken chain",
	{ timeout: 120000 },
	async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-anchor-race-"));
		dirs.push(dir);
		const lp = path.join(dir, "ledger.jsonl");
		// A concurrent writer is refused once the lock wait budget expires, and the
		// caller retries; that is the documented contract, not a failure. Retrying here
		// keeps this test about the chain, which is what it is for, instead of about how
		// quickly a loaded machine hands the lock over. Any other error still exits 1.
		const script = `
		const L = require(${JSON.stringify(LEDGER_MODULE)});
		const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		(async () => {
			for (let i = 0; i < 40; i++) {
				for (let attempt = 0; ; attempt++) {
					try {
						L.appendLedgerRecord(${JSON.stringify(lp)}, { kind: "note", i, pid: process.pid });
						break;
					} catch (error) {
						if (!/AMBER_E_LEDGER_LOCKED/.test(String(error && error.message))) throw error;
						if (attempt >= 5) throw error;
						await wait(5);
					}
				}
			}
		})().catch((error) => {
			console.error(error);
			process.exit(1);
		});
	`;
		const exits = await Promise.all(
			[1, 2, 3, 4].map(
				() =>
					new Promise((resolve) => {
						spawn(process.execPath, ["-e", script], { stdio: "ignore" }).on("exit", resolve);
					}),
			),
		);

		assert.deepEqual(exits, [0, 0, 0, 0]);
		assert.deepEqual(L.verifyLedgerChain(lp), { intact: true, brokenAt: null, records: 160 });
	},
);

function deadPid() {
	return spawnSync(process.execPath, ["-e", ""]).pid;
}

function raceDir(prefix) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	dirs.push(dir);
	return path.join(dir, "ledger.jsonl");
}

// A holder that dies leaves its lock behind. Reclaiming it is a read-then-remove,
// so two reclaimers can read the same stale lock and the slower one would remove
// the lock the faster one just created. The guard prevents that, and these cases
// pin that the guard cannot itself become a wedge.
test("a lock left by a dead holder is reclaimed", () => {
	const lp = raceDir("amber-anchor-deadlock-");
	fs.writeFileSync(`${lp}.lock`, String(deadPid()));

	L.appendLedgerRecord(lp, { kind: "note", i: 1 });

	assert.deepEqual(L.verifyLedgerChain(lp), { intact: true, brokenAt: null, records: 1 });
	assert.equal(fs.existsSync(`${lp}.lock`), false);
});

test("a guard left by a dead reclaimer does not wedge the ledger", () => {
	const lp = raceDir("amber-anchor-deadguard-");
	L.appendLedgerRecord(lp, { kind: "note", i: 0 });
	fs.writeFileSync(`${lp}.lock`, String(deadPid()));
	fs.writeFileSync(`${lp}.lock.takeover`, String(deadPid()));

	L.appendLedgerRecord(lp, { kind: "note", i: 2 });

	assert.deepEqual(L.verifyLedgerChain(lp), { intact: true, brokenAt: null, records: 2 });
	assert.equal(fs.existsSync(`${lp}.lock`), false);
});

// A reclaimer can die holding the guard, and a reclaimer of that guard can die too.
// A depth counter would make the last level unreclaimable and wedge the ledger for
// good, so the chain has to keep unwinding however deep it goes.
test("a takeover chain left by repeated crashes is reclaimed", () => {
	const lp = raceDir("amber-anchor-deepchain-");
	L.appendLedgerRecord(lp, { kind: "note", i: 0 });
	for (const suffix of ["", ".takeover", ".takeover.takeover", ".takeover.takeover.takeover"]) {
		fs.writeFileSync(`${lp}.lock${suffix}`, String(deadPid()));
	}

	L.appendLedgerRecord(lp, { kind: "note", i: 1 });

	assert.deepEqual(L.verifyLedgerChain(lp), { intact: true, brokenAt: null, records: 2 });
	assert.equal(fs.existsSync(`${lp}.lock`), false);
	assert.equal(fs.existsSync(`${lp}.lock.takeover`), false);
});

// The race the guard exists for: two writers find the same stale lock and both try
// to reclaim it. Exactly one may remove it, and the other must not remove the lock
// the first one created.
test("two writers reclaiming one stale lock both append and leave one chain", async () => {
	const lp = raceDir("amber-anchor-reclaimrace-");
	fs.writeFileSync(`${lp}.lock`, String(deadPid()));
	const script = `
		const L = require(${JSON.stringify(LEDGER_MODULE)});
		L.appendLedgerRecord(${JSON.stringify(lp)}, { kind: "note", pid: process.pid });
	`;
	const exits = await Promise.all(
		[1, 2].map(
			() =>
				new Promise((resolve) => {
					spawn(process.execPath, ["-e", script], { stdio: "ignore" }).on("exit", resolve);
				}),
		),
	);

	assert.deepEqual(exits, [0, 0]);
	assert.deepEqual(L.verifyLedgerChain(lp), { intact: true, brokenAt: null, records: 2 });
});

test(
	"a lock holding no pid stays owned while fresh and is reclaimed once it is old",
	{ timeout: 60000 },
	() => {
		const lp = raceDir("amber-anchor-nopid-");
		fs.writeFileSync(`${lp}.lock`, "");

		// Fresh: a writer could be mid-publish, so it must not be stolen.
		assert.throws(() => L.appendLedgerRecord(lp, { kind: "note", i: 1 }), /AMBER_E_LEDGER_LOCKED/);
		assert.equal(fs.existsSync(`${lp}.lock`), true);

		// Old: no live writer could still be inside, so it must not wedge the ledger.
		const old = (Date.now() - 60000) / 1000;
		fs.utimesSync(`${lp}.lock`, old, old);
		L.appendLedgerRecord(lp, { kind: "note", i: 2 });

		assert.deepEqual(L.verifyLedgerChain(lp), { intact: true, brokenAt: null, records: 1 });
		assert.equal(fs.existsSync(`${lp}.lock`), false);
	},
);

function sealedRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-anchor-seal-"));
	dirs.push(dir);
	execSync("git init -q && git config user.email t@t.t && git config user.name t", { cwd: dir });
	const lp = path.join(dir, ".amber", "sessions", "S1", "ledger.jsonl");
	L.appendLedgerRecord(lp, { kind: "approved", approvalKey: "a1" });
	L.appendLedgerRecord(lp, { kind: "note", n: 1 });
	fs.writeFileSync(path.join(dir, "x"), "1");
	execSync("git add -A && git commit -qm init", { cwd: dir });
	assert.equal(sealLedger(dir).sealed, true);
	return { dir, lp };
}

test("appending after a seal is a valid extension, not drift", () => {
	const { dir, lp } = sealedRepo();
	L.appendLedgerRecord(lp, { kind: "executed", consumedApprovalKey: "a1" });

	const v = verifyAnchoring(dir);

	assert.equal(v.anchored, true);
	assert.deepEqual(v.extended, [{ home: "sessions", sub: "S1", sealedCount: 2, currentCount: 3 }]);
});

test("rewriting a sealed record and re-sealing is refused", () => {
	const { dir, lp } = sealedRepo();
	const recs = L.readLedger(lp);
	fs.rmSync(lp);
	fs.rmSync(`${lp}.anchor`, { recursive: true });
	L.appendLedgerRecord(lp, { ...recs[0], hash: undefined, prevHash: undefined, reviewer: "x" });
	L.appendLedgerRecord(lp, { kind: "note", n: 1 });
	execSync("git commit -q --allow-empty -m later", { cwd: dir });

	const reseal = sealLedger(dir);
	const v = verifyAnchoring(dir);

	assert.equal(reseal.sealed, false);
	assert.match(reseal.errors.join("\n"), /AMBER_E_LEDGER_RESEAL_REFUSED/);
	assert.equal(v.anchored, false);
	assert.equal(v.drift[0].status, "tail-changed");
});
