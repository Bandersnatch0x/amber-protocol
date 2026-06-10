"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { saveCheckpoint } = require("./checkpoint-manager");

function executeCommand(command, options = {}) {
	const result = spawnSync(command, {
		shell: true,
		encoding: "utf8",
		cwd: options.cwd || process.cwd(),
	});
	return {
		success: result.status === 0,
		stdout: result.stdout || "",
		stderr: result.stderr || "",
		exitCode: result.status,
	};
}

async function executeStage(stage, options = {}) {
	const { type, name, target } = stage;

	if (type === "command") {
		const result = executeCommand(target, options);
		return {
			success: result.success,
			stage: name,
			type,
			output: result.stdout,
			error: result.stderr,
		};
	}

	if (type === "pack") {
		return {
			success: true,
			stage: name,
			type,
			message: `Pack execution placeholder: ${target}`,
		};
	}

	if (type === "skill") {
		return {
			success: true,
			stage: name,
			type,
			message: `Skill execution placeholder: ${target}`,
		};
	}

	return {
		success: false,
		stage: name,
		type,
		error: `Unknown stage type: ${type}`,
	};
}

async function executeStages(stages, options, shouldContinue) {
	const results = [];
	for (const stage of stages) {
		if (!shouldContinue()) break;
		const result = await executeStage(stage, options);
		results.push(result);
		if (!result.success && !stage.optional) break;
	}
	return results;
}

function getWorktreeState(projectRoot, sessionId) {
	const { execSync } = require("child_process");
	const worktreePath = path.join(
		projectRoot,
		".harness",
		"worktrees",
		sessionId,
	);

	if (!fs.existsSync(worktreePath)) {
		return { branch: null, commit: null, uncommittedFiles: [] };
	}

	try {
		const branch = execSync("git rev-parse --abbrev-ref HEAD", {
			cwd: worktreePath,
			encoding: "utf8",
		}).trim();
		const commit = execSync("git rev-parse HEAD", {
			cwd: worktreePath,
			encoding: "utf8",
		}).trim();
		const statusOutput = execSync("git status --porcelain", {
			cwd: worktreePath,
			encoding: "utf8",
		});
		const uncommittedFiles = statusOutput
			? statusOutput
					.trim()
					.split("\n")
					.map((line) => line.substring(3))
			: [];

		return { branch, commit, uncommittedFiles };
	} catch {
		return { branch: null, commit: null, uncommittedFiles: [] };
	}
}

async function executeStagesWithCheckpoints(
	stages,
	projectRoot,
	sessionId,
	manifest,
	options,
	shouldContinue,
) {
	const results = [];
	const updatedManifest = JSON.parse(JSON.stringify(manifest));
	updatedManifest.completedStages = updatedManifest.completedStages || [];

	for (let i = 0; i < stages.length; i++) {
		const stage = stages[i];

		if (!shouldContinue()) break;

		const worktreeState = getWorktreeState(projectRoot, sessionId);
		saveCheckpoint(
			projectRoot,
			sessionId,
			`${stage.name}-before`,
			updatedManifest,
			worktreeState,
		);

		const result = await executeStage(stage, options);
		results.push(result);

		if (result.success) {
			updatedManifest.completedStages = [
				...updatedManifest.completedStages,
				stage.name,
			];
			updatedManifest.currentStage = stages[i + 1]?.name || null;
		}

		saveCheckpoint(
			projectRoot,
			sessionId,
			stage.name,
			updatedManifest,
			worktreeState,
		);

		if (!result.success && !stage.optional) break;
	}

	return results;
}

module.exports = {
	executeStage,
	executeStages,
	executeStagesWithCheckpoints,
	executeCommand,
	getWorktreeState,
};
