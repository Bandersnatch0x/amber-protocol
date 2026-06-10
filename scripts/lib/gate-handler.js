"use strict";

const readline = require("readline");

function createGateContext(manifest, sessionData = {}) {
	return {
		budget: manifest.budget || { used: 0, total: Infinity },
		stage: manifest.currentStage,
		completedStages: manifest.completedStages || [],
		...sessionData,
	};
}

async function promptUser(question, inputStream) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({
			input: inputStream || process.stdin,
			output: process.stdout,
		});
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim().toLowerCase());
		});
	});
}

function checkAutoCondition(condition, context) {
	if (condition.budgetOk !== undefined) {
		const { used, total } = context.budget;
		return used < total;
	}
	return true;
}

async function checkGate(gate, context = {}, options = {}) {
	const { type, description, condition } = gate;

	if (type === "auto") {
		const passed = checkAutoCondition(condition || {}, context);
		return { passed, gateId: gate.id, type };
	}

	if (type === "user-approval") {
		const prompt = (description || "Proceed to next stage?") + " (yes/no): ";
		const answer = await promptUser(prompt, options.input);
		const passed = answer === "yes" || answer === "y";
		return { passed, gateId: gate.id, type, userInput: answer };
	}

	if (type === "step-confirm") {
		const prompt = (description || "Continue?") + " (y/n): ";
		const answer = await promptUser(prompt, options.input);
		const passed = answer === "y" || answer === "yes";
		return { passed, gateId: gate.id, type, userInput: answer };
	}

	return {
		passed: false,
		gateId: gate.id,
		error: `Unknown gate type: ${type}`,
	};
}

module.exports = { checkGate, createGateContext, promptUser };
