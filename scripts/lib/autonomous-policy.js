const fs = require("fs");
const path = require("path");

function loadPolicy(projectRoot = process.cwd()) {
	const policyPath = path.join(
		projectRoot,
		".harness",
		"autonomous-policy.json",
	);

	if (!fs.existsSync(policyPath)) {
		return getDefaultPolicy();
	}

	return JSON.parse(fs.readFileSync(policyPath, "utf8"));
}

function getDefaultPolicy() {
	return {
		// Gates: user-approval gates are blocked by default —
		// autonomous mode must not silently bypass human decisions.
		// Users can override in .harness/autonomous-policy.json
		// with --auto-approve-all or per-gate rules.
		gates: {
			auto: "approve",
			"user-approval": "block",
			"step-confirm": "block",
		},
		retry: {
			maxAttempts: 3,
			backoffMs: [1000, 5000, 15000],
			retryableStages: ["implement", "verify"],
		},
		budget: { onExceed: "pause" },
		notifications: { email: { enabled: false }, slack: { enabled: false } },
	};
}

function shouldAutoApproveGate(gateType, policy) {
	return policy.gates[gateType] === "approve";
}

function getRetryConfig(policy) {
	return policy.retry;
}

function getBudgetPolicy(policy) {
	return policy.budget;
}

function getNotificationConfig(policy) {
	return policy.notifications;
}

module.exports = {
	loadPolicy,
	shouldAutoApproveGate,
	getRetryConfig,
	getBudgetPolicy,
	getNotificationConfig,
};
