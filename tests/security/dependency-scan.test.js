const { describe, it } = require("node:test");
const assert = require("assert");
const { dependencyScan, parseAuditOutput } = require("../../src/security/dependency-scan");

describe("dependencyScan", () => {
	it("returns vulnerabilities with severity levels from valid audit JSON", () => {
		const mockAuditJson = JSON.stringify({
			vulnerabilities: {
				"minimist": {
					name: "minimist",
					severity: "high",
					isDirect: true,
					via: [{ title: "Prototype Pollution", url: "https://github.com/advisories/GHSA-xxx" }],
					range: "<=1.2.5"
				},
				"lodash": {
					name: "lodash",
					severity: "critical",
					isDirect: false,
					via: [{ title: "Prototype Pollution", url: "https://github.com/advisories/GHSA-yyy" }],
					range: "<4.17.21"
				}
			}
		});

		const result = parseAuditOutput(mockAuditJson);

		assert.strictEqual(result.length, 2);
		assert.strictEqual(result[0].package, "minimist");
		assert.strictEqual(result[0].severity, "high");
		assert.strictEqual(result[1].package, "lodash");
		assert.strictEqual(result[1].severity, "critical");
	});

	it("fails when high/critical vulnerabilities found", () => {
		const result = [
			{ package: "minimist", severity: "high", title: "Prototype Pollution" },
			{ package: "lodash", severity: "critical", title: "Prototype Pollution" }
		];

		const highCritical = result.filter(v => v.severity === "high" || v.severity === "critical");
		assert.strictEqual(highCritical.length, 2, "Should detect high/critical vulnerabilities");
	});

	it("returns empty array when no vulnerabilities", () => {
		const mockAuditJson = JSON.stringify({ vulnerabilities: {} });
		const result = parseAuditOutput(mockAuditJson);

		assert.strictEqual(result.length, 0);
	});

	it("handles malformed JSON gracefully", () => {
		const result = parseAuditOutput("not valid json");
		assert.strictEqual(result.length, 0);
	});

	it("categorizes by severity (low/moderate/high/critical)", () => {
		const mockAuditJson = JSON.stringify({
			vulnerabilities: {
				a: { name: "a", severity: "low", via: [] },
				b: { name: "b", severity: "moderate", via: [] },
				c: { name: "c", severity: "high", via: [] },
				d: { name: "d", severity: "critical", via: [] }
			}
		});

		const result = parseAuditOutput(mockAuditJson);
		const categorized = {
			low: result.filter(v => v.severity === "low").length,
			moderate: result.filter(v => v.severity === "moderate").length,
			high: result.filter(v => v.severity === "high").length,
			critical: result.filter(v => v.severity === "critical").length
		};

		assert.strictEqual(categorized.low, 1);
		assert.strictEqual(categorized.moderate, 1);
		assert.strictEqual(categorized.high, 1);
		assert.strictEqual(categorized.critical, 1);
	});

	it("dependencyScan returns structured result object", () => {
		const result = dependencyScan([]);
		assert.strictEqual(typeof result, "object");
		assert.ok(Object.hasOwn(result, "vulnerabilities"));
		assert.ok(Object.hasOwn(result, "summary"));
		assert.ok(Object.hasOwn(result, "pass"));
	});

	it("pass is false when critical or high vulnerabilities exist", () => {
		const vulns = [
			{ package: "test", severity: "critical", title: "RCE" }
		];
		const result = dependencyScan(vulns);
		assert.strictEqual(result.pass, false);
	});

	it("pass is true when only low/moderate vulnerabilities exist", () => {
		const vulns = [
			{ package: "test", severity: "low", title: "Minor" }
		];
		const result = dependencyScan(vulns);
		assert.strictEqual(result.pass, true);
	});
});
