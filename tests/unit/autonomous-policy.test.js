const { describe, it } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { loadPolicy, getDefaultPolicy } = require("../../scripts/lib/autonomous-policy");

describe("autonomous-policy (compat read only, ADR-0001/0005)", () => {
	it("loads default policy when no file is present", () => {
		const policy = loadPolicy(os.tmpdir());
		assert.ok(policy);
		assert.strictEqual(policy.gates["user-approval"], "block");
		assert.strictEqual(policy.gates.auto, "approve");
	});

	it("exposes the same shape via getDefaultPolicy", () => {
		const policy = getDefaultPolicy();
		assert.strictEqual(policy.gates["user-approval"], "block");
		assert.ok(Array.isArray(policy.retry.backoffMs));
	});

	it("reads a present policy file without auto-approving anything", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-"));
		const amberDir = path.join(tmpDir, ".amber");
		fs.mkdirSync(amberDir, { recursive: true });
		fs.writeFileSync(
			path.join(amberDir, "autonomous-policy.json"),
			JSON.stringify({
				"auto-approve-all": true,
				gates: {
					auto: "approve",
					"user-approval": "block",
					"step-confirm": "block",
				},
			}, null, 2),
		);

		try {
			const policy = loadPolicy(tmpDir);
			// File is read as-is (inspectPolicy warns on unsafe overrides); no executor
			// consumes it. Defaults still block user-approval in the file we wrote.
			assert.strictEqual(policy.gates["user-approval"], "block");
			assert.strictEqual(policy["auto-approve-all"], true);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("falls back to fail-safe defaults on a corrupt policy file", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-"));
		const amberDir = path.join(tmpDir, ".amber");
		fs.mkdirSync(amberDir, { recursive: true });
		fs.writeFileSync(path.join(amberDir, "autonomous-policy.json"), "{ not valid json");

		try {
			const policy = loadPolicy(tmpDir);
			assert.ok(policy && typeof policy === "object");
			assert.strictEqual(policy.gates.auto, "approve");
			assert.strictEqual(policy.gates["user-approval"], "block");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("falls back to fail-safe defaults on a non-object policy body", () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-test-"));
		const amberDir = path.join(tmpDir, ".amber");
		fs.mkdirSync(amberDir, { recursive: true });
		fs.writeFileSync(path.join(amberDir, "autonomous-policy.json"), "null");

		try {
			const policy = loadPolicy(tmpDir);
			assert.ok(policy && typeof policy === "object");
			assert.strictEqual(policy.gates["user-approval"], "block");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
