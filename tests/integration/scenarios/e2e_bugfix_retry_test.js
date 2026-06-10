/**
 * E2E bugfix retry tests
 *
 * Verifies the retry loop: route-stage retries on verification failure,
 * the RetryConfig helper, session-state tracking, and timeline event logging.
 *
 * Node.js CommonJS – runs with `node --test`.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const { ensureDir, removeDir } = require("../../scripts/lib");
const { IntegrationTestHarness } = require("./test-harness");

// ── RetryConfig (defined here per spec, exported for consumers) ──────────

class RetryConfig {
	/**
	 * @param {number} [maxAttempts=3]
	 * @param {number} [backoffMs=100]
	 */
	constructor(maxAttempts = 3, backoffMs = 100) {
		this.maxAttempts = maxAttempts;
		this.backoffMs = backoffMs;
		this.currentAttempt = 0;
	}

	/**
	 * Execute `fn`, retrying on failure up to `maxAttempts` times with
	 * linear backoff (`backoffMs * currentAttempt`).
	 *
	 * @template T
	 * @param {() => Promise<T>} fn
	 * @returns {Promise<T>}
	 */
	async execute(fn) {
		while (this.currentAttempt < this.maxAttempts) {
			this.currentAttempt++;
			try {
				return await fn();
			} catch (e) {
				if (this.currentAttempt >= this.maxAttempts) throw e;
				await new Promise((r) =>
					setTimeout(r, this.backoffMs * this.currentAttempt),
				);
			}
		}
	}
}

// ── Test helpers ─────────────────────────────────────────────────────────

const WORK_DIR = path.resolve(__dirname, "..", "..", ".tmp", "e2e-bugfix");

