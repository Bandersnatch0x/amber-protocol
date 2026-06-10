/**
 * Integration test harness — powers e2e scenario tests.
 *
 * Provides a session-aware harness that models a route pipeline
 * (plan → implement → verify) with built-in retry, manifest tracking,
 * and timeline logging.
 */

const path = require("path");
const fs = require("fs");
const { ensureDir, removeDir, readJSONL } = require("../../scripts/lib");
const { executeSession } = require("../../../scripts/lib/execution-engine");
const { createManifest } = require("../../../scripts/lib/session-manifest");
const { TimelineWriter } = require("../../../scripts/lib/timeline-writer");

const DEFAULT_WORK_DIR = path.resolve(
	__dirname,
	"..",
	"..",
	".tmp",
	"e2e-bugfix",
);

class IntegrationTestHarness {
	/**
	 * @param {object} [options]
	 * @param {string} [options.workDir] – working directory for the session
	 */
	constructor(options = {}) {
		this.workDir = options.workDir || DEFAULT_WORK_DIR;
		this.baseDir = path.dirname(this.workDir);
		this.retryCount = 0;
		this.success = false;
		this.manifest = null;
		this._timeline = [];
	}

	/** Create the work directory and reset session state. */
	setup() {
		ensureDir(this.workDir);
		this.retryCount = 0;
		this.success = false;
		this.manifest = null;
		this._timeline = [];
	}

	/** Remove the work directory. */
	teardown() {
		removeDir(this.workDir);
	}

	/** Alias for teardown. */
	cleanup() {
		this.teardown();
	}

	/**
	 * Start a new session: create session directory and manifest.
	 * @param {string} projectRoot
	 * @param {{ goal: string, budget?: number }} options
	 * @returns {{ sessionDir: string, manifest: object }}
	 */
	startSession(projectRoot, { goal, budget }) {
		const manifest = createManifest({
			route: { id: "test-e2e-route", version: "1.0.0" },
			goal,
			budget,
		});

		const sessionDir = path.join(
			projectRoot,
			".harness",
			"sessions",
			manifest.sessionId,
		);
		fs.mkdirSync(sessionDir, { recursive: true });

		const manifestPath = path.join(sessionDir, "manifest.json");
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

		const timelinePath = path.join(sessionDir, "timeline.jsonl");
		const writer = new TimelineWriter(timelinePath);
		writer.append({
			type: "session_created",
			data: { sessionId: manifest.sessionId, goal },
		});
		writer.close();

		return { sessionDir, manifest };
	}

	/**
	 * Run the full execution flow for a route.
	 * @param {string} sessionDir
	 * @param {object} manifest
	 * @param {{ routeId: string, stages: object[], gates?: object[] }} route
	 * @param {{ input?: import("stream").Readable }} [options]
	 * @returns {Promise<{success: boolean, stagesCompleted: number, reason?: string}>}
	 */
	async runFlow(sessionDir, manifest, route, options = {}) {
		const result = await executeSession(sessionDir, manifest, route, options);
		return result;
	}

	/**
	 * Run a route pipeline through the given stages.
	 *
	 * @param {object} stages
	 * @param {Function} [stages.plan]
	 * @param {Function} [stages.implement]
	 * @param {Function} [stages.verify]
	 * @param {object}  [stages.retryConfig] – { maxAttempts, backoffMs }
	 * @returns {Promise<{retryCount: number, success: boolean}>}
	 */
	async runRoute(stages) {
		this._timeline = [];
		this.retryCount = 0;
		this.success = false;

		const maxAttempts = stages.retryConfig?.maxAttempts ?? 1;
		const backoffMs = stages.retryConfig?.backoffMs ?? 0;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			// ── plan ──
			if (stages.plan) {
				this._pushEvent("plan", attempt + 1);
				await stages.plan(this);
			}

			// ── implement ──
			if (stages.implement) {
				this._pushEvent("implement", attempt + 1);
				await stages.implement(this);
			}

			// ── verify ──
			if (stages.verify) {
				this._pushEvent("verify", attempt + 1);
				try {
					await stages.verify(this);
					// verification passed
					this.success = true;
					this.retryCount = attempt; // zero-based count of actual retries
					this.manifest = {
						metadata: {
							retryCount: this.retryCount,
							success: true,
							totalAttempts: attempt + 1,
						},
						completedAt: new Date().toISOString(),
					};
					break;
				} catch (e) {
					this.retryCount = attempt + 1;
					this._pushEvent("retry_attempt", attempt + 1, { error: e.message });
					this.manifest = {
						metadata: {
							retryCount: this.retryCount,
							success: false,
							totalAttempts: attempt + 1,
						},
					};
					if (attempt >= maxAttempts - 1) {
						this.success = false;
						throw e;
					}
					if (backoffMs > 0) {
						await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
					}
				}
			}
		}

		return { retryCount: this.retryCount, success: this.success };
	}

	/**
	 * Persist the in-memory timeline to a JSONL file inside the work directory.
	 * @param {string} relativePath – e.g. 'timeline.jsonl'
	 */
	writeTimeline(relativePath) {
		const filePath = path.join(this.workDir, relativePath);
		ensureDir(path.dirname(filePath));
		const lines =
			this._timeline.map((e) => JSON.stringify(e)).join("\n") + "\n";
		fs.writeFileSync(filePath, lines);
	}

	/**
	 * Return the current session manifest (may be null before route completion).
	 * @returns {object|null}
	 */
	getManifest() {
		return this.manifest;
	}

	/**
	 * Read the written timeline file back from disk.
	 * @param {string} relativePath
	 * @returns {object[]}
	 */
	readTimeline(relativePath) {
		return readJSONL(path.join(this.workDir, relativePath));
	}

	/** @private */
	_pushEvent(event, attempt, extra = {}) {
		this._timeline.push({
			event,
			attempt,
			timestamp: new Date().toISOString(),
			...extra,
		});
	}
}

module.exports = { IntegrationTestHarness };
