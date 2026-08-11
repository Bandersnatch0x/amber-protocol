"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { generateAuditReport } = require("../../src/security/audit-report");

// The CLI wrapper does not run real scanners; it renders a report skeleton.
// This notice keeps the placeholder PASS statuses from being mistaken for a
// completed audit and points to where real evidence belongs.
const REPORT_ONLY_NOTICE = [
	"> **Report-only skeleton.** This command does not execute dependency, secret,",
	"> or permission scans. The statuses below are placeholders — populate each",
	"> section with real scan evidence before treating this as a completed audit.",
	"> See `standards/security-governance.json` for the required evidence per category.",
	"",
	"",
].join("\n");

function generateSecurityAuditReport(targetRoot, options = {}) {
	const target = path.resolve(targetRoot || ".");
	const depResult = {
		pass: true,
		summary: "Dependency scan not executed by CLI wrapper in report-only mode.",
		vulnerabilities: [],
	};
	const secretResult = [];
	const permResult = { pass: true, findings: [] };
	const report = REPORT_ONLY_NOTICE + generateAuditReport(depResult, secretResult, permResult);

	if (options.output) {
		const outputPath = path.resolve(options.output);
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, report);
		return {
			text: `Security audit written: ${outputPath}`,
			target,
			outputPath,
			errors: [],
			warnings: [],
		};
	}

	return { text: report, target, errors: [], warnings: [] };
}

module.exports = { generateSecurityAuditReport };
