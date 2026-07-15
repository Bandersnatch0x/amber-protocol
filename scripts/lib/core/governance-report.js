"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { inspectMaintenance } = require("./maintenance");
const { resolveRegistryPath } = require("./team");
const { inspectGovernanceReadiness, ACTION_LIBRARY } = require("./governance-readiness");
const { resolveTarget } = require("./fs-utils");
const { gatherState, buildContext, inferNextStep } = require("./lifecycle");
const { shellQuote } = require("./text-utils");

const PRODUCT_VALUE_LOOP = "Assess repo -> Score risks -> Recommend next actions -> Run governed workflow -> Verify evidence -> Produce handoff bundle";

function clampScore(value) {
	return Math.max(0, Math.min(100, Math.round(value)));
}

function penaltyFor(ids, findings, { warning = 8, error = 24 } = {}) {
	const set = new Set(ids);
	return findings
		.filter((finding) => set.has(finding.id))
		.reduce((total, finding) => total + (finding.severity === "error" ? error : warning), 0);
}

function scoreSections(readiness, maintenance) {
	const findings = readiness.findings || [];
	const governance = 100 - penaltyFor([
		"policy-error",
		"policy-warning",
		"missing-governance-doc",
		"missing-governance-rules",
		"unsafe-default-allow",
		"workflow-pack-read-error",
	], findings);

	const evidence = 100 - penaltyFor([
		"no-audit-evidence",
		"ledger-tampered",
	], findings, { warning: 35, error: 60 });

	const continuityPenalty =
		penaltyFor(["route-error", "workflow-pack-read-error"], findings, { warning: 10, error: 30 }) +
		Math.min(30, ((maintenance.staleDocs || []).length) * 3) +
		((maintenance.wikiLint?.errors || []).length > 0 ? 20 : 0);

	const safety = 100 - penaltyFor([
		"unsafe-user-approval",
		"route-without-gates",
		"pack-missing-review-gates",
		"pack-missing-worktree-isolation",
		"missing-security-standard",
		"security-pack-not-linked",
		"unsafe-default-allow",
	], findings, { warning: 10, error: 35 });

	const maintenancePenalty =
		Math.min(35, ((maintenance.staleDocs || []).length) * 4) +
		((maintenance.rulePackDrift?.drifted) ? 20 : 0) +
		((maintenance.scaffoldDrift?.drifted) ? 20 : 0) +
		((maintenance.artifactDrift?.drifted) ? 15 : 0) +
		Math.min(20, ((maintenance.errors || []).length) * 10);

	const scores = {
		governance: clampScore(governance),
		evidence: clampScore(evidence),
		continuity: clampScore(100 - continuityPenalty),
		safety: clampScore(safety),
		maintenance: clampScore(100 - maintenancePenalty),
	};
	scores.overall = clampScore(
		scores.governance * 0.25 +
		scores.evidence * 0.25 +
		scores.continuity * 0.2 +
		scores.safety * 0.2 +
		scores.maintenance * 0.1,
	);
	return scores;
}

function severityRank(severity) {
	return { high: 0, medium: 1, low: 2 }[severity] ?? 3;
}

function actionFromFinding(finding, targetDisplay) {
	const template = ACTION_LIBRARY[finding.id];
	if (!template) {
		return null;
	}
	return {
		id: finding.id,
		severity: template.severity,
		why: template.why,
		command: template.command.replace(/<repo>/g, shellQuote(targetDisplay)),
		expectedOutcome: template.expectedOutcome,
		blocks: [...template.blocks],
		finding: finding.message,
	};
}

function lifecycleAction(targetRoot, targetDisplay) {
	const ctx = buildContext(targetRoot, { target: targetDisplay, strict: true });
	const next = inferNextStep(ctx);
	if (!next) return null;
	return {
		id: `lifecycle-${next.id}`,
		severity: next.id === "init" || next.id === "feature" ? "high" : "medium",
		why: next.why,
		command: next.remedy.replace(/^amber\s+/, "node scripts/amber.js "),
		expectedOutcome: `Lifecycle advances past: ${next.label}.`,
		blocks: ["product-loop", "next-command"],
		finding: next.label,
	};
}

function buildStructuredNextActions(readiness, targetRoot, targetDisplay) {
	const actions = [];
	const seen = new Set();
	for (const finding of readiness.findings || []) {
		const action = actionFromFinding(finding, targetDisplay);
		if (!action || seen.has(action.id)) continue;
		seen.add(action.id);
		actions.push(action);
	}
	const lifecycle = lifecycleAction(targetRoot, targetDisplay);
	if (lifecycle && !seen.has(lifecycle.id)) {
		actions.push(lifecycle);
	}
	return actions.sort((left, right) =>
		severityRank(left.severity) - severityRank(right.severity) || left.id.localeCompare(right.id),
	);
}

function decisionFromScore(score, readinessDecision) {
	if (readinessDecision === "block" || score < 60) return "block";
	if (readinessDecision === "warn" || score < 85) return "warn";
	return "ready";
}

