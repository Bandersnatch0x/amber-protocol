"use strict";

/**
 * Audit report generator — combines all scan results into a markdown report.
 */

/**
 * @param {object} depResult - dependency scan result
 * @param {Array} secretResult - secret scan findings
 * @param {object} permResult - permission review result
 * @returns {string} markdown report
 */
function generateAuditReport(depResult, secretResult, permResult) {
	const date = new Date().toISOString().split("T")[0];
	const overallPass = depResult.pass && secretResult.length === 0 && permResult.pass;
	const status = overallPass ? "✅ **PASS**" : "❌ **FAIL**";

	let report = "";
	report += "# Security Audit Report\n\n";
	report += `**Date:** ${date}  \n`;
	report += `**Overall Status:** ${status}\n\n`;
	report += "---\n\n";

	// Dependency scan section
	report += "## Dependency Scan\n\n";
	report += `**Status:** ${depResult.pass ? "✅ PASS" : "❌ FAIL"}  \n`;
	report += `**Summary:** ${depResult.summary}\n\n`;

	if (depResult.vulnerabilities && depResult.vulnerabilities.length > 0) {
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
	report += `**Status:** ${secretResult.length === 0 ? "✅ PASS" : "❌ FAIL"}  \n`;
	report += `**Findings:** ${secretResult.length}\n\n`;

	if (secretResult.length > 0) {
		for (const f of secretResult) {
			report += `- **${f.type}** in \`${f.file}:${f.line}\` — \`${f.match}\`\n`;
		}
		report += "\n";
	} else {
		report += "No secrets detected.\n\n";
	}

	// Permission review section
	report += "## Permission Review\n\n";
	report += `**Status:** ${permResult.pass ? "✅ PASS" : "❌ FAIL"}  \n`;
	report += `**Findings:** ${permResult.findings.length}\n\n`;

	if (permResult.findings.length > 0) {
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
		if (!depResult.pass) {
			report += "### Dependency Vulnerabilities\n";
			report += "- Run `npm audit fix` to auto-fix available patches.\n";
			report += "- Run `npm update` to update affected packages.\n";
			report += "- Review `npm audit` for detailed advisory information.\n\n";
		}

		if (secretResult.length > 0) {
			report += "### Exposed Secrets\n";
			report += "- Remove all hardcoded secrets from source code immediately.\n";
			report += "- Use environment variables or a secrets manager.\n";
			report += "- Rotate any credentials that may have been exposed.\n";
			report += "- Add the relevant files to `.gitignore` if they contain secrets.\n\n";
		}

		if (!permResult.pass) {
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
