const { describe, it } = require("node:test");
const assert = require("assert");
const { reviewPermissions } = require("../../src/security/permission-review");

describe("reviewPermissions", () => {
	it("validates hook permissions structure", () => {
		const settings = {
			permissions: {
				allow: [
					{ tool: "read", paths: ["src/**"] },
					{ tool: "write", paths: ["tests/**"] }
				]
			}
		};

		const result = reviewPermissions(settings, []);
		assert.strictEqual(typeof result, "object");
		assert.ok(Object.hasOwn(result, "findings"));
		assert.ok(Object.hasOwn(result, "pass"));
	});

	it("flags overly broad permissions (globstar patterns)", () => {
		const settings = {
			permissions: {
				allow: [
					{ tool: "read", paths: ["**"] },
					{ tool: "write", paths: ["**"] },
					{ tool: "exec", paths: ["**"] }
				]
			}
		};

		const result = reviewPermissions(settings, []);
		const broadFindings = result.findings.filter(f => f.severity === "warning" && f.issue === "overly_broad");

		assert.ok(broadFindings.length > 0, "Should flag overly broad ** patterns");
		assert.ok(broadFindings[0].message.includes("**"), "Message should reference the pattern");
	});

	it("validates permission scopes match actual usage", () => {
		const settings = {
			permissions: {
				allow: [
					{ tool: "read", paths: ["src/**"] },
					{ tool: "write", paths: ["src/**"] },
					{ tool: "exec", paths: ["scripts/**"] }
				]
			}
		};

		const usageLog = [
			{ tool: "read", path: "src/index.js" },
			{ tool: "write", path: "src/index.js" },
			{ tool: "exec", path: "scripts/build.js" }
		];

		const result = reviewPermissions(settings, usageLog);
		// All usage should be covered by permissions
		const unused = result.findings.filter(f => f.issue === "unused_permission");
		// No errors expected when scopes match
		assert.strictEqual(result.pass, true);
	});

	it("flags unused permissions that are never exercised", () => {
		const settings = {
			permissions: {
				allow: [
					{ tool: "read", paths: ["src/**"] },
					{ tool: "delete", paths: ["**"] }
				]
			}
		};

		const usageLog = [
			{ tool: "read", path: "src/file.js" }
		];

		const result = reviewPermissions(settings, usageLog);
		const unused = result.findings.filter(f => f.issue === "unused_permission");

		assert.ok(unused.length > 0, "Should flag unused delete permission");
		assert.ok(unused[0].message.includes("delete"), "Should mention the unused tool");
	});

	it("returns pass=true when no issues found", () => {
		const settings = {
			permissions: {
				allow: [
					{ tool: "read", paths: ["src/**", "tests/**"] }
				]
			}
		};

		const result = reviewPermissions(settings, [{ tool: "read", path: "src/main.js" }]);
		assert.strictEqual(result.pass, true);
		assert.strictEqual(result.findings.length, 0);
	});

	it("handles empty permissions gracefully", () => {
		const settings = { permissions: { allow: [] } };
		const result = reviewPermissions(settings, [{ tool: "read", path: "src/x.js" }]);

		const missingPerms = result.findings.filter(f => f.issue === "missing_permission");
		assert.ok(missingPerms.length > 0, "Should flag usage without matching permissions");
	});

	it("flags write access to sensitive paths", () => {
		const settings = {
			permissions: {
				allow: [
					{ tool: "write", paths: ["package.json", "node_modules/**", ".git/**"] }
				]
			}
		};

		const result = reviewPermissions(settings, []);
		const sensitive = result.findings.filter(f => f.issue === "sensitive_path");

		assert.ok(sensitive.length > 0, "Should flag write access to sensitive paths");
	});
});
