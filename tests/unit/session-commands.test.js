const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
	startSession,
	statusSession,
	listSessions,
	abortSession,
} = require("../../scripts/lib/session-commands");

const TEST_ROOT = path.join(__dirname, "../fixtures/session-test-repo");

function removeTestRoot(dir) {
	if (!fs.existsSync(dir)) return;
	fs.rmSync(dir, {
		recursive: true,
		force: true,
		maxRetries: 10,
		retryDelay: 100,
	});
}

function cleanupTestRoot(dir) {
	if (!fs.existsSync(dir)) return;
	const worktreesDir = path.join(dir, ".amber", "worktrees");
	if (fs.existsSync(worktreesDir)) {
		for (const name of fs.readdirSync(worktreesDir)) {
			const worktreePath = path.join(worktreesDir, name);
			if (fs.statSync(worktreePath).isDirectory()) {
				spawnSync("git", ["worktree", "remove", worktreePath, "--force"], {
					cwd: dir,
					encoding: "utf8",
				});
			}
		}
	}
	removeTestRoot(dir);
}

describe("session-commands", () => {
	beforeEach(() => {
		cleanupTestRoot(TEST_ROOT);
		fs.mkdirSync(TEST_ROOT, { recursive: true });

		spawnSync("git", ["init"], { cwd: TEST_ROOT });
		spawnSync("git", ["config", "user.name", "Test"], { cwd: TEST_ROOT });
		spawnSync("git", ["config", "user.email", "test@test.com"], {
			cwd: TEST_ROOT,
		});
		fs.writeFileSync(path.join(TEST_ROOT, "README.md"), "# Test\n");
		spawnSync("git", ["add", "."], { cwd: TEST_ROOT });
		spawnSync("git", ["commit", "-m", "Initial"], { cwd: TEST_ROOT });
	});

	afterEach(() => {
		cleanupTestRoot(TEST_ROOT);
	});

	describe("startSession", () => {
		it("creates a new session with manifest and timeline", async () => {
			const result = await startSession(TEST_ROOT, {
				goal: "test feature",
				route: "feature-standard",
			});

			assert.strictEqual(result.exitCode, 0);
			assert.ok(result.sessionId);

			const sessionDir = path.join(
				TEST_ROOT,
				".amber",
				"sessions",
				result.sessionId,
			);
			assert.ok(fs.existsSync(path.join(sessionDir, "manifest.json")));
			assert.ok(fs.existsSync(path.join(sessionDir, "timeline.jsonl")));
		});

		it("writes a valid manifest with created status", async () => {
			const result = await startSession(TEST_ROOT, {
				goal: "test",
				route: "feature-standard",
			});

			const manifestPath = path.join(
				TEST_ROOT,
				".amber",
				"sessions",
				result.sessionId,
				"manifest.json",
			);
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

			assert.strictEqual(manifest.status, "created");
			assert.strictEqual(manifest.goal, "test");
			assert.strictEqual(manifest.route.id, "feature-standard");
		});

		it("creates continuity surfaces and references them in the manifest", async () => {
			const result = await startSession(TEST_ROOT, {
				goal: "test continuity",
				route: "feature-standard",
			});

			const manifestPath = path.join(
				TEST_ROOT,
				".amber",
				"sessions",
				result.sessionId,
				"manifest.json",
			);
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

			assert.ok(manifest.continuitySurfaces);
			assert.strictEqual(manifest.continuitySurfaces.memory, "MEMORY.md");
			assert.strictEqual(manifest.continuitySurfaces.notes, "notes.md");
			assert.ok(fs.existsSync(path.join(TEST_ROOT, "MEMORY.md")));
			assert.ok(fs.existsSync(path.join(TEST_ROOT, "notes.md")));
			assert.ok(fs.existsSync(path.join(TEST_ROOT, "tasks", "README.md")));
		});

		it("auto-selects route when not specified", async () => {
			const result = await startSession(TEST_ROOT, {
				goal: "fix the login bug",
			});

			assert.strictEqual(result.exitCode, 0);

			const manifestPath = path.join(
				TEST_ROOT,
				".amber",
				"sessions",
				result.sessionId,
				"manifest.json",
			);
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

			assert.ok(manifest.route.id);
		});

		it("creates worktree when requested", async () => {
			const result = await startSession(TEST_ROOT, {
				goal: "test",
				route: "feature-standard",
				worktree: true,
			});

			assert.strictEqual(result.exitCode, 0);

			const worktreePath = path.join(
				TEST_ROOT,
				".amber",
				"worktrees",
				result.sessionId,
			);
			assert.ok(fs.existsSync(worktreePath));
		});

		it("returns error when goal is missing", async () => {
			const result = await startSession(TEST_ROOT, {});

			assert.notEqual(result.exitCode, 0);
			assert.ok(result.text.includes("goal"));
		});
	});

	describe("statusSession", () => {
		it("shows status of the most recent session when no ID given", async () => {
			const start = await startSession(TEST_ROOT, {
				goal: "test",
				route: "feature-standard",
			});

			const result = statusSession(TEST_ROOT, {});

			assert.strictEqual(result.exitCode, 0);
			assert.ok(result.text.includes(start.sessionId));
			assert.ok(result.text.includes("created"));
		});

		it("shows status of a specific session by ID", async () => {
			const start = await startSession(TEST_ROOT, {
				goal: "test",
				route: "feature-standard",
			});

			const result = statusSession(TEST_ROOT, { sessionId: start.sessionId });

			assert.strictEqual(result.exitCode, 0);
			assert.ok(result.text.includes("test"));
		});

		it("returns error when session not found", () => {
			const result = statusSession(TEST_ROOT, { sessionId: "does-not-exist" });

			assert.notEqual(result.exitCode, 0);
			assert.ok(result.text.includes("not found"));
		});
	});

	describe("listSessions", () => {
		it("lists all sessions in reverse chronological order", async () => {
			await startSession(TEST_ROOT, {
				goal: "first",
				route: "feature-standard",
			});
			await startSession(TEST_ROOT, { goal: "second", route: "bugfix-quick" });

			const result = listSessions(TEST_ROOT, {});

			assert.strictEqual(result.exitCode, 0);
			assert.ok(result.text.includes("first"));
			assert.ok(result.text.includes("second"));
		});

		it("shows empty message when no sessions exist", () => {
			const result = listSessions(TEST_ROOT, {});

			assert.strictEqual(result.exitCode, 0);
			assert.ok(result.text.includes("No sessions"));
		});
	});

	describe("abortSession", () => {
		it("sets session status to aborted", async () => {
			const start = await startSession(TEST_ROOT, {
				goal: "test",
				route: "feature-standard",
			});

			const result = await abortSession(TEST_ROOT, {
				sessionId: start.sessionId,
			});

			assert.strictEqual(result.exitCode, 0);

			const manifestPath = path.join(
				TEST_ROOT,
				".amber",
				"sessions",
				start.sessionId,
				"manifest.json",
			);
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

			assert.strictEqual(manifest.status, "aborted");
		});

		it("writes abort event to timeline", async () => {
			const start = await startSession(TEST_ROOT, {
				goal: "test",
				route: "feature-standard",
			});

			await abortSession(TEST_ROOT, { sessionId: start.sessionId });

			const timelinePath = path.join(
				TEST_ROOT,
				".amber",
				"sessions",
				start.sessionId,
				"timeline.jsonl",
			);
			const timeline = fs.readFileSync(timelinePath, "utf8");

			assert.ok(timeline.includes("session_aborted"));
		});

		it("returns error when session ID missing", async () => {
			const result = await abortSession(TEST_ROOT, {});

			assert.notEqual(result.exitCode, 0);
		});
	});
});
