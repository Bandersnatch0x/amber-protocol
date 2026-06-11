"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { resolveStateDirForRead, resolveStateDirForCreate } = require("./state-dir-resolver");

function createWorktree(projectRoot, sessionId) {
	const worktreePath = path.join(
		resolveStateDirForCreate(projectRoot),
		"worktrees",
		sessionId,
	);

	const currentBranchResult = spawnSync("git", ["branch", "--show-current"], {
		cwd: projectRoot,
		encoding: "utf8",
	});

	if (currentBranchResult.status !== 0) {
		return {
			success: false,
			error: "Not a git repository or no current branch",
		};
	}

	const baseBranch = currentBranchResult.stdout.trim();
	const worktreeBranch = `harness-session-${sessionId}`;

	const addResult = spawnSync(
		"git",
		["worktree", "add", "-b", worktreeBranch, worktreePath, baseBranch],
		{ cwd: projectRoot, encoding: "utf8" },
	);

	if (addResult.status !== 0) {
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
	const worktreePath = path.join(
		resolveStateDirForRead(projectRoot),
		"worktrees",
		sessionId,
	);

	if (!fs.existsSync(worktreePath)) {
		return {
			success: false,
			error: `Worktree not found: ${worktreePath}`,
		};
	}

	const removeResult = spawnSync(
		"git",
		["worktree", "remove", worktreePath, "--force"],
		{
			cwd: projectRoot,
			encoding: "utf8",
		},
	);

	if (removeResult.status !== 0) {
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
	const listResult = spawnSync("git", ["worktree", "list", "--porcelain"], {
		cwd: projectRoot,
		encoding: "utf8",
	});

	if (listResult.status !== 0) {
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
