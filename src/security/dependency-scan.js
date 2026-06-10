"use strict";

/**
 * Dependency scanner — wraps npm audit JSON output and returns structured results.
 */

function parseAuditOutput(auditJson) {
	try {
		const parsed = JSON.parse(auditJson);
		const vulns = parsed.vulnerabilities || {};
		const results = [];

		for (const [key, v] of Object.entries(vulns)) {
			const severity = v.severity || "unknown";
			const via = Array.isArray(v.via) ? v.via : [];
			const titles = via
				.filter(item => item && typeof item === "object" && item.title)
				.map(item => item.title);

			results.push({
				package: v.name || key,
				severity,
				isDirect: !!v.isDirect,
				fixAvailable: !!v.fixAvailable,
				title: titles[0] || "Unknown vulnerability",
				allTitles: titles,
				range: v.range || "",
			});
		}

		return results;
	} catch (e) {
		return [];
	}
}

/**
 * @param {Array} vulnerabilities - parsed audit results
 * @returns {{ vulnerabilities: Array, summary: string, pass: boolean }}
 */
function dependencyScan(vulnerabilities) {
	const hasHighOrCritical = vulnerabilities.some(
		v => v.severity === "high" || v.severity === "critical",
	);

	const counts = { low: 0, moderate: 0, high: 0, critical: 0, unknown: 0 };
	for (const v of vulnerabilities) {
		if (Object.hasOwn(counts, v.severity)) {
			counts[v.severity]++;
		} else {
			counts.unknown++;
		}
	}

	const parts = [];
	if (counts.critical) parts.push(`${counts.critical} critical`);
	if (counts.high) parts.push(`${counts.high} high`);
	if (counts.moderate) parts.push(`${counts.moderate} moderate`);
	if (counts.low) parts.push(`${counts.low} low`);
	if (counts.unknown) parts.push(`${counts.unknown} unknown`);

	return {
		vulnerabilities,
		counts,
		summary: parts.length ? `${vulnerabilities.length} vulnerabilities (${parts.join(", ")})` : "No vulnerabilities found",
		pass: !hasHighOrCritical,
	};
}

module.exports = { dependencyScan, parseAuditOutput };
