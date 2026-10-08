const { trackTempDir } = require("../helpers/harness");
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const LOCK_MODULE = require.resolve("../../scripts/lib/session-lock");
const { acquireLock, releaseLock } = require(LOCK_MODULE);

const SESSION = "s1";
const HOUR_AGO = Date.now() - 3_600_000;

function acquireInChild(root) {
	const script = `process.stdout.write(JSON.stringify(require(${JSON.stringify(LOCK_MODULE)}).acquireLock(${JSON.stringify(root)}, ${JSON.stringify(SESSION)})))`;
	const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
	return { pid: child.pid, result: JSON.parse(child.stdout) };
}

function deadPid() {
	return spawnSync(process.execPath, ["-e", ""]).pid;
}

describe("session lock lease", () => {
	let root;
	let lockPath;

	beforeEach(() => {
		root = trackTempDir(fs.mkdtempSync(path.join(os.tmpdir(), "amber-lease-")));
		lockPath = path.join(root, ".amber", "sessions", SESSION, ".lock");
	});

	function writeLock(body) {
		fs.mkdirSync(path.dirname(lockPath), { recursive: true });
		fs.writeFileSync(lockPath, typeof body === "string" ? body : JSON.stringify(body));
	}

	function ageLock() {
		const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
		writeLock({ ...lock, acquiredAt: new Date(HOUR_AGO).toISOString(), timestamp: HOUR_AGO });
	}

	it("refuses a second holder while the first holder runs, however old its lock is", () => {
		const first = acquireLock(root, SESSION);
		ageLock();

		const second = acquireInChild(root).result;

		assert.strictEqual(first.success, true);
		assert.deepStrictEqual(
			{ success: second.success, code: second.code },
			{ success: false, code: "AMBER_E_SESSION_LOCKED" },
		);
		assert.match(second.error, new RegExp(`pid ${process.pid}\\b`));
	});

	it("grants the lock when the recorded holder has exited", () => {
		const dead = acquireInChild(root);

		const next = acquireLock(root, SESSION);

		assert.strictEqual(dead.result.success, true);
		assert.strictEqual(next.success, true);
		assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid, process.pid);
	});

	it("keeps the current holder's lock when a former holder releases its lease", () => {
		const former = acquireInChild(root).result;
		const current = acquireLock(root, SESSION);

		releaseLock(root, SESSION, former.leaseId);

		assert.strictEqual(current.success, true);
		assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")).leaseId, current.leaseId);
		assert.strictEqual(acquireInChild(root).result.code, "AMBER_E_SESSION_LOCKED");
	});

	it("deletes the lock when its own lease releases it", () => {
		const held = acquireLock(root, SESSION);

		releaseLock(root, SESSION, held.leaseId);

		assert.strictEqual(fs.existsSync(lockPath), false);
	});

	// Windows deliberately has no process-identity probe (see processIdentity in
	// core/execution-handles.js): a platform that cannot name a start identity
	// cannot FALSIFY ownership, so a live pid with a mismatched recorded start
	// time is still treated as the holder and the lock is refused rather than
	// taken over. Both branches are asserted, so the residual is covered on every
	// platform instead of being skipped on one.
	it("handles a live pid whose recorded start identity cannot be verified", () => {
		writeLock({
			leaseId: "old",
			pid: process.pid,
			startTime: "1",
			acquiredAt: new Date().toISOString(),
		});

		const next = acquireLock(root, SESSION);

		if (process.platform === "win32") {
			assert.strictEqual(next.success, false);
			assert.strictEqual(next.code, "AMBER_E_SESSION_LOCKED");
			assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")).leaseId, "old");
			return;
		}
		assert.strictEqual(next.success, true);
		assert.notStrictEqual(next.leaseId, "old");
	});

	it("refuses a corrupt lock with a named error and leaves it in place", () => {
		writeLock("{not json");

		const result = acquireLock(root, SESSION);

		assert.deepStrictEqual(
			{ success: result.success, code: result.code },
			{ success: false, code: "AMBER_E_SESSION_LOCK_CORRUPT" },
		);
		assert.strictEqual(fs.readFileSync(lockPath, "utf8"), "{not json");
	});

	it("judges a trunk-format lock by its pid", () => {
		writeLock({ pid: process.pid, timestamp: HOUR_AGO });
		const whileAlive = acquireInChild(root).result;
		writeLock({ pid: deadPid(), timestamp: Date.now() });
		const afterExit = acquireLock(root, SESSION);

		assert.strictEqual(whileAlive.code, "AMBER_E_SESSION_LOCKED");
		assert.strictEqual(afterExit.success, true);
	});

	it("judges a lock without a pid by the old five-minute age", () => {
		writeLock({ timestamp: Date.now() });
		const fresh = acquireLock(root, SESSION);
		writeLock({ timestamp: HOUR_AGO });
		const aged = acquireLock(root, SESSION);

		assert.strictEqual(fresh.code, "AMBER_E_SESSION_LOCKED");
		assert.strictEqual(aged.success, true);
	});

	it("grants a dead holder's lock to exactly one of ten concurrent takers", async () => {
		writeLock({
			leaseId: "dead",
			pid: deadPid(),
			startTime: "1",
			acquiredAt: new Date().toISOString(),
		});
		const gate = path.join(root, ".gate");
		const script = [
			"const fs=require('fs');",
			`while(!fs.existsSync(${JSON.stringify(gate)})){}`,
			`const r=require(${JSON.stringify(LOCK_MODULE)}).acquireLock(${JSON.stringify(root)},${JSON.stringify(SESSION)});`,
			"process.stdout.write(JSON.stringify(r));",
			"setTimeout(()=>{},2000);",
		].join("");
		const outputs = Array.from({ length: 10 }, () => {
			const child = spawn(process.execPath, ["-e", script], {
				stdio: ["ignore", "pipe", "inherit"],
			});
			return new Promise((resolve) => {
				let out = "";
				child.stdout.on("data", (chunk) => {
					out += chunk;
				});
				child.on("close", () => resolve(JSON.parse(out)));
			});
		});
		setTimeout(() => fs.writeFileSync(gate, "go"), 300);

		const results = await Promise.all(outputs);

		assert.strictEqual(results.filter((r) => r.success).length, 1, JSON.stringify(results));
	});
});