/** Clean slate before each test. */
function setupCleanDir() {
	removeDir(WORK_DIR);
	ensureDir(WORK_DIR);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("E2E Bugfix Retry", { concurrency: false }, () => {
	// ── 1. retries implementation on verification failure ──────────────────

	it("retries implementation on verification failure", async () => {
		setupCleanDir();
		const harness = new IntegrationTestHarness({ workDir: WORK_DIR });
		harness.setup();

		// Counter closure — verify fails first call, succeeds second
		let verifyCalls = 0;
		const stages = {
			plan: async () => {
				/* no-op */
			},
			implement: async () => {
				/* no-op */
			},
			verify: async () => {
				verifyCalls++;
				if (verifyCalls === 1) {
					throw new Error("verification failed – simulated");
				}
				// second call succeeds
			},
			retryConfig: { maxAttempts: 3, backoffMs: 10 },
		};

		const result = await harness.runRoute(stages);

		assert.strictEqual(
			result.retryCount,
			1,
			"retryCount should be 1 (one retry, zero-based count of actual retries)",
		);
		assert.strictEqual(
			result.success,
			true,
			"final success should be true after retry",
		);
		assert.strictEqual(
			verifyCalls,
			2,
			"verify should have been called exactly twice (fail + success)",
		);

		harness.writeTimeline("timeline.jsonl");
		harness.teardown();
	});

	// ── 2. RetryConfig class supports max_attempts and backoff ─────────────

	describe("RetryConfig", () => {
		it("stops at maxAttempts and throws the last error", async () => {
			let calls = 0;
			const rc = new RetryConfig(3, 10);

			let thrown = null;
			try {
				await rc.execute(async () => {
					calls++;
					throw new Error("always fails");
				});
			} catch (e) {
				thrown = e;
			}

			assert.ok(thrown, "should have thrown after exhausting attempts");
			assert.strictEqual(thrown.message, "always fails");
			assert.strictEqual(
				calls,
				3,
				"fn should be called exactly maxAttempts times",
			);
			assert.strictEqual(
				rc.currentAttempt,
				3,
				"currentAttempt should equal maxAttempts",
			);
		});

		it("backoff delay scales linearly with currentAttempt", async () => {
			const rc = new RetryConfig(3, 30);
			let calls = 0;
			const timestamps = [];

			try {
				await rc.execute(async () => {
					timestamps.push(Date.now());
					calls++;
					throw new Error("fail");
				});
			} catch {
				// expected
			}

			assert.strictEqual(calls, 3);

			// Measure inter-call gaps
			const gap1 = timestamps[1] - timestamps[0];
			const gap2 = timestamps[2] - timestamps[1];

			// First retry delay ≈ backoffMs * 1 = 30ms (allow ±30ms tolerance)
			assert.ok(
				gap1 >= 20 && gap1 <= 80,
				`first backoff delay ~30ms, got ${gap1}ms`,
			);
			// Second retry delay ≈ backoffMs * 2 = 60ms
			assert.ok(
				gap2 >= 40 && gap2 <= 110,
				`second backoff delay ~60ms, got ${gap2}ms`,
			);
			// Second gap should be larger than first (linear scaling)
			assert.ok(
				gap2 > gap1,
				`second gap (${gap2}ms) should be larger than first (${gap1}ms)`,
			);
		});

		it("succeeds on first attempt without retry", async () => {
			const rc = new RetryConfig(3, 100);
			let calls = 0;

			const result = await rc.execute(async () => {
				calls++;
				return "ok";
			});

			assert.strictEqual(result, "ok");
			assert.strictEqual(calls, 1);
			assert.strictEqual(rc.currentAttempt, 1);
		});

		it("defaults to maxAttempts=3, backoffMs=100", () => {
			const rc = new RetryConfig();
			assert.strictEqual(rc.maxAttempts, 3);
			assert.strictEqual(rc.backoffMs, 100);
			assert.strictEqual(rc.currentAttempt, 0);
		});
	});

	// ── 3. tracks retry count in session state ─────────────────────────────

	it("tracks retry count in session state", async () => {
		setupCleanDir();
		const harness = new IntegrationTestHarness({ workDir: WORK_DIR });
		harness.setup();

		let verifyCalls = 0;
		const stages = {
			plan: async () => {},
			implement: async () => {},
			verify: async () => {
				verifyCalls++;
				if (verifyCalls === 1) throw new Error("first verify fail");
				if (verifyCalls === 2) throw new Error("second verify fail");
				// third succeeds
			},
			retryConfig: { maxAttempts: 4, backoffMs: 10 },
		};

		await harness.runRoute(stages);
		const manifest = harness.getManifest();

		assert.ok(manifest, "manifest should be populated after route completion");
		assert.ok(manifest.metadata, "manifest should have metadata");
		assert.strictEqual(
			manifest.metadata.retryCount,
			2,
			"retryCount should be 2 after two retries",
		);
		assert.strictEqual(manifest.metadata.success, true);
		assert.strictEqual(manifest.metadata.totalAttempts, 3);

		harness.writeTimeline("timeline.jsonl");
		harness.teardown();
	});

	// ── 4. logs retry events to timeline ───────────────────────────────────

	it("logs retry events to timeline", async () => {
		setupCleanDir();
		const harness = new IntegrationTestHarness({ workDir: WORK_DIR });
		harness.setup();

		let verifyCalls = 0;
		const stages = {
			plan: async () => {},
			implement: async () => {},
			verify: async () => {
				verifyCalls++;
				if (verifyCalls <= 2) throw new Error(`fail #${verifyCalls}`);
			},
			retryConfig: { maxAttempts: 5, backoffMs: 5 },
		};

		await harness.runRoute(stages);
		harness.writeTimeline("timeline.jsonl");

		const timeline = harness.readTimeline("timeline.jsonl");
		assert.ok(timeline.length > 0, "timeline should not be empty");

		// Count retry_attempt events
		const retryEvents = timeline.filter((e) => e.event === "retry_attempt");
		assert.strictEqual(
			retryEvents.length,
			2,
			"timeline should contain exactly 2 retry_attempt events",
		);

		// Verify each retry_attempt has expected shape
		for (const evt of retryEvents) {
			assert.ok(evt.timestamp, "retry_attempt event must have timestamp");
			assert.ok(
				typeof evt.attempt === "number",
				"retry_attempt event must have attempt number",
			);
			assert.ok(
				typeof evt.error === "string",
				"retry_attempt event must have error string",
			);
		}

		// Verify event sequence: plan → implement → verify → retry_attempt (x2) → plan → implement → verify (success)
		assert.strictEqual(timeline[0].event, "plan");
		assert.strictEqual(timeline[1].event, "implement");
		assert.strictEqual(timeline[2].event, "verify");
		assert.strictEqual(timeline[3].event, "retry_attempt");
		assert.strictEqual(timeline[4].event, "plan");
		assert.strictEqual(timeline[5].event, "implement");
		assert.strictEqual(timeline[6].event, "verify");
		assert.strictEqual(timeline[7].event, "retry_attempt");
		assert.strictEqual(timeline[8].event, "plan");
		assert.strictEqual(timeline[9].event, "implement");
		assert.strictEqual(timeline[10].event, "verify");

		harness.teardown();
	});

	// ── Clean-up guard ─────────────────────────────────────────────────────

	afterEach(() => {
		removeDir(WORK_DIR);
	});
});

// Export RetryConfig so other modules can consume it
module.exports = { RetryConfig };
