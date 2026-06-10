"use strict";

const { spawnSync } = require("child_process");

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

module.exports = { executeStage, executeStages, executeCommand };
