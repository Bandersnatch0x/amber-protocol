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
// The chain unwinds to one level below the bound; past it, nothing can reclaim the
// leftovers, so the refusal has to name every file a human must remove. An
// instruction naming files that are not there leaves the operator with nothing to do
// and the same refusal on the next run.
test("a takeover chain deeper than the bound is refused with the files to remove", () => {
	const lp = raceDir("amber-anchor-deepchain-");
	L.appendLedgerRecord(lp, { kind: "note", i: 0 });
	for (const suffix of ["", ".takeover", ".takeover.takeover"]) {
		fs.writeFileSync(`${lp}.lock${suffix}`, String(deadPid()));
	}

	let error;
	try {
		L.appendLedgerRecord(lp, { kind: "note", i: 1 });
	} catch (thrown) {
		error = thrown;
	}

	assert.ok(error, "the append must be refused when the chain cannot unwind");
	assert.match(error.message, /AMBER_E_LEDGER_LOCK_CHAIN/);
	// Every leftover is named, not just the deepest one, and named as its own entry.
	// Substring checks would pass on a message that names only the deepest file, since
	// a longer path contains the shorter ones.
	const named = error.message
		.replace(/\s*\[AMBER_E_LEDGER_LOCK_CHAIN\][\s\S]*$/, "")
		.split("; remove ")
		.pop()
		.split(", ");
	assert.deepEqual(named, [`${lp}.lock`, `${lp}.lock.takeover`, `${lp}.lock.takeover.takeover`]);
});

// The race the guard exists for: two writers find the same stale lock and both try
// to reclaim it. Exactly one may remove it, and the other must not remove the lock
// the first one created. This one guards the guard itself, added when the reclaim
// was first serialized, not the depth change that followed it.
test("eight writers released at once reclaim one stale lock and leave one chain", async () => {
	const lp = raceDir("amber-anchor-reclaimrace-");
	const gate = `${lp}.gate`;
	fs.writeFileSync(`${lp}.lock`, String(deadPid()));
	// Two staggered writers rarely overlap in the reclaim read, so the old pair passed
	// even with the byte guard removed. Every writer spins on one gate file instead, so
	// they reach the stale lock at the same instant and only the guard keeps them out of
	// each other's critical section.
	const script = `
		const fs = require("node:fs");
		while (!fs.existsSync(${JSON.stringify(gate)})) {}
		const L = require(${JSON.stringify(LEDGER_MODULE)});
		L.appendLedgerRecord(${JSON.stringify(lp)}, { kind: "note", pid: process.pid });
	`;
	const pending = [1, 2, 3, 4, 5, 6, 7, 8].map(
		() =>
			new Promise((resolve) => {
				spawn(process.execPath, ["-e", script], { stdio: "ignore" }).on("exit", resolve);
			}),
	);
	setTimeout(() => fs.writeFileSync(gate, "go"), 400);
	const exits = await Promise.all(pending);

	assert.deepEqual(
		exits,
		[0, 0, 0, 0, 0, 0, 0, 0],
		"every writer is served, none times out on the lock",
	);
	assert.deepEqual(L.verifyLedgerChain(lp), { intact: true, brokenAt: null, records: 8 });
});

// Hard links are what publish a lock file with its pid already inside. A filesystem
// without them must fall back to an exclusive create rather than failing every
// append, and the grace period on an unparseable lock is what keeps that fallback's
// empty-file window from being mistaken for a dead holder.
test("the lock is still claimed when hard links are unavailable", () => {
	const lp = raceDir("amber-anchor-nolink-");
	const realLink = fs.linkSync;
	fs.linkSync = () => {
		const error = new Error("hard links unsupported");
		error.code = "EPERM";
		throw error;
	};
	try {
		L.appendLedgerRecord(lp, { kind: "note", i: 1 });
	} finally {
		fs.linkSync = realLink;
	}

	assert.deepEqual(L.verifyLedgerChain(lp), { intact: true, brokenAt: null, records: 1 });
	assert.equal(fs.existsSync(`${lp}.lock`), false);
});

// The bound is on depth, never on path length. An earlier revision compared the
// guard path against a fixed length, so on an ordinary long repository path it
// refused at depth zero and a single crash stopped being self-healing. This pins
// recovery on a lock path long enough to have tripped that bound.
test("a long lock path does not change whether a stale lock is reclaimed", () => {
	const base = fs.mkdtempSync(path.join(os.tmpdir(), "amber-anchor-longpath-"));
	dirs.push(base);
	let dir = base;
	while (path.join(dir, "ledger.jsonl.lock").length <= 200) {
		dir = path.join(dir, "a-directory-name-of-some-length");
		fs.mkdirSync(dir, { recursive: true });
	}
	const lp = path.join(dir, "ledger.jsonl");
	assert.ok(
		`${lp}.lock`.length > 191,
		"the lock path must be long enough to have tripped the old bound",
	);
	fs.writeFileSync(`${lp}.lock`, String(deadPid()));

	L.appendLedgerRecord(lp, { kind: "note", i: 1 });

	assert.deepEqual(L.verifyLedgerChain(lp), { intact: true, brokenAt: null, records: 1 });
	assert.equal(fs.existsSync(`${lp}.lock`), false);
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
