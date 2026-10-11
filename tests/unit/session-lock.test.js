const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { acquireLock, releaseLock } = require("../../scripts/lib/session-lock");

describe("session-lock", () => {
	const testRoot = path.join(__dirname, "../fixtures/lock-test");
	const sessionId = "test-session";
	const lockPath = path.join(testRoot, ".amber", "sessions", sessionId, ".lock");

	beforeEach(() => {
		if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
		fs.mkdirSync(testRoot, { recursive: true });
	});

	afterEach(() => {
		if (fs.existsSync(testRoot)) fs.rmSync(testRoot, { recursive: true });
	});

	it("should acquire lock successfully", () => {
		const result = acquireLock(testRoot, sessionId);
		assert.strictEqual(result.success, true);
		assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, "utf8")).leaseId, result.leaseId);
	});

	it("should fail to acquire when already locked", () => {
		acquireLock(testRoot, sessionId);
		const result = acquireLock(testRoot, sessionId);
		assert.strictEqual(result.success, false);
		assert.ok(result.error.includes("locked"));
	});

	it("should release lock", () => {
		const held = acquireLock(testRoot, sessionId);
		releaseLock(testRoot, sessionId, held.leaseId);
		assert.strictEqual(fs.existsSync(lockPath), false);
	});

	it("should not be locked after release", () => {
		const held = acquireLock(testRoot, sessionId);
		releaseLock(testRoot, sessionId, held.leaseId);
		const result = acquireLock(testRoot, sessionId);
		assert.strictEqual(result.success, true);
	});

	it("grants the lock to exactly one of N concurrent acquirers (TOCTOU-safe)", () => {
		const { spawn } = require("node:child_process");
		const N = 10;
		const gateFile = path.join(testRoot, ".gate");
		const lockModule = require.resolve("../../scripts/lib/session-lock");
		// Each child spins on a gate file so all N reach acquireLock at the same
		// instant, then reports its result as JSON on stdout and stays alive, since a
		// lock whose holder exited is free.
		const script = [
			"const fs=require('fs');",
			`const {acquireLock}=require(${JSON.stringify(lockModule)});`,
			`const testRoot=${JSON.stringify(testRoot)};`,
			`const sessionId=${JSON.stringify(sessionId)};`,
			`const gate=${JSON.stringify(gateFile)};`,
			"while(!fs.existsSync(gate)){}",
			"const r=acquireLock(testRoot,sessionId);",
			"process.stdout.write(JSON.stringify(r));",
			"setTimeout(()=>{},2000);",
		].join("");

		const children = [];
		for (let i = 0; i < N; i++) {
			children.push(
				spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "inherit"] }),
			);
		}

		// Let all children reach the gate spin, then release them together.
		setTimeout(() => {
			try {
				fs.writeFileSync(gateFile, "go");
			} catch {
				// ignore
			}
		}, 200);

		return Promise.all(
			children.map(
				(child) =>
					new Promise((resolve, reject) => {
						let out = "";
						child.stdout.on("data", (d) => {
							out += d.toString();
						});
						child.on("error", reject);
						child.on("close", () => resolve(out));
					}),
			),
		).then((outputs) => {
			const parsed = outputs.map((out) => {
				try {
					return JSON.parse(out);
				} catch {
					return { success: false, _raw: out };
				}
			});
			const winners = parsed.filter((r) => r.success);
			assert.strictEqual(
				winners.length,
				1,
				`expected exactly 1 concurrent winner, got ${winners.length}: ${JSON.stringify(parsed)}`,
			);
		});
	});
});
