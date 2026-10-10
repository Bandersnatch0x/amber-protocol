const { trackTempDir } = require("../helpers/harness");
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const { processIdentity } = require("../../scripts/lib/core/execution-handles");
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
	it("handles a live pid whose recorded start identity does not match", () => {
		writeLock({
			leaseId: "old",
			pid: process.pid,
			startTime: "1",
			acquiredAt: new Date().toISOString(),
		});

		const next = acquireLock(root, SESSION);

		// Branch on what the product branches on: whether this platform can name a process
		// identity at all, not on the platform name.
		if (processIdentity(process.pid) === null) {
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

	// The takeover chain is bounded, so a crash inside a guard of a guard leaves files
	// nothing can reclaim. The refusal has to name them: the code cannot clear them
	// itself, and "locked by pid N" would name a process that is already dead.
	it("names the files when the takeover chain is too deep to unwind", () => {
		const lease = (id) => ({
			leaseId: id,
			pid: deadPid(),
			startTime: "1",
			acquiredAt: new Date(HOUR_AGO).toISOString(),
		});
		const guardName = (of) =>
			`.lock.takeover-${crypto.createHash("sha256").update(of).digest("hex").slice(0, 16)}`;

		const lockRaw = JSON.stringify(lease("old"));
		writeLock(lockRaw);
		const dir = path.dirname(lockPath);
		const guardOne = path.join(dir, guardName(lockRaw));
		const guardOneRaw = JSON.stringify(lease("taker"));
		fs.writeFileSync(guardOne, guardOneRaw);
		const guardTwo = path.join(
			dir,
			`${path.basename(guardOne)}.takeover-${crypto.createHash("sha256").update(guardOneRaw).digest("hex").slice(0, 16)}`,
		);
		fs.writeFileSync(guardTwo, JSON.stringify(lease("taker of the taker")));

		const result = acquireLock(root, SESSION);

		assert.strictEqual(result.success, false);
		assert.strictEqual(result.code, "AMBER_E_SESSION_LOCK_STUCK");
		const named = result.error
			.split("; if no amber session command is running, remove ")
			.pop()
			.split(", ");
		assert.deepStrictEqual(named, [lockPath, guardOne, guardTwo]);
	});

	// A guard held by a process whose identity can be checked is genuinely another live
	// process, so the refusal must name that process, not the dead holder of the lock.
	// Where the identity cannot be checked, as on Windows, the pid may be recycled and
	// nothing would ever release it, so the refusal has to keep the manual-removal
	// remedy instead of telling the operator to wait.
	it("does not name the dead lock holder when a guard is held", () => {
		const lockRaw = JSON.stringify({
			leaseId: "gone",
			pid: deadPid(),
			startTime: "1",
			acquiredAt: new Date(HOUR_AGO).toISOString(),
		});
		writeLock(lockRaw);
		const guardPath = `${lockPath}.takeover-${crypto.createHash("sha256").update(lockRaw).digest("hex").slice(0, 16)}`;
		// The guard must read as a genuine live holder, which needs the recorded start
		// identity to match where the platform can name one. A made-up identity makes the
		// guard stale on Linux, so it is reclaimed and the lock is granted instead.
		fs.writeFileSync(
			guardPath,
			JSON.stringify({
				leaseId: "live",
				pid: process.pid,
				startTime: processIdentity(process.pid) ?? "1",
				acquiredAt: new Date().toISOString(),
			}),
		);

		const result = acquireLock(root, SESSION);

		assert.strictEqual(result.success, false);
		const dead = JSON.parse(lockRaw).pid;
		assert.ok(
			!new RegExp(`locked by pid ${dead}\\b`).test(result.error),
			`the refusal must not present the dead holder as the live one: ${result.error}`,
		);
		if (processIdentity(process.pid) === null) {
			assert.strictEqual(result.code, "AMBER_E_SESSION_LOCK_STUCK");
			assert.ok(result.error.includes(guardPath), "the manual-removal remedy must name the guard");
		} else {
			assert.strictEqual(result.code, "AMBER_E_SESSION_LOCKED");
			assert.ok(
				result.error.includes(`pid ${process.pid}`),
				"the refusal must name the live guard holder",
			);
		}
	});
});
