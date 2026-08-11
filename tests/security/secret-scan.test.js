const { describe, it } = require("node:test");
const assert = require("assert");
const { scanForSecrets } = require("../../src/security/secret-scan");

describe("scanForSecrets", () => {
	it("detects hardcoded API keys", () => {
		const filePath = "/tmp/test-api-key.js";
		const content = 'const apiKey = "sk-1234567890abcdef1234567890abcdef";';
		const results = scanForSecrets([{ path: filePath, content }]);

		assert.ok(results.length > 0, "Should find at least one secret");
		const apiKeyFinding = results.find((r) => r.type === "API Key");
		assert.ok(apiKeyFinding, "Should identify as API key");
		assert.strictEqual(apiKeyFinding.file, filePath);
	});

	it("detects AWS keys in common patterns", () => {
		const filePath = "/tmp/test-aws-key.js";
		const content = 'const accessKey = "AKIAIOSFODNN7EXAMPLE";';
		const results = scanForSecrets([{ path: filePath, content }]);

		const awsFinding = results.find((r) => r.type === "AWS Access Key");
		assert.ok(awsFinding, "Should detect AWS access key pattern");
		assert.strictEqual(awsFinding.file, filePath);
	});

	it("detects tokens and passwords in common patterns", () => {
		const cases = [
			{
				file: "/tmp/token.js",
				content: 'const token = "ghp_1234567890abcdef1234567890abcdef1234";',
				type: "GitHub Token",
			},
			{
				file: "/tmp/password.js",
				content: 'const password = "superSecret123!";',
				type: "Password Assignment",
			},
			{
				file: "/tmp/jwt.js",
				content:
					'const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";',
				type: "JWT Token",
			},
		];

		for (const c of cases) {
			const results = scanForSecrets([{ path: c.file, content: c.content }]);
			assert.ok(results.length > 0, `Should find secret in ${c.file}`);
			const finding = results.find((r) => r.type === c.type);
			assert.ok(finding, `Should detect ${c.type} in ${c.file}`);
		}
	});

	it("returns file path and line number", () => {
		const filePath = "/tmp/test-secret.js";
		const content = '// line 1\nconst apiKey = "sk-abcdef1234567890123456"; // line 2\n// line 3';
		const results = scanForSecrets([{ path: filePath, content }]);

		assert.ok(results.length > 0);
		assert.strictEqual(results[0].file, filePath);
		assert.ok(typeof results[0].line === "number", "Should include line number");
		assert.ok(results[0].line >= 1, "Line number should be >= 1");
	});

	it("returns empty array for clean files", () => {
		const content = "const name = 'hello';\nconst value = 42;\nconsole.log('all clear');";
		const results = scanForSecrets([{ path: "/tmp/clean.js", content }]);

		assert.strictEqual(results.length, 0);
	});

	it("does not flag false positives in comments about secrets", () => {
		const content = "// Never hardcode API keys in your code\n// Use environment variables instead";
		const results = scanForSecrets([{ path: "/tmp/comment.js", content }]);

		// Comments alone should not trigger - the patterns require actual values
		assert.strictEqual(
			results.filter((r) => r.type !== "Password Assignment").length,
			0,
			"Comments about secrets should not trigger most patterns",
		);
	});
});
