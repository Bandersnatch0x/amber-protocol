"use strict";

const fs = require("fs");
const path = require("path");
const { resolveStateDirForRead, resolveStateDirForCreate } = require("./state-dir-resolver");
const { gitExec } = require("./core/git-exec");
const { resolvePathWithin } = require("./core/fs-utils");

function worktreePathFor(projectRoot, sessionId, { create = false } = {}) {
	const stateDir = create
		? resolveStateDirForCreate(projectRoot)
		: resolveStateDirForRead(projectRoot);
	// Resolve from the project root, rather than treating the state directory as
	// a trusted root: `.amber` itself may be a symlink to an external tree.
	const candidate = path.join(path.relative(projectRoot, stateDir), "worktrees", String(sessionId));
	return resolvePathWithin(projectRoot, candidate, { label: "Worktree path" });
}

function createWorktree(projectRoot, sessionId) {
	let worktreePath;
	try {
		worktreePath = worktreePathFor(projectRoot, sessionId, true);
	} catch (error) {
		return { success: false, error: error.message };
	}

	const currentBranchResult = gitExec(projectRoot, ["branch", "--show-current"]);

	if (!currentBranchResult.ok) {
		return {
			success: false,
			error: "Not a git repository or no current branch",
		};
	}

	const baseBranch = currentBranchResult.stdout;
	const worktreeBranch = `harness-session-${sessionId}`;

	const addResult = gitExec(projectRoot, [
		"worktree",
		"add",
		"-b",
		worktreeBranch,
		worktreePath,
		baseBranch,
	]);

	if (!addResult.ok) {
		return {
			success: false,
			error: addResult.stderr || "Failed to create worktree",
		};
	}

	return {
		success: true,
		path: worktreePath,
		branch: worktreeBranch,
		baseBranch,
	};
}

function removeWorktree(projectRoot, sessionId) {
	let worktreePath;
	try {
		worktreePath = worktreePathFor(projectRoot, sessionId);
	} catch (error) {
		return { success: false, error: error.message };
	}

	if (!fs.existsSync(worktreePath)) {
		return {
			success: false,
			error: `Worktree not found: ${worktreePath}`,
		};
	}

	const removeResult = gitExec(projectRoot, ["worktree", "remove", worktreePath, "--force"]);

	if (!removeResult.ok) {
		return {
			success: false,
			error: removeResult.stderr || "Failed to remove worktree",
		};
	}

	if (fs.existsSync(worktreePath)) {
		fs.rmSync(worktreePath, { recursive: true, force: true });
	}

	return { success: true };
}

function listWorktrees(projectRoot) {
	const listResult = gitExec(projectRoot, ["worktree", "list", "--porcelain"]);

	if (!listResult.ok) {
		return [];
	}

	const lines = listResult.stdout.split("\n");
	const worktrees = [];

	for (const line of lines) {
		if (line.startsWith("worktree ")) {
			worktrees.push(line.substring("worktree ".length));
		}
	}

	return worktrees;
}

module.exports = { createWorktree, removeWorktree, listWorktrees };
