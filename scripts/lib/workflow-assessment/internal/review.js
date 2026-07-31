"use strict";

const path = require("node:path");
const { collectRepositoryEvidence } = require("./repository-evidence");
const { runChecks } = require("./checks");
const { scoreDimensions } = require("./scoring");
const { listProviders } = require("./observation-contract");
const { collectSessionObservations } = require("./providers/amber-native-session");
const { collectClaudeObservations } = require("./providers/claude-transcript");

const DIMENSION_LABELS = {
	contextAdequacy: "Context Adequacy",
	lifecycleDiscipline: "Lifecycle Discipline",
	verificationCoverage: "Verification Coverage",
	deliveryIntegrity: "Delivery Integrity",
	improvementLoop: "Improvement Loop",
};

const CHECK_FOLLOWUP = {
	"ca-1-feature-observable": {
		owner: "feature-list",
		verifier: "feature_list.json features all carry user_visible_behavior and verification.",
		actionKind: "plan-input",
	},
	"ca-2-plan-goal-acceptance": {
		owner: "planning",
		verifier: "Every plan has non-empty Goal and Acceptance Criteria sections.",
		actionKind: "plan-input",
	},
	"ca-3-route-trigger": {
		owner: "routes",
		verifier: "At least one route file is declared under routes/.",
		actionKind: "plan-input",
	},
	"ca-4-agent-docs": {
		owner: "agent-docs",
		verifier: "AGENTS.md, CLAUDE.md, or docs/AGENTS.md is present.",
		actionKind: "plan-input",
	},
	"ld-1-route-gate": {
		owner: "routes",
		verifier: "Every route declares a user-approval gate.",
		actionKind: "plan-input",
	},
	"ld-2-deny-by-default": {
		owner: "governance",
		verifier: "rules.json defaultAction is deny.",
		actionKind: "plan-input",
	},
	"ld-3-worktree-isolation": {
		owner: "workflow-packs",
		verifier: "Every mutating loop uses worktree isolation with review gates.",
		actionKind: "plan-input",
	},
	"ld-4-session-gate-evidence": {
		owner: "sessions",
		verifier: "Lifecycle sessions record gate approvals or denials.",
		actionKind: "plan-input",
	},
	"vc-1-verify-discoverable": {
		owner: "toolchain",
		verifier: "A verify command is discoverable from the toolchain.",
		actionKind: "plan-input",
	},
	"vc-2-execution-commands": {
		owner: "execution",
		verifier: "At least one execution evidence file records commands.",
		actionKind: "plan-input",
	},
	"vc-3-session-validation": {
		owner: "sessions",
		verifier: "Sessions record stage transitions or validation failure counts.",
		actionKind: "plan-input",
	},
	"di-1-handoff-complete": {
		owner: "handoff",
		verifier: "Handoff bundle contains all required files.",
		actionKind: "plan-input",
	},
	"di-2-risks-recorded": {
		owner: "handoff",
		verifier: "Handoff bundle records residual risks and recovery commands.",
		actionKind: "plan-input",
	},
	"il-1-evolution-recurrent": {
		owner: "maintenance",
		verifier: "Evolution log records a recurrent finding (count>=2).",
		actionKind: "maintenance-proposal",
	},
	"il-2-regression-traceable": {
		owner: "maintenance",
		verifier: "A regression proposal with assertion exists.",
		actionKind: "maintenance-proposal",
	},
	"il-3-intervention-validated": {
		owner: "maintenance",
		verifier: "At least one feature reached accepted state after an evolution-log intervention.",
		actionKind: "maintenance-proposal",
	},
};

function resolveSessionCoverage(noSessions, sessionObs, foreignSessionUnsupported) {
	if (noSessions) return "not-applicable";
	if (sessionObs?.present) return sessionObs.coverage || "covered";
	if (foreignSessionUnsupported) return "unsupported";
	return "unavailable";
}

