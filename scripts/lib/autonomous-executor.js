"use strict";

const fs = require("fs");
const path = require("path");
const { executeSession } = require("./execution-engine");
const {
	loadPolicy,
	shouldAutoApproveGate,
	getRetryConfig,
	getBudgetPolicy,
} = require("./autonomous-policy");
const { loadRoutes } = require("./route-loader");
const { TimelineWriter } = require("./timeline-writer");

async function executeAutonomous(projectRoot, sessionId, options = {}) {
	const sessionDir = path.join(projectRoot, ".harness", "sessions", sessionId);
	const manifestPath = path.join(sessionDir, "manifest.json");

	if (!fs.existsSync(manifestPath)) {
		return { success: false, exitCode: 1, error: "Session not found" };
	}

	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
	const policy = loadPolicy(projectRoot);

	const routesDir = path.join(projectRoot, "routes");
	if (!fs.existsSync(routesDir)) {
		return { success: false, exitCode: 1, error: "Routes directory not found" };
	}

	const { routes } = loadRoutes(routesDir);
	const route = routes.find((r) => r.routeId === manifest.route.id);

	if (!route) {
		return { success: false, exitCode: 1, error: "Route not found" };
	}

	// Handle budget exceeded simulation
	if (options.simulateBudgetExceeded) {
		return { success: false, exitCode: 2, reason: "paused" };
	}

	const retryConfig = getRetryConfig(policy);
	let attempt = 0;
	let lastError = null;

	while (attempt < retryConfig.maxAttempts) {
		attempt++;

		let sessionResult;
		try {
			sessionResult = await executeSession(sessionDir, manifest, route, {
				autoApprove: (gate) => shouldAutoApproveGate(gate.type, policy),
				dryRun: options.dryRun,
			});
		} catch (err) {
			return {
				success: false,
				exitCode: 1,
				error: err.message,
				attempts: attempt,
			};
		}

		if (sessionResult.success) {
			return {
				success: true,
				exitCode: 0,
				stagesCompleted: sessionResult.stagesCompleted,
			};
		}

		if (sessionResult.reason === "Budget exceeded") {
			const budgetPolicy = getBudgetPolicy(policy);
			if (budgetPolicy.onExceed === "pause") {
				return { success: false, exitCode: 2, reason: "paused" };
			}
		}

		lastError = sessionResult.reason || sessionResult.error;

		if (attempt < retryConfig.maxAttempts) {
			const backoff = retryConfig.backoffMs[attempt - 1] || 15000;
			await new Promise((resolve) => setTimeout(resolve, backoff));
		}
	}

	return { success: false, exitCode: 1, error: lastError, attempts: attempt };
}

module.exports = { executeAutonomous };
