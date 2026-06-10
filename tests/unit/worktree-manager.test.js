const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
	createWorktree,
	removeWorktree,
	listWorktrees,
} = require("../../scripts/lib/worktree-manager");

const TEST_ROOT = path.join(__dirname, "../fixtures/worktree-test-repo");
const SESSION_ID = "test-session-123";

describe("worktree-manager", () => {
	beforeEach(() => {
		if (fs.existsSync(TEST_ROOT)) {
			fs.rmSync(TEST_ROOT, { recursive: true, force: true });
		}
		fs.mkdirSync(TEST_ROOT, { recursive: true });

		spawnSync("git", ["init"], { cwd: TEST_ROOT });
		spawnSync("git", ["config", "user.name", "Test"], { cwd: TEST_ROOT });
		spawnSync("git", ["config", "user.email", "test@test.com"], {
			cwd: TEST_ROOT,
		});

		fs.writeFileSync(path.join(TEST_ROOT, "README.md"), "# Test\n");
		spawnSync("git", ["add", "."], { cwd: TEST_ROOT });
		spawnSync("git", ["commit", "-m", "Initial commit"], { cwd: TEST_ROOT });
	});

	afterEach(() => {
		if (fs.existsSync(TEST_ROOT)) {
			fs.rmSync(TEST_ROOT, { recursive: true, force: true });
		}
	});

	it("creates a worktree in .harness/worktrees/<session-id>", () => {
		const result = createWorktree(TEST_ROOT, SESSION_ID);
		assert.strictEqual(result.success, true);

		const worktreePath = path.join(
			TEST_ROOT,
			".harness",
			"worktrees",
			SESSION_ID,
		);
		assert.ok(fs.existsSync(worktreePath));
		assert.ok(fs.existsSync(path.join(worktreePath, "README.md")));
	});

	it("returns the worktree path on success", () => {
		const result = createWorktree(TEST_ROOT, SESSION_ID);
		assert.ok(
			result.path.endsWith(path.join(".harness", "worktrees", SESSION_ID)),
		);
	});

	it("creates worktree based on current branch", () => {
		spawnSync("git", ["checkout", "-b", "feature-branch"], { cwd: TEST_ROOT });

		const result = createWorktree(TEST_ROOT, SESSION_ID);
		assert.strictEqual(result.success, true);
		assert.strictEqual(result.baseBranch, "feature-branch");
	});

	it("removes a worktree and cleans up directories", () => {
		createWorktree(TEST_ROOT, SESSION_ID);
		const worktreePath = path.join(
			TEST_ROOT,
			".harness",
			"worktrees",
			SESSION_ID,
		);

		const result = removeWorktree(TEST_ROOT, SESSION_ID);
		assert.strictEqual(result.success, true);
		assert.strictEqual(fs.existsSync(worktreePath), false);
	});

	it("lists active worktrees", () => {
		createWorktree(TEST_ROOT, SESSION_ID);

		const worktrees = listWorktrees(TEST_ROOT);
		assert.ok(Array.isArray(worktrees));
		assert.ok(worktrees.some((w) => w.includes(SESSION_ID)));
	});

	it("returns error when creating worktree in non-git directory", () => {
		const os = require("os");
		const nonGitDir = path.join(
			os.tmpdir(),
			"harness-non-git-test-" + Date.now(),
		);
		fs.mkdirSync(nonGitDir, { recursive: true });

		try {
			const result = createWorktree(nonGitDir, SESSION_ID);
			assert.strictEqual(result.success, false);
			assert.ok(result.error);
		} finally {
			fs.rmSync(nonGitDir, { recursive: true, force: true });
		}
	});

	it("returns error when removing non-existent worktree", () => {
		const result = removeWorktree(TEST_ROOT, "does-not-exist");
		assert.strictEqual(result.success, false);
	});
});
