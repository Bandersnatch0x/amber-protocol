const { describe, it } = require("node:test");
const assert = require("assert");
const { scanForSecrets } = require("../../src/security/secret-scan");

describe("scanForSecrets", () => {
	it("detects hardcoded API keys", () => {
		const filePath = "/tmp/test-api-key.js";
		const content = 'const apiKey = "sk-1234567890abcdef1234567890abcdef";'; // amber:scan-allow
		const { findings: results } = scanForSecrets([{ path: filePath, content }]);

		assert.ok(results.length > 0, "Should find at least one secret");
		const apiKeyFinding = results.find((r) => r.type === "API Key");
		assert.ok(apiKeyFinding, "Should identify as API key");
		assert.strictEqual(apiKeyFinding.file, filePath);
	});

	it("detects AWS keys in common patterns", () => {
		const filePath = "/tmp/test-aws-key.js";
		const content = 'const accessKey = "AKIAIOSFODNN7EXAMPLE";'; // amber:scan-allow
		const { findings: results } = scanForSecrets([{ path: filePath, content }]);

		const awsFinding = results.find((r) => r.type === "AWS Access Key");
		assert.ok(awsFinding, "Should detect AWS access key pattern");
		assert.strictEqual(awsFinding.file, filePath);
	});

	it("detects tokens and passwords in common patterns", () => {
		const cases = [
			{
				file: "/tmp/token.js",
				content: 'const token = "ghp_1234567890abcdef1234567890abcdef1234";', // amber:scan-allow
				type: "GitHub Token",
			},
			{
				file: "/tmp/password.js",
				content: 'const password = "superSecret123!";', // amber:scan-allow
				type: "Password Assignment",
			},
			{
				file: "/tmp/jwt.js",
				content:
					'const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";', // amber:scan-allow
				type: "JWT Token",
			},
		];

		for (const c of cases) {
			const { findings: results } = scanForSecrets([{ path: c.file, content: c.content }]);
			assert.ok(results.length > 0, `Should find secret in ${c.file}`);
			const finding = results.find((r) => r.type === c.type);
			assert.ok(finding, `Should detect ${c.type} in ${c.file}`);
		}
	});

	it("returns file path and line number", () => {
		const filePath = "/tmp/test-secret.js";
		const content = '// line 1\nconst apiKey = "sk-abcdef1234567890123456"; // line 2\n// line 3'; // amber:scan-allow
		const { findings: results } = scanForSecrets([{ path: filePath, content }]);

		assert.ok(results.length > 0);
		assert.strictEqual(results[0].file, filePath);
		assert.ok(typeof results[0].line === "number", "Should include line number");
		assert.ok(results[0].line >= 1, "Line number should be >= 1");
	});

	it("returns empty findings and zero suppressions for clean files", () => {
		const content = "const name = 'hello';\nconst value = 42;\nconsole.log('all clear');";
		const results = scanForSecrets([{ path: "/tmp/clean.js", content }]);

		assert.deepStrictEqual(results, { findings: [], suppressedCount: 0 });
	});

	it("does not flag false positives in comments about secrets", () => {
		const content = "// Never hardcode API keys in your code\n// Use environment variables instead";
		const { findings: results } = scanForSecrets([{ path: "/tmp/comment.js", content }]);

		// Comments alone should not trigger - the patterns require actual values
		assert.strictEqual(
			results.filter((r) => r.type !== "Password Assignment").length,
			0,
			"Comments about secrets should not trigger most patterns",
		);
	});

	for (const marker of [
		"// amber:scan-allow",
		"# amber:scan-allow",
		"<!-- amber:scan-allow -->",
		"amber:scan-allow",
	]) {
		it(`suppresses only findings on the marked line with ${marker}`, () => {
			const credential = `const accessKey = "AKIA${"A".repeat(16)}";`;
			const content = [credential + " " + marker, credential, marker, credential].join("\r\n");
			const result = scanForSecrets([{ path: "mixed-fixture.js", content }]);

			assert.strictEqual(result.suppressedCount, 1);
			assert.deepStrictEqual(
				result.findings.map(({ file, line, type }) => ({ file, line, type })),
				[
					{ file: "mixed-fixture.js", line: 2, type: "AWS Access Key" },
					{ file: "mixed-fixture.js", line: 4, type: "AWS Access Key" },
				],
			);
		});
	}

	it("counts suppressed findings per rule rather than per line or match", () => {
		const token = "ghp_" + "a".repeat(36);
		const credential = `api_key = "${token}";`;
		const content = `${credential} ${credential} // amber:scan-allow`;
		const result = scanForSecrets([{ path: "multiple-rules.js", content }]);

		assert.deepStrictEqual(result, { findings: [], suppressedCount: 2 });
		assert.strictEqual(
			scanForSecrets([{ path: "unmarked.js", content: credential }]).findings.length,
			2,
		);
		assert.deepStrictEqual(scanForSecrets([{ path: "clean.js", content: "// amber:scan-allow" }]), {
			findings: [],
			suppressedCount: 0,
		});
	});

	it("applies allow markers to every secret rule", () => {
		const credentials = [
			`api_key = "${"a".repeat(24)}"`,
			`AKIA${"A".repeat(16)}`,
			`"${"a".repeat(40)}" # secret`,
			"ghp_" + "a".repeat(36),
			`eyJ${"a".repeat(10)}.${"b".repeat(10)}.${"c".repeat(10)}`,
			`password = "${"a".repeat(8)}"`,
			"-----BEGIN " + "RSA PRIVATE KEY-----",
			"Bearer " + "a".repeat(24),
		];
		const files = credentials.map((content, index) => ({ path: `rule-${index}.txt`, content }));
		const unmarked = scanForSecrets(files);
		assert.strictEqual(new Set(unmarked.findings.map((finding) => finding.type)).size, 8);
		const marked = scanForSecrets(
			files.map((file) => ({ ...file, content: file.content + " # amber:scan-allow" })),
		);

		assert.deepStrictEqual(marked, { findings: [], suppressedCount: unmarked.findings.length });
	});
});
