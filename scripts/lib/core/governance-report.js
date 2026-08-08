"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { inspect: inspectMaintenance } = require("../maintenance");
const { resolveRegistryPath } = require("./team");
const { inspectGovernanceReadiness, ACTION_LIBRARY } = require("./governance-readiness");
const { readJsonSafe, resolveTarget } = require("./fs-utils");
const { resolveStateDirForRead } = require("../state-dir-resolver");
const { gatherState, buildContext, inferNextStep } = require("./lifecycle");
const { shellQuote } = require("./text-utils");
const { detectNoProgress } = require("../workflow-assessment");
const { loadSessionEvidence } = require("../session-evidence");

const PRODUCT_VALUE_LOOP =
	"Assess repo -> Score risks -> Recommend next actions -> Run governed workflow -> Verify evidence -> Produce handoff bundle";

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
	const governance =
		100 -
		penaltyFor(
			[
				"policy-error",
				"policy-warning",
				"missing-governance-doc",
				"missing-governance-rules",
				"unsafe-default-allow",
				"workflow-pack-read-error",
			],
			findings,
		);

	const evidence =
		100 -
		penaltyFor(["no-audit-evidence", "ledger-tampered"], findings, { warning: 35, error: 60 });

	const continuityPenalty =
		penaltyFor(["route-error", "workflow-pack-read-error"], findings, { warning: 10, error: 30 }) +
		Math.min(30, (maintenance.staleDocs || []).length * 3) +
		((maintenance.wikiLint?.errors || []).length > 0 ? 20 : 0);

	const safety =
		100 -
		penaltyFor(
			[
				"unsafe-user-approval",
				"route-without-gates",
				"pack-missing-review-gates",
				"pack-missing-worktree-isolation",
				"missing-security-standard",
				"security-pack-not-linked",
				"unsafe-default-allow",
			],
			findings,
			{ warning: 10, error: 35 },
		);

	const maintenancePenalty =
		Math.min(35, (maintenance.staleDocs || []).length * 4) +
		(maintenance.rulePackDrift?.drifted ? 20 : 0) +
		(maintenance.scaffoldDrift?.drifted ? 20 : 0) +
		(maintenance.artifactDrift?.drifted ? 15 : 0) +
		Math.min(20, (maintenance.errors || []).length * 10);

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
	return actions.sort(
		(left, right) =>
			severityRank(left.severity) - severityRank(right.severity) || left.id.localeCompare(right.id),
	);
}

function decisionFromScore(score, readinessDecision) {
	if (readinessDecision === "block" || score < 60) return "block";
	if (readinessDecision === "warn" || score < 85) return "warn";
	return "ready";
}

// ADR-0013 no-progress inputs: gather existing artifacts only. Missing state
// dirs / files yield empty collectors — the detector then reports nothing,
// which is the correct failure mode for a read-only assessor.

function collectLoopContract(targetRoot) {
	const packsDir = path.join(targetRoot, "workflow-packs");
	if (!fs.existsSync(packsDir)) return null;
	const files = fs
		.readdirSync(packsDir)
		.filter((name) => name.endsWith(".pack.json"))
		.sort();
	for (const name of files) {
		const pack = readJsonSafe(path.join(packsDir, name)).value;
		if (pack && Array.isArray(pack.loopContracts) && pack.loopContracts.length > 0) {
			return pack.loopContracts[0];
		}
	}
	return null;
}

function collectRules(targetRoot) {
	const stateDir = resolveStateDirForRead(targetRoot);
	const rulesPath = path.join(stateDir, "governance", "rules.json");
	if (!fs.existsSync(rulesPath)) return [];
	const value = readJsonSafe(rulesPath).value;
	if (Array.isArray(value)) return value;
	if (Array.isArray(value?.rules)) return value.rules;
	return value && typeof value === "object" ? value : [];
}

// Confidence-class summary (issue #110). computeConfidenceClasses lives in
// governance-readiness.js and is owned by a parallel agent; guard both the
// lookup and the call so this report keeps building if it is not merged yet.
function collectConfidenceSummary(targetRoot) {
	try {
		const { computeConfidenceClasses } = require("./governance-readiness");
		if (typeof computeConfidenceClasses !== "function") {
			return { available: false, summary: "confidence gating: unavailable" };
		}
		const classes = computeConfidenceClasses(collectRules(targetRoot));
		if (!Array.isArray(classes) || classes.length === 0) {
			return { available: false, summary: "confidence gating: unavailable" };
		}
		const counts = { high: 0, medium: 0, low: 0 };
		for (const item of classes) {
			if (item && typeof item.confidence === "string" && item.confidence in counts) {
				counts[item.confidence] += 1;
			}
		}
		return {
			available: true,
			classes,
			summary: `confidence gating: high ${counts.high}, medium ${counts.medium}, low ${counts.low}`,
		};
	} catch {
		return { available: false, summary: "confidence gating: unavailable" };
	}
}