function buildFindings(dimensionResults) {
	const findings = [];
	for (const [dimension, result] of Object.entries(dimensionResults)) {
		for (const check of result.checks) {
			if (check.status === "pass" || check.status === "not-applicable") continue;
			const followup = CHECK_FOLLOWUP[check.id] || {
				owner: "unknown",
				verifier: "Check passes.",
				actionKind: "plan-input",
			};
			const summary = check.note || `${check.id} reported ${check.status}.`;
			findings.push({
				id: check.id,
				dimension,
				severity: check.status === "fail" ? "warning" : "info",
				confidence: result.confidence,
				summary: `${DIMENSION_LABELS[dimension] || dimension}: ${summary}`,
				evidenceRefs: check.evidenceRefs || [],
				owner: followup.owner,
				verifier: followup.verifier,
				actionKind: followup.actionKind,
			});
		}
	}
	const order = { warning: 0, info: 1 };
	findings.sort((left, right) => (order[left.severity] ?? 9) - (order[right.severity] ?? 9));
	return findings;
}

function collectMergedSessionObservations(targetRoot, options = {}) {
	const amber = collectSessionObservations(targetRoot);
	const claude = collectClaudeObservations(targetRoot, {
		claudeHome: options.claudeHome,
	});
	const sessions = [];
	if (amber.present) sessions.push(...(amber.sessions || []));
	if (claude.present) sessions.push(...(claude.sessions || []));
	const present = sessions.length > 0;
	const sources = [];
	if (amber.present) sources.push("amber-native");
	if (claude.present) sources.push("claude");
	return {
		present,
		sessions,
		coverage: present ? "covered" : "unavailable",
		sources,
	};
}

function aggregateCoverage(lanes) {
	if (lanes.length === 0) return "unavailable";
	if (lanes.every((coverage) => coverage === "not-applicable")) {
		return "not-applicable";
	}
	if (lanes.every((coverage) => coverage === "covered")) return "covered";
	if (lanes.some((coverage) => coverage === "covered" || coverage === "partial")) {
		return "partial";
	}
	return "unavailable";
}

function addDimensionNotes(dimensions) {
	const result = {};
	for (const [dimension, value] of Object.entries(dimensions)) {
		const allNotApplicable =
			value.coverage === "not-applicable" &&
			(!value.checks || value.checks.every((check) => check.status === "not-applicable"));
		const note = allNotApplicable
			? "All checks not-applicable; dimension does not penalize."
			: value.note;
		result[dimension] = note ? { ...value, note } : { ...value };
	}
	return result;
}

function buildReport(targetRoot, options = {}) {
	const noSessions = options.noSessions === true;
	const sessionObservations = noSessions
		? null
		: collectMergedSessionObservations(targetRoot, {
				claudeHome: options.claudeHome,
			});
	const evidence = collectRepositoryEvidence(targetRoot, {
		handoffBundleDir: options.handoffBundleDir,
		sessions: sessionObservations?.sessions || [],
	});
	const dimensions = scoreDimensions(runChecks(evidence));
	const providers = listProviders(targetRoot, { claudeHome: options.claudeHome });
	const availableProviders = providers.filter((provider) => provider.available);
	const foreignSessionUnsupported = providers.some(
		(provider) =>
			provider.providerId !== "amber-native" &&
			provider.available &&
			provider.capabilities.sessions === "unsupported",
	);
	const sessionCoverage = resolveSessionCoverage(
		noSessions,
		sessionObservations,
		foreignSessionUnsupported,
	);
	const sessionScope = noSessions
		? "not-applicable"
		: sessionObservations?.present
			? "covered"
			: "unavailable";

	return {
		schemaVersion: "1.0.0",
		target: path.resolve(targetRoot),
		generatedAt: new Date().toISOString(),
		scope: {
			repository: true,
			sessions: sessionScope,
			providers: availableProviders.map((provider) => provider.providerId),
		},
		coverage: {
			repository: aggregateCoverage([
				dimensions.contextAdequacy.coverage,
				dimensions.lifecycleDiscipline.coverage,
				dimensions.verificationCoverage.coverage,
			]),
			session: sessionCoverage,
			delivery: aggregateCoverage([dimensions.deliveryIntegrity.coverage]),
			agentAssets: evidence.agentAssets?.present ? "covered" : "unavailable",
		},
		dimensions: addDimensionNotes(dimensions),
		findings: buildFindings(dimensions),
		sessionObservations: sessionObservations?.sessions || undefined,
	};
}

