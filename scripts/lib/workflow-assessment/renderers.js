"use strict";

// ADR-0008 P1: Markdown + JSON renderers. stdout parser-safe, diagnostics on
// stderr. Renderers consume the report contract object (schema-conformant).

function renderJson(report) {
	return JSON.stringify(report, null, 2);
}

function renderMarkdown(report) {
	const lines = [];
	lines.push("# Workflow Effectiveness Assessment");
	lines.push("");
	lines.push(`- **Target:** ${report.target}`);
	lines.push(`- **Generated:** ${report.generatedAt || "(not set)"}`);
	lines.push(`- **Scope:** repository=${report.scope.repository}, sessions=${report.scope.sessions}, providers=[${(report.scope.providers || []).join(", ")}]`);
	lines.push("");
	lines.push("## Coverage");
	for (const [lane, state] of Object.entries(report.coverage)) {
		lines.push(`- ${lane}: ${state}`);
	}
	lines.push("");
	lines.push("## Dimensions");
	for (const [dim, d] of Object.entries(report.dimensions)) {
		const score = d.score === null ? "insufficient evidence" : `${d.score}/100`;
		lines.push(`### ${dim}`);
		lines.push(`- **Score:** ${score}`);
		lines.push(`- **Confidence:** ${d.confidence}`);
		lines.push(`- **Coverage:** ${d.coverage}`);
		if (d.evidenceRefs && d.evidenceRefs.length > 0) {
			lines.push(`- **Evidence:** ${d.evidenceRefs.join(", ")}`);
		}
		if (d.note) lines.push(`- **Note:** ${d.note}`);
		if (d.checks && d.checks.length > 0) {
			lines.push("");
			lines.push("| Check | Status | Note |");
			lines.push("|---|---|---|");
			for (const c of d.checks) {
				const note = (c.note || "").replace(/\|/g, "\\|");
				lines.push(`| ${c.id} | ${c.status} | ${note} |`);
			}
		}
		lines.push("");
	}
	if (report.findings && report.findings.length > 0) {
		lines.push("## Findings");
		for (const f of report.findings) {
			lines.push(`### ${f.id} (${f.severity})`);
			lines.push(`- **Dimension:** ${f.dimension}`);
			lines.push(`- **Confidence:** ${f.confidence}`);
			lines.push(`- **Summary:** ${f.summary}`);
			lines.push(`- **Evidence:** ${(f.evidenceRefs || []).join(", ")}`);
			lines.push(`- **Owner:** ${f.owner}`);
			lines.push(`- **Verifier:** ${f.verifier}`);
			lines.push(`- **Action kind:** ${f.actionKind}`);
			lines.push("");
		}
	} else {
		lines.push("## Findings");
		lines.push("");
		lines.push("_None._");
		lines.push("");
	}
	return lines.join("\n");
}

module.exports = { renderJson, renderMarkdown };
