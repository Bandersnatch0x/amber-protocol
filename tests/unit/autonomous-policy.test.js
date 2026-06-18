const { describe, it } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
	loadPolicy,
	shouldAutoApproveGate,
	getRetryConfig,
} = require("../../scripts/lib/autonomous-policy");

describe("autonomous-policy", () => {
	it("should load default policy", () => {
		const policy = loadPolicy();
		assert.ok(policy);
		assert.strictEqual(policy.gates.auto, "approve");
	});

	it("should auto-approve gate based on policy", () => {
		const policy = {
			gates: { "user-approval": "approve", "step-confirm": "skip" },
		};
		assert.strictEqual(shouldAutoApproveGate("user-approval", policy), true);
		assert.strictEqual(shouldAutoApproveGate("step-confirm", policy), false);
		assert.strictEqual(shouldAutoApproveGate("unknown", policy), false);
	});

	it("should return retry config", () => {
		const policy = {
			retry: { maxAttempts: 3, backoffMs: [1000, 5000, 15000] },
		};
		const config = getRetryConfig(policy);
		assert.strictEqual(config.maxAttempts, 3);
		assert.strictEqual(config.backoffMs.length, 3);
	});

	it("should ignore auto-approve-all in policy file", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-"));
		const amberDir = path.join(tmpDir, ".amber");
		fs.mkdirSync(amberDir, { recursive: true });

		const invalidPolicy = {
			"auto-approve-all": true,
			gates: {
				auto: "approve",
				"user-approval": "block",
				"step-confirm": "block",
			},
		};
		fs.writeFileSync(
			path.join(amberDir, "autonomous-policy.json"),
			JSON.stringify(invalidPolicy, null, 2)
		);

		try {
			const policy = loadPolicy(tmpDir);
			assert.strictEqual(shouldAutoApproveGate("user-approval", policy), false);
			assert.strictEqual(shouldAutoApproveGate("step-confirm", policy), false);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("should fall back to the fail-safe default policy on a corrupt policy file", () => {
		// A present-but-unparseable security policy must not crash callers, and
		// must fail safe: the defaults block user-approval rather than inheriting
		// whatever the broken file might have intended.
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-"));
		const amberDir = path.join(tmpDir, ".amber");
		fs.mkdirSync(amberDir, { recursive: true });
		fs.writeFileSync(
			path.join(amberDir, "autonomous-policy.json"),
			"{ not valid json"
		);

		try {
			const policy = loadPolicy(tmpDir);
			assert.ok(policy && typeof policy === "object");
			assert.strictEqual(policy.gates.auto, "approve");
			assert.strictEqual(shouldAutoApproveGate("user-approval", policy), false);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("should fall back to the fail-safe default policy on a non-object policy body", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-"));
		const amberDir = path.join(tmpDir, ".amber");
		fs.mkdirSync(amberDir, { recursive: true });
		fs.writeFileSync(
			path.join(amberDir, "autonomous-policy.json"),
			"null"
		);

		try {
			const policy = loadPolicy(tmpDir);
			assert.ok(policy && typeof policy === "object");
			assert.strictEqual(policy.gates["user-approval"], "block");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
