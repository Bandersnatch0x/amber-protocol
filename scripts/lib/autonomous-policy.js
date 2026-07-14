const fs = require("fs");
const path = require("path");
const { resolveStateDirForRead } = require("./state-dir-resolver");

// Compat read of optional `.amber/autonomous-policy.json`.
// Autonomous *execution* was removed (ADR-0001 / ADR-0005); this file is retained
// only so `governance policy` can still inspect/warn on a leftover policy on disk.
// There is no auto-approve executor that consumes these helpers.

function getDefaultPolicy() {
	return {
		// Fail-safe defaults: user-approval stays blocked. Even if a leftover
		// policy file is present, a corrupt/missing file degrades to this.
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

function loadPolicy(projectRoot = process.cwd()) {
	const policyPath = path.join(resolveStateDirForRead(projectRoot), "autonomous-policy.json");

	if (!fs.existsSync(policyPath)) {
		return getDefaultPolicy();
	}

	// Present-but-corrupt policy must not crash callers (inspectPolicy). Fail
	// safe to defaults: they block user-approval, so a broken security policy
	// can only ever stop autonomous-style claims, never silently auto-approve.
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

module.exports = {
	loadPolicy,
	getDefaultPolicy,
};
