const fs = require("fs");
const path = require("path");
const { resolveStateDirForRead } = require("./state-dir-resolver");

function loadPolicy(projectRoot = process.cwd()) {
	const policyPath = path.join(resolveStateDirForRead(projectRoot), "autonomous-policy.json");

	if (!fs.existsSync(policyPath)) {
		return getDefaultPolicy();
	}

	// A present-but-corrupt policy must not crash callers (inspectPolicy and the
	// autonomous executor dereference the result without their own guard). Fail
	// safe to the defaults: they block user-approval, so a broken security policy
	// can only ever stop autonomous actions, never silently auto-approve them.
	let parsed;
	try {
		parsed = JSON.parse(fs.readFileSync(policyPath, "utf8"));
	} catch {
		return getDefaultPolicy();
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return getDefaultPolicy();
	}
	return parsed;
}

function getDefaultPolicy() {
	return {
		// Gates: user-approval gates are blocked by default —
		// autonomous mode must not silently bypass human decisions.
		// Users can override in .amber/autonomous-policy.json
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
