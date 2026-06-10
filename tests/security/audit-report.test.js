const { describe, it } = require("node:test");
const assert = require("assert");
const { generateAuditReport } = require("../../src/security/audit-report");

describe("generateAuditReport", () => {
	it("combines all scan results into a single report", () => {
		const depResult = {
			vulnerabilities: [{ package: "test", severity: "high", title: "RCE" }],
			summary: "1 vulnerability found",
			pass: false,
		};
		const secretResult = [
			{ file: "/tmp/test.js", line: 2, type: "API Key", match: "sk-abc" },
		];
		const permResult = {
			findings: [
				{
					issue: "overly_broad",
					severity: "warning",
					message: "Broad pattern **",
				},
			],
			pass: false,
		};

		const report = generateAuditReport(depResult, secretResult, permResult);

		assert.ok(report.includes("# Security Audit Report"), "Should have title");
		assert.ok(
			report.includes("## Dependency Scan"),
			"Should have dependency section",
		);
		assert.ok(report.includes("## Secret Scan"), "Should have secret section");
		assert.ok(
			report.includes("## Permission Review"),
			"Should have permission section",
		);
	});

	it("produces markdown report with severity sections", () => {
		const depResult = {
			vulnerabilities: [
				{ package: "a", severity: "critical", title: "RCE" },
				{ package: "b", severity: "high", title: "XSS" },
				{ package: "c", severity: "moderate", title: "DoS" },
			],
			summary: "3 vulnerabilities",
			pass: false,
		};
		const secretResult = [];
		const permResult = { findings: [], pass: true };

		const report = generateAuditReport(depResult, secretResult, permResult);

		assert.ok(report.includes("CRITICAL"), "Should mention critical severity");
		assert.ok(report.includes("HIGH"), "Should mention high severity");
		assert.ok(report.includes("MODERATE"), "Should mention moderate severity");
	});

	it("includes remediation recommendations", () => {
		const depResult = {
			vulnerabilities: [
				{
					package: "lodash",
					severity: "critical",
					title: "Prototype Pollution",
					fixAvailable: true,
				},
			],
			summary: "1 vulnerability",
			pass: false,
		};
		const secretResult = [
			{ file: "src/config.js", line: 5, type: "API Key", match: "sk-abc" },
		];
		const permResult = {
			findings: [
				{ issue: "overly_broad", severity: "warning", message: "** pattern" },
			],
			pass: false,
		};

		const report = generateAuditReport(depResult, secretResult, permResult);

		assert.ok(
			report.includes("Remediation"),
			"Should include remediation section",
		);
		assert.ok(
			report.includes("update"),
			"Should suggest updating dependencies (case-insensitive)",
		);
	});

	it("shows pass summary when all scans pass", () => {
		const depResult = { vulnerabilities: [], summary: "ok", pass: true };
		const secretResult = [];
		const permResult = { findings: [], pass: true };

		const report = generateAuditReport(depResult, secretResult, permResult);

		assert.ok(report.includes("PASS"), "Should show PASS status");
		assert.ok(!report.includes("FAIL"), "Should not show FAIL when passing");
	});

	it("shows fail summary when any scan fails", () => {
		const depResult = { vulnerabilities: [], summary: "ok", pass: true };
		const secretResult = [
			{ file: "x.js", line: 1, type: "Password", match: "pwd=123" },
		];
		const permResult = { findings: [], pass: true };

		const report = generateAuditReport(depResult, secretResult, permResult);

		assert.ok(
			report.includes("FAIL"),
			"Should show FAIL when secret scan finds issues",
		);
	});

	it("includes metadata section with timestamp", () => {
		const depResult = { vulnerabilities: [], summary: "ok", pass: true };
		const secretResult = [];
		const permResult = { findings: [], pass: true };

		const report = generateAuditReport(depResult, secretResult, permResult);

		assert.ok(
			report.includes("## Metadata"),
			"Should include metadata section",
		);
		assert.ok(report.includes("Date:"), "Should include date");
	});
});
