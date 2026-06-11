#!/usr/bin/env node
const { run } = require("./scripts/amber");
const fs = require("fs");
const path = require("path");
const os = require("os");

async function test() {
	console.log("Test 1: No policy file shows defaults");
	const tmpDir1 = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-"));
	fs.mkdirSync(path.join(tmpDir1, ".amber"), { recursive: true });

	const code1 = await run(["governance", "policy", "--target", tmpDir1, "--json"]);
	console.log("Exit code:", code1);
	fs.rmSync(tmpDir1, { recursive: true, force: true });

	console.log("\nTest 2: Custom policy shows diff");
	const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-"));
	const amberDir = path.join(tmpDir2, ".amber");
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
		JSON.stringify(customPolicy, null, 2)
	);

	const code2 = await run(["governance", "policy", "--target", tmpDir2, "--json"]);
	console.log("Exit code:", code2);
	fs.rmSync(tmpDir2, { recursive: true, force: true });

	console.log("\nTest 3: auto-approve-all key errors");
	const tmpDir3 = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-"));
	const amberDir3 = path.join(tmpDir3, ".amber");
	fs.mkdirSync(amberDir3, { recursive: true });

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
		path.join(amberDir3, "autonomous-policy.json"),
		JSON.stringify(invalidPolicy, null, 2)
	);

	const code3 = await run(["governance", "policy", "--target", tmpDir3, "--json"]);
	console.log("Exit code:", code3);
	fs.rmSync(tmpDir3, { recursive: true, force: true });
}

test().catch(console.error);