function buildPlanDraft(target, finding) {
	const lines = [
		`# Plan draft: ${finding.id}`,
		"",
		"## Goal",
		"",
		`Address workflow-effectiveness finding: ${finding.summary}`,
		"",
		"## Acceptance Criteria",
		"",
		`- ${finding.verifier}`,
		"",
		"## Owner",
		"",
		`- ${finding.owner}`,
		"",
		"## Action kind",
		"",
		`- ${finding.actionKind}`,
		"",
		"## Evidence",
		"",
		...(finding.evidenceRefs || []).map((reference) => `- ${reference}`),
		"",
		"## Generated by",
		"",
		"`amber workflow plan --dry-run` — review before applying via `amber plan`.",
	];
	return { target, content: lines.join("\n"), finding, kind: "plan-input" };
}

function buildMaintenanceDraft(target, finding) {
	const lines = [
		`# Maintenance proposal draft: ${finding.id}`,
		"",
		"## Summary",
		"",
		finding.summary,
		"",
		"## Proposed maintenance action",
		"",
		`- Owner: ${finding.owner}`,
		`- Verifier: ${finding.verifier}`,
		"- Action kind: maintenance-proposal",
		"",
		"## Evidence",
		"",
		...(finding.evidenceRefs || []).map((reference) => `- ${reference}`),
		"",
		"## Next command (human-triggered)",
		"",
		"```bash",
		`amber maintenance propose --target "${target}" --output maintenance-plan.md`,
		"```",
		"",
		"## Generated by",
		"",
		"`amber workflow plan --dry-run` — review before applying via `amber maintenance propose`.",
	];
	return { target, content: lines.join("\n"), finding, kind: "maintenance-proposal" };
}

function buildFindingDraft(target, finding) {
	if (finding.actionKind === "maintenance-proposal") {
		return buildMaintenanceDraft(target, finding);
	}
	return buildPlanDraft(target, finding);
}

function coverageRank(state) {
	const ranks = {
		unavailable: 0,
		unsupported: 1,
		"not-applicable": 1,
		partial: 2,
		covered: 3,
	};
	return ranks[state] ?? 0;
}

function compareReports(baseline, current) {
	const baselineVersion = baseline?.schemaVersion || "unknown";
	const currentVersion = current?.schemaVersion || "unknown";
	const versionMismatch = baselineVersion !== currentVersion;
	const dimensions = new Set([
		...Object.keys(baseline?.dimensions || {}),
		...Object.keys(current?.dimensions || {}),
	]);
	const dimensionDeltas = [...dimensions].map((dimension) => {
		const before = baseline?.dimensions?.[dimension];
		const after = current?.dimensions?.[dimension];
		return {
			dimension,
			baselineScore: before?.score ?? null,
			currentScore: after?.score ?? null,
			scoreDelta: before?.score != null && after?.score != null ? after.score - before.score : null,
			baselineCoverage: before?.coverage || "unavailable",
			currentCoverage: after?.coverage || "unavailable",
		};
	});
	const baselineFindingIds = new Set((baseline?.findings || []).map((finding) => finding.id));
	const currentFindingIds = new Set((current?.findings || []).map((finding) => finding.id));
	const suspiciousImprovements = dimensionDeltas.filter(
		(delta) =>
			delta.scoreDelta > 0 &&
			coverageRank(delta.currentCoverage) < coverageRank(delta.baselineCoverage),
	);
	const warnings = [];
	if (versionMismatch) {
		warnings.push(
			`Schema version mismatch: baseline ${baselineVersion} vs current ${currentVersion}; finding deltas may be misleading without explicit migration.`,
		);
	}
	if (suspiciousImprovements.length > 0) {
		warnings.push(
			`Higher score with lower coverage in: ${suspiciousImprovements.map((item) => item.dimension).join(", ")}`,
		);
	}
	return {
		dimensionDeltas,
		findingsAdded: [...currentFindingIds].filter((id) => !baselineFindingIds.has(id)),
		findingsResolved: [...baselineFindingIds].filter((id) => !currentFindingIds.has(id)),
		suspiciousImprovements,
		coverageBaseline: baseline?.coverage || {},
		coverageCurrent: current?.coverage || {},
		schemaVersionBaseline: baselineVersion,
		schemaVersionCurrent: currentVersion,
		versionMismatch,
		warnings,
	};
}

module.exports = {
	buildFindingDraft,
	buildReport,
	compareReports,
};