function buildGovernanceReport(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const targetDisplay = options.targetDisplay || target || ".";
	const readiness = inspectGovernanceReadiness(targetRoot);
	const maintenance = inspectMaintenance(targetRoot, resolveRegistryPath(options.registry));
	const scores = scoreSections(readiness, maintenance);
	const nextActions = buildStructuredNextActions(readiness, targetRoot, targetDisplay);
	const state = gatherState(targetRoot);
	const evidenceCount = state.features.reduce((total, feature) => total + (Array.isArray(feature.evidence) ? feature.evidence.length : 0), 0);

	return {
		target: targetRoot,
		generatedAt: options.generatedAt || new Date().toISOString(),
		productValueLoop: PRODUCT_VALUE_LOOP,
		decision: decisionFromScore(scores.overall, readiness.decision),
		scores,
		summary: {
			features: state.features.length,
			featureEvidence: evidenceCount,
			readinessFindings: (readiness.findings || []).length,
			staleDocs: (maintenance.staleDocs || []).length,
			maintenanceErrors: (maintenance.errors || []).length,
		},
		readiness: {
			decision: readiness.decision,
			findings: readiness.findings || [],
			sections: readiness.sections,
		},
		maintenance: {
			staleDocs: maintenance.staleDocs || [],
			wikiLint: maintenance.wikiLint || {},
			rulePackDrift: maintenance.rulePackDrift || {},
			scaffoldDrift: maintenance.scaffoldDrift || {},
			artifactDrift: maintenance.artifactDrift || {},
			errors: maintenance.errors || [],
			warnings: maintenance.warnings || [],
		},
		nextActions,
		errors: readiness.errors || [],
		warnings: [...(readiness.warnings || []), ...(maintenance.warnings || [])],
	};
}

function renderScores(scores) {
	return [
		`- Overall: ${scores.overall}/100`,
		`- Governance: ${scores.governance}/100`,
		`- Evidence: ${scores.evidence}/100`,
		`- Continuity: ${scores.continuity}/100`,
		`- Safety: ${scores.safety}/100`,
		`- Maintenance: ${scores.maintenance}/100`,
	];
}

function renderGovernanceReportMarkdown(report) {
	const lines = [
		"# Amber Governance Report",
		"",
		`**Target:** ${report.target}`,
		`**Generated:** ${report.generatedAt}`,
		`**Decision:** ${report.decision}`,
		"",
		"## Amber Readiness Score",
		"",
		...renderScores(report.scores),
		"",
		"## Product Value Loop",
		"",
		`${report.productValueLoop}`,
		"",
		"## Summary",
		"",
		`- Features registered: ${report.summary.features}`,
		`- Feature evidence records: ${report.summary.featureEvidence}`,
		`- Readiness findings: ${report.summary.readinessFindings}`,
		`- Stale docs: ${report.summary.staleDocs}`,
		"",
		"## Next Actions",
		"",
	];

	if (report.nextActions.length === 0) {
		lines.push("- None. The repository is ready to produce or validate a handoff bundle.");
	} else {
		for (const action of report.nextActions) {
			lines.push(`- **${action.severity}** \`${action.id}\`: ${action.why}`);
			lines.push(`  - Run: \`${action.command}\``);
			lines.push(`  - Expected outcome: ${action.expectedOutcome}`);
			lines.push(`  - Blocks: ${action.blocks.join(", ")}`);
		}
	}

	lines.push("", "## Findings", "");
	if (report.readiness.findings.length === 0) {
		lines.push("- None.");
	} else {
		for (const finding of report.readiness.findings) {
			lines.push(`- **${finding.severity}** \`${finding.id}\`: ${finding.message}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

function renderGovernanceReportText(report) {
	const lines = [
		`Amber Governance Report: ${report.target}`,
		`Decision: ${report.decision}`,
		`Amber Readiness Score: ${report.scores.overall}/100`,
		`Product Value Loop: ${report.productValueLoop}`,
		"Scores:",
		...renderScores(report.scores).map((line) => `  ${line.slice(2)}`),
		"Next Actions:",
	];
	if (report.nextActions.length === 0) {
		lines.push("  - none");
	} else {
		for (const action of report.nextActions) {
			lines.push(`  - [${action.severity}] ${action.id}: ${action.why}`);
			lines.push(`    Run: ${action.command}`);
		}
	}
	return lines.join("\n");
}

function writeGovernanceReportMarkdown(report, outputPath) {
	const output = path.resolve(outputPath);
	fs.mkdirSync(path.dirname(output), { recursive: true });
	fs.writeFileSync(output, renderGovernanceReportMarkdown(report));
	return output;
}

module.exports = {
	PRODUCT_VALUE_LOOP,
	buildGovernanceReport,
	buildStructuredNextActions,
	renderGovernanceReportMarkdown,
	renderGovernanceReportText,
	writeGovernanceReportMarkdown,
};
