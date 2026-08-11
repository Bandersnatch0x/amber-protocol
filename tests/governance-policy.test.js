const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { run } = require("../scripts/amber");

test("governance policy - no policy file shows defaults", async () => {
	const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "amber-test-"));
	fs.mkdirSync(path.join(tmpDir, ".amber"), { recursive: true });

	let output = "";
	const originalWrite = process.stdout.write;
	process.stdout.write = (msg) => {
		output += msg;
		return true;
	};

	try {
		const exitCode = await run(["governance", "policy", "--target", tmpDir, "--json"]);
		assert.strictEqual(exitCode, 0);

		const result = JSON.parse(output);
		assert.strictEqual(result.target, tmpDir);
		assert.strictEqual(result.errors.length, 0);
		assert.strictEqual(result.overrides.length, 0);
		assert.deepStrictEqual(result.policy, result.defaults);
	} finally {
		process.stdout.write = originalWrite;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("governance policy - custom policy shows diff", async () => {
	const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "amber-test-"));
	const amberDir = path.join(tmpDir, ".amber");
	fs.mkdirSync(amberDir, { recursive: true });

	const customPolicy = {
		gates: {
			auto: "approve",
			"user-approval": "approve",
			"step-confirm": "block",
		},
		retry: {
			maxAttempts: 5,
			backoffMs: [2000, 10000, 30000],
			retryableStages: ["implement"],
		},
		budget: { onExceed: "pause" },
		notifications: { email: { enabled: false }, slack: { enabled: false } },
	};
	fs.writeFileSync(
		path.join(amberDir, "autonomous-policy.json"),
		JSON.stringify(customPolicy, null, 2),
	);

	let output = "";
	const originalWrite = process.stdout.write;
	process.stdout.write = (msg) => {
		output += msg;
		return true;
	};

	try {
		const exitCode = await run(["governance", "policy", "--target", tmpDir, "--json"]);
		assert.strictEqual(exitCode, 0);

		const result = JSON.parse(output);
		assert.strictEqual(result.target, tmpDir);
		assert.strictEqual(result.errors.length, 0);
		assert.ok(result.overrides.length > 0);

		const userApprovalOverride = result.overrides.find(
			(o) => o.type === "gate" && o.gate === "user-approval",
		);
		assert.ok(userApprovalOverride);
		assert.strictEqual(userApprovalOverride.default, "block");
		assert.strictEqual(userApprovalOverride.override, "approve");

		const retryOverride = result.overrides.find((o) => o.type === "retry");
		assert.ok(retryOverride);

		assert.ok(result.warnings.some((w) => w.includes("user-approval")));
	} finally {
		process.stdout.write = originalWrite;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});

test("governance policy - auto-approve-all key errors", async () => {
	const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "amber-test-"));
	const amberDir = path.join(tmpDir, ".amber");
	fs.mkdirSync(amberDir, { recursive: true });

	const invalidPolicy = {
		"auto-approve-all": true,
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
	fs.writeFileSync(
		path.join(amberDir, "autonomous-policy.json"),
		JSON.stringify(invalidPolicy, null, 2),
	);

	let output = "";
	const originalWrite = process.stdout.write;
	process.stdout.write = (msg) => {
		output += msg;
		return true;
	};

	try {
		const exitCode = await run(["governance", "policy", "--target", tmpDir, "--json"]);
		assert.strictEqual(exitCode, 1);

		const result = JSON.parse(output);
		assert.strictEqual(result.target, tmpDir);
		assert.ok(result.errors.length > 0);
		assert.ok(result.errors.some((e) => e.includes("auto-approve-all")));
	} finally {
		process.stdout.write = originalWrite;
		fs.rmSync(tmpDir, { recursive: true, force: true });
	}
});