function collectWorkflowEffectiveness(targetRoot, sessionId) {
	let evidence;
	try {
		evidence = loadSessionEvidence(targetRoot, sessionId);
	} catch (error) {
		// Shared session-evidence is fail-closed; the report degrades with an
		// explicit unavailable signal so corrupt evidence is not mistaken for
		// "no evidence".
		return {
			available: false,
			reason: "session-evidence-unavailable",
			detail: error && error.message ? error.message : String(error),
			noProgress: detectNoProgress({
				timelineEvents: [],
				resultEvidence: [],
				loopContract: collectLoopContract(targetRoot),
			}),
			confidence: collectConfidenceSummary(targetRoot),
		};
	}
	return {
		available: true,
		noProgress: detectNoProgress({
			timelineEvents: evidence.timelineEvents,
			resultEvidence: evidence.resultEvidence,
			loopContract: collectLoopContract(targetRoot),
		}),
		confidence: collectConfidenceSummary(targetRoot),
	};
}

function buildGovernanceReport(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const targetDisplay = options.targetDisplay || target || ".";
	const readiness = inspectGovernanceReadiness(targetRoot);
	const maintenance = inspectMaintenance(targetRoot, resolveRegistryPath(options.registry));
	const scores = scoreSections(readiness, maintenance);
	const nextActions = buildStructuredNextActions(readiness, targetRoot, targetDisplay);
	const state = gatherState(targetRoot);
	const evidenceCount = state.features.reduce(
		(total, feature) => total + (Array.isArray(feature.evidence) ? feature.evidence.length : 0),
		0,
	);
	const errors = [...(readiness.errors || []), ...(maintenance.errors || [])];
	const readinessDecision = errors.length > 0 ? "block" : readiness.decision;

	return {
		target: targetRoot,
		generatedAt: options.generatedAt || new Date().toISOString(),
		productValueLoop: PRODUCT_VALUE_LOOP,
		decision: decisionFromScore(scores.overall, readinessDecision),
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
		workflowEffectiveness: collectWorkflowEffectiveness(targetRoot, state.activeSessionId),
		nextActions,
		errors,
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

function renderNextActionsMarkdown(actions) {
	if (actions.length === 0) {
		return ["- None. The repository is ready to produce or validate a handoff bundle."];
	}
	const lines = [];
	for (const action of actions) {
		lines.push(`- **${action.severity}** \`${action.id}\`: ${action.why}`);
		lines.push(`  - Run: \`${action.command}\``);
		lines.push(`  - Expected outcome: ${action.expectedOutcome}`);
		lines.push(`  - Blocks: ${action.blocks.join(", ")}`);
	}
	return lines;
}

function renderFindingsMarkdown(findings) {
	if (findings.length === 0) return ["- None."];
	return findings.map(
		(finding) => `- **${finding.severity}** \`${finding.id}\`: ${finding.message}`,
	);
}

function renderWorkflowEffectivenessMarkdown(effectiveness = {}) {
	const lines = [`- ${effectiveness.confidence?.summary || "confidence gating: unavailable"}`];
	const noProgress = effectiveness.noProgress || [];
	if (noProgress.length === 0) {
		lines.push("- No-progress findings: none.");
		return lines;
	}
	lines.push(`- No-progress findings: ${noProgress.length}`);
	for (const finding of noProgress) {
		lines.push(
			`  - **${finding.severity}** \`${finding.id}\`: ${finding.title} — ${finding.detail}`,
		);
	}
	return lines;
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
		...renderNextActionsMarkdown(report.nextActions),
		"",
		"## Findings",
		"",
		...renderFindingsMarkdown(report.readiness.findings),
		"",
		"## Workflow Effectiveness",
		"",
		...renderWorkflowEffectivenessMarkdown(report.workflowEffectiveness),
		"",
	];
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
	const effectiveness = report.workflowEffectiveness || {};
	lines.push(
		"Workflow Effectiveness:",
		`  ${effectiveness.confidence?.summary || "confidence gating: unavailable"}`,
		`  No-progress findings: ${(effectiveness.noProgress || []).length}`,
	);
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
