"use strict";

/**
 * Audit report generator — combines all scan results into a markdown report.
 */

/**
 * @param {object} depResult - dependency scan result
 * @param {Array|object|null} secretResult - findings or an unscanned result
 * @param {object} permResult - permission review result
 * @returns {string} markdown report
 */
function generateAuditReport(depResult, secretResult, permResult) {
	const date = new Date().toISOString().split("T")[0];
	const dependencyStatus = scanStatus(depResult);
	const secretStatus = scanStatus(secretResult);
	const permissionStatus = scanStatus(permResult);
	const statuses = [dependencyStatus, secretStatus, permissionStatus];
	const overallStatus = statuses.includes("fail")
		? "fail"
		: statuses.includes("unscanned")
			? "unscanned"
			: "pass";
	const overallPass = overallStatus === "pass";
	const labels = { pass: "✅ PASS", fail: "❌ FAIL", unscanned: "⚠️ UNSCANNED" };
	const status = labels[overallStatus].replace(/(PASS|FAIL|UNSCANNED)/, "**$1**");

	let report = "";
	report += "# Security Audit Report\n\n";
	report += `**Date:** ${date}  \n`;
	report += `**Overall Status:** ${status}\n\n`;
	report += "---\n\n";

	// Dependency scan section
	report += "## Dependency Scan\n\n";
	report += `**Status:** ${labels[dependencyStatus]}  \n`;
	report += `**Summary:** ${depResult?.summary || "Scan not executed."}\n\n`;

	if (dependencyStatus === "unscanned") {
		report += "Dependency scan unscanned.\n\n";
	} else if (depResult.vulnerabilities && depResult.vulnerabilities.length > 0) {
		const bySeverity = groupBySeverity(depResult.vulnerabilities);
		for (const [severity, vulns] of Object.entries(bySeverity)) {
			report += `### ${severity.toUpperCase()} (${vulns.length})\n\n`;
			for (const v of vulns) {
				report += `- **${v.package}** — ${v.title}`;
				if (v.fixAvailable) report += " (fix available)";
				if (v.range) report += ` [${v.range}]`;
				report += "\n";
			}
			report += "\n";
		}
	} else {
		report += "No vulnerabilities found.\n\n";
	}

	// Secret scan section
	report += "## Secret Scan\n\n";
	report += `**Status:** ${labels[secretStatus]}  \n`;
	report += `**Findings:** ${secretStatus === "unscanned" ? "unknown" : secretResult.length}\n\n`;

	if (secretStatus === "unscanned") {
		report += `${secretResult?.summary || "Secret scan not executed."}\n\n`;
	} else if (secretResult.length > 0) {
		for (const f of secretResult) {
			report += `- **${f.type}** in \`${f.file}:${f.line}\` — \`${f.match}\`\n`;
		}
		report += "\n";
	} else {
		report += "No secrets detected.\n\n";
	}

	// Permission review section
	report += "## Permission Review\n\n";
	report += `**Status:** ${labels[permissionStatus]}  \n`;
	report += `**Findings:** ${permissionStatus === "unscanned" ? "unknown" : permResult.findings.length}\n\n`;

	if (permissionStatus === "unscanned") {
		report += `${permResult?.summary || "Permission review not executed."}\n\n`;
	} else if (permResult.findings.length > 0) {
		for (const f of permResult.findings) {
			const icon = f.severity === "error" ? "❌" : f.severity === "warning" ? "⚠️" : "ℹ️";
			report += `- ${icon} **${f.issue}** — ${f.message}\n`;
		}
		report += "\n";
	} else {
		report += "No permission issues found.\n\n";
	}

	// Governance Categories
	report += "## Governance Categories\n\n";
	report += "- Dependency Scan → `dependency-vulnerability-review`\n";
	report += "- Secret Scan → `secret-exposure-review`\n";
	report += "- Permission Review → `permission-surface-review`\n\n";

	// Remediation section
	report += "## Remediation\n\n";

	if (!overallPass) {
		if (statuses.includes("unscanned")) {
			report +=
				"Complete unscanned categories with readable, supported inputs and rerun the audit.\n\n";
		}
		if (dependencyStatus === "fail") {
			report += "### Dependency Vulnerabilities\n";
			report += "- Run `npm audit fix` to auto-fix available patches.\n";
			report += "- Run `npm update` to update affected packages.\n";
			report += "- Review `npm audit` for detailed advisory information.\n\n";
		}

		if (secretStatus === "fail") {
			report += "### Exposed Secrets\n";
			report += "- Remove all hardcoded secrets from source code immediately.\n";
			report += "- Use environment variables or a secrets manager.\n";
			report += "- Rotate any credentials that may have been exposed.\n";
			report += "- Add the relevant files to `.gitignore` if they contain secrets.\n\n";
		}

		if (permissionStatus === "fail") {
			report += "### Permission Issues\n";
			report += "- Review and tighten overly broad permission patterns.\n";
			report += "- Remove unused permissions to follow least-privilege.\n";
			report += "- Add missing permissions for required tool access.\n\n";
		}
	} else {
		report += "No remediation needed. All scans pass.\n\n";
	}

	// Metadata
	report += "## Metadata\n\n";
	report += `- **Date:** ${date}\n`;
	report += `- **Tool:** amber-protocol security audit v1.0.0\n`;
	report += `- **Scanners:** dependency-scan, secret-scan, permission-review\n`;

	return report;
}

function scanStatus(result) {
	if (result == null || result.status === "unscanned") return "unscanned";
	if (Array.isArray(result)) return result.length === 0 ? "pass" : "fail";
	if (result.pass === true) return "pass";
	return result.pass === false ? "fail" : "unscanned";
}

function groupBySeverity(vulnerabilities) {
	const groups = {};
	for (const v of vulnerabilities) {
		const sev = v.severity || "unknown";
		if (!groups[sev]) groups[sev] = [];
		groups[sev].push(v);
	}
	return groups;
}

module.exports = { generateAuditReport };
