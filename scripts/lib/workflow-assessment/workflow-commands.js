"use strict";

// ADR-0008: CLI orchestration for the workflow command family. assess builds
// the report (repository evidence + amber-native sessions by default);
// findings/plan/compare operate on prior reports. Read-only by default; assess
// writes a report file only when --output-dir is given.

const path = require("node:path");
const fs = require("node:fs");
const { resolveTarget, isMissingPath } = require("../core/fs-utils");
const { collectRepositoryEvidence } = require("./repository-evidence");
const { runChecks } = require("./checks");
const { scoreDimensions } = require("./scoring");
const { listProviders } = require("./observation-contract");
const { renderJson, renderMarkdown } = require("./renderers");
const { collectSessionObservations } = require("./providers/amber-native-session");
const { collectClaudeObservations } = require("./providers/claude-transcript");

const DIMENSION_LABELS = {
	contextAdequacy: "Context Adequacy",
	lifecycleDiscipline: "Lifecycle Discipline",
	verificationCoverage: "Verification Coverage",
	deliveryIntegrity: "Delivery Integrity",
	improvementLoop: "Improvement Loop",
};

// Finding owner/verifier/actionKind per check, for checks that did not pass.
const CHECK_FOLLOWUP = {
	"ca-1-feature-observable": { owner: "feature-list", verifier: "feature_list.json features all carry user_visible_behavior and verification.", actionKind: "plan-input" },
	"ca-2-plan-goal-acceptance": { owner: "planning", verifier: "Every plan has non-empty Goal and Acceptance Criteria sections.", actionKind: "plan-input" },
	// P1 only asserts route files exist — trigger-content matching is not inspected.
	"ca-3-route-trigger": { owner: "routes", verifier: "At least one route file is declared under routes/.", actionKind: "plan-input" },
	"ca-4-agent-docs": { owner: "agent-docs", verifier: "AGENTS.md, CLAUDE.md, or docs/AGENTS.md is present.", actionKind: "plan-input" },
	"ld-1-route-gate": { owner: "routes", verifier: "Every route declares a user-approval gate.", actionKind: "plan-input" },
	"ld-2-deny-by-default": { owner: "governance", verifier: "rules.json defaultAction is deny.", actionKind: "plan-input" },
	"ld-3-worktree-isolation": { owner: "workflow-packs", verifier: "Every mutating loop uses worktree isolation with review gates.", actionKind: "plan-input" },
	"ld-4-session-gate-evidence": { owner: "sessions", verifier: "Lifecycle sessions record gate approvals or denials.", actionKind: "plan-input" },
	"vc-1-verify-discoverable": { owner: "toolchain", verifier: "A verify command is discoverable from the toolchain.", actionKind: "plan-input" },
	"vc-2-execution-commands": { owner: "execution", verifier: "At least one execution evidence file records commands.", actionKind: "plan-input" },
	"vc-3-session-validation": { owner: "sessions", verifier: "Sessions record stage transitions or validation failure counts.", actionKind: "plan-input" },
	"di-1-handoff-complete": { owner: "handoff", verifier: "Handoff bundle contains all required files.", actionKind: "plan-input" },
	"di-2-risks-recorded": { owner: "handoff", verifier: "Handoff bundle records residual risks and recovery commands.", actionKind: "plan-input" },
	"il-1-evolution-recurrent": { owner: "maintenance", verifier: "Evolution log records a recurrent finding (count>=2).", actionKind: "maintenance-proposal" },
	"il-2-regression-traceable": { owner: "maintenance", verifier: "A regression proposal with assertion exists.", actionKind: "maintenance-proposal" },
	"il-3-intervention-validated": { owner: "maintenance", verifier: "At least one feature reached accepted state after an evolution-log intervention.", actionKind: "maintenance-proposal" },
};

/**
 * Resolve top-level coverage.session (ADR-0008 §Consequences).
 * - noSessions: user opt-out → not-applicable
 * - amber-native has sessions → that provider's coverage (covered)
 * - no amber sessions + foreign provider available with sessions unsupported
 *   → unsupported (evidence may exist elsewhere but cannot be read)
 * - otherwise → unavailable
 */
function resolveSessionCoverage(noSessions, sessionObs, foreignSessionUnsupported) {
	if (noSessions) return "not-applicable";
	if (sessionObs?.present) return sessionObs.coverage || "covered";
	if (foreignSessionUnsupported) return "unsupported";
	return "unavailable";
}

function buildFindings(dimensionResults) {
	const findings = [];
	for (const [dim, d] of Object.entries(dimensionResults)) {
		for (const check of d.checks) {
			if (check.status === "pass" || check.status === "not-applicable") continue;
			const followup = CHECK_FOLLOWUP[check.id] || { owner: "unknown", verifier: "Check passes.", actionKind: "plan-input" };
			const severity = check.status === "fail" ? "warning" : "info";
			const dimensionLabel = DIMENSION_LABELS[dim] || dim;
			const summary = check.note || `${check.id} reported ${check.status}.`;
			findings.push({
				id: check.id,
				dimension: dim,
				severity,
				confidence: d.confidence,
				summary: `${dimensionLabel}: ${summary}`,
				evidenceRefs: check.evidenceRefs || [],
				owner: followup.owner,
				verifier: followup.verifier,
				actionKind: followup.actionKind,
			});
		}
	}
	// Severity sort: warning before info; keep stable order otherwise.
	const order = { warning: 0, info: 1 };
	findings.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
	return findings;
}

/**
 * Collect amber-native + Claude host transcript observations for P2.
 * The two sources are concatenated as-is — no cross-provider dedup: they
 * observe different planes (amber-native = lifecycle/gate events, claude =
 * host tool telemetry), so one work item may legitimately appear in both.
 * Returns { present, sessions, coverage, sources }.
 */
function collectMergedSessionObservations(targetRoot, options = {}) {
	const amber = collectSessionObservations(targetRoot);
	const claude = collectClaudeObservations(targetRoot, { claudeHome: options.claudeHome });
	const sessions = [];
	if (amber.present) sessions.push(...(amber.sessions || []));
	if (claude.present) sessions.push(...(claude.sessions || []));
	const present = sessions.length > 0;
	// covered if any provider contributed; partial never used at this layer.
	const coverage = present ? "covered" : "unavailable";
	const sources = [];
	if (amber.present) sources.push("amber-native");
	if (claude.present) sources.push("claude");
	return { present, sessions, coverage, sources };
}

function buildReport(targetRoot, options = {}) {
	// Sessions are read from amber-native + Claude (P2b) by default.
	// --no-sessions excludes them, reproducing the repository-only baseline.
	// options.claudeHome overrides the Claude home root (test injection only —
	// not exposed as a CLI flag).
	const noSessions = options.noSessions === true;
	const sessionObs = noSessions
		? null
		: collectMergedSessionObservations(targetRoot, { claudeHome: options.claudeHome });
	const evidence = collectRepositoryEvidence(targetRoot, {
		handoffBundleDir: options.handoffBundleDir,
		sessions: sessionObs?.sessions || [],
	});
	const checksByDimension = runChecks(evidence);
	const dimensions = scoreDimensions(checksByDimension);
	const findings = buildFindings(dimensions);

	const dimensionsWithNotes = {};
	for (const [dim, d] of Object.entries(dimensions)) {
		// Only add note when there's content; undefined note would survive
		// deep-equal as a present-but-undefined key (JSON drops it), causing
		// a round-trip mismatch against parsed JSON.
		const note = (d.coverage === "not-applicable" && (!d.checks || d.checks.every((c) => c.status === "not-applicable")))
			? "All checks not-applicable; dimension does not penalize."
			: d.note;
		dimensionsWithNotes[dim] = note ? { ...d, note } : { ...d };
	}

	// Top-level coverage is derived from dimension coverage + provider
	// availability, not hardcoded. A lane is 'covered' only when its backing
	// dimensions are covered; 'partial' when some are; 'not-applicable' when
	// all backing dimensions are not-applicable; 'unavailable' when no
	// evidence. ADR-0008 §Consequences: foreign-provider users see 'unsupported'
	// for session, never fabricated 'covered'.
	const aggregateCoverage = (lanes) => {
		if (lanes.length === 0) return "unavailable";
		if (lanes.every((c) => c === "not-applicable")) return "not-applicable";
		if (lanes.every((c) => c === "covered")) return "covered";
		if (lanes.some((c) => c === "covered") || lanes.some((c) => c === "partial")) return "partial";
		return "unavailable";
	};
	const providers = listProviders(targetRoot, { claudeHome: options.claudeHome });
	const availableProviders = providers.filter((p) => p.available);
	// A foreign provider that is available but cannot supply sessions. When
	// no readable session evidence exists and such a provider exists, session
	// coverage is "unsupported" rather than "unavailable" — ADR-0008.
	// Currently only reachable in unit tests: claude declares sessions
	// supported (P2b) and codex/cursor are never available until P3. Kept for
	// the P3 providers; resolveSessionCoverage locks the semantics via tests.
	const foreignSessionUnsupported = providers.some(
		(p) => p.providerId !== "amber-native" && p.available && p.capabilities.sessions === "unsupported",
	);

	const sessionCoverage = resolveSessionCoverage(noSessions, sessionObs, foreignSessionUnsupported);
	const sessionScope = noSessions
		? "not-applicable"
		: (sessionObs?.present ? "covered" : "unavailable");

	// agentAssets lane: driven by dedicated agent-doc evidence, not Context Adequacy.
	const agentAssetsCoverage = evidence.agentAssets?.present ? "covered" : "unavailable";

	return {
		schemaVersion: "1.0.0",
		target: path.resolve(targetRoot),
		generatedAt: new Date().toISOString(),
		scope: {
			repository: true,
			sessions: sessionScope,
			providers: availableProviders.map((p) => p.providerId),
		},
		coverage: {
			repository: aggregateCoverage([
				dimensions.contextAdequacy.coverage,
				dimensions.lifecycleDiscipline.coverage,
				dimensions.verificationCoverage.coverage,
			]),
			session: sessionCoverage,
			delivery: aggregateCoverage([dimensions.deliveryIntegrity.coverage]),
			agentAssets: agentAssetsCoverage,
		},
		dimensions: dimensionsWithNotes,
		findings,
		sessionObservations: sessionObs?.sessions || undefined,
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
		...((finding.evidenceRefs || []).map((r) => `- ${r}`)),
		"",
		"## Generated by",
		"",
		"`amber workflow plan --dry-run` — review before applying via `amber plan`.",
	];
	return { target, content: lines.join("\n"), finding, kind: "plan-input" };
}

/** Dry-run bridge for actionKind=maintenance-proposal (ADR-0008). */
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
		`- Action kind: maintenance-proposal`,
		"",
		"## Evidence",
		"",
		...((finding.evidenceRefs || []).map((r) => `- ${r}`)),
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

function readReportFile(filePath) {
	// Align error messaging with fs-utils: distinguish "not found" from
	// "unparseable" so callers and users get a precise, machine-friendly cause.
	if (isMissingPath(filePath)) {
		return { errors: [`Report not found: ${filePath}.`] };
	}
	try {
		const raw = fs.readFileSync(path.resolve(filePath), "utf8");
		return JSON.parse(raw);
	} catch (err) {
		return { errors: [`Invalid JSON in report ${filePath}: ${err.message}.`] };
	}
}

function assessWorkflow(args) {
	const targetRoot = resolveTarget(args.target);
	const format = args.format === "markdown" ? "markdown" : "json";
	const report = buildReport(targetRoot, {
		noSessions: args.noSessions === true, // P2: sessions included by default; --no-sessions excludes
		handoffBundleDir: args.handoffBundleDir,
	});

	let output = "";
	if (format === "markdown") {
		output = renderMarkdown(report);
	} else {
		output = renderJson(report);
	}

	const result = {
		target: targetRoot,
		format,
		report,
		errors: [],
		warnings: [],
	};

	if (args.outputDir) {
		const outDir = path.resolve(args.outputDir);
		fs.mkdirSync(outDir, { recursive: true });
		const ext = format === "markdown" ? "md" : "json";
		const outPath = path.join(outDir, `workflow-assessment.${ext}`);
		fs.writeFileSync(outPath, output, "utf8");
		result.outputPath = outPath;
	}

	return result;
}

function findingsFromReport(report) {
	const list = Array.isArray(report?.findings) ? report.findings : [];
	return { target: report?.target || ".", findings: list, count: list.length, errors: [], warnings: [] };
}

function compareReports(baseline, current) {
	// ADR-0008 P3: explicit schema-version compatibility. Mismatched versions
	// produce a warning so finding-ID deltas are not silently misleading.
	const baselineVersion = baseline?.schemaVersion || "unknown";
	const currentVersion = current?.schemaVersion || "unknown";
	const versionMismatch = baselineVersion !== currentVersion;
	const versionWarnings = versionMismatch
		? [`Schema version mismatch: baseline ${baselineVersion} vs current ${currentVersion}; finding deltas may be misleading without explicit migration.`]
		: [];
	const dims = new Set([
		...Object.keys(baseline?.dimensions || {}),
		...Object.keys(current?.dimensions || {}),
	]);
	const dimensionDeltas = [];
	for (const dim of dims) {
		const b = baseline?.dimensions?.[dim];
		const c = current?.dimensions?.[dim];
		dimensionDeltas.push({
			dimension: dim,
			baselineScore: b?.score ?? null,
			currentScore: c?.score ?? null,
			scoreDelta: (b?.score != null && c?.score != null) ? c.score - b.score : null,
			baselineCoverage: b?.coverage || "unavailable",
			currentCoverage: c?.coverage || "unavailable",
		});
	}
	const baselineFindingIds = new Set((baseline?.findings || []).map((f) => f.id));
	const currentFindingIds = new Set((current?.findings || []).map((f) => f.id));
	const added = [...currentFindingIds].filter((id) => !baselineFindingIds.has(id));
	const resolved = [...baselineFindingIds].filter((id) => !currentFindingIds.has(id));

	// Flag a higher score with lower coverage (ADR-0008 §Longitudinal).
	const suspicious = dimensionDeltas.filter(
		(d) => d.scoreDelta > 0 && coverageRank(d.currentCoverage) < coverageRank(d.baselineCoverage),
	);

	return {
		dimensionDeltas,
		findingsAdded: added,
		findingsResolved: resolved,
		suspiciousImprovements: suspicious,
		coverageBaseline: baseline?.coverage || {},
		coverageCurrent: current?.coverage || {},
		schemaVersionBaseline: baselineVersion,
		schemaVersionCurrent: currentVersion,
		versionMismatch,
		errors: [],
		warnings: [...versionWarnings, ...(suspicious.length > 0 ? [`Higher score with lower coverage in: ${suspicious.map((s) => s.dimension).join(", ")}`] : [])],
	};
}

function coverageRank(state) {
	const ranks = { unavailable: 0, unsupported: 1, "not-applicable": 1, partial: 2, covered: 3 };
	return ranks[state] ?? 0;
}

function workflowDispatch(action, target, args) {
	if (action === "assess") {
		return assessWorkflow(args);
	}
	if (action === "findings") {
		const reportPath = args.report;
		if (!reportPath) {
			return { target: target || ".", errors: ["'amber workflow findings' requires --report <path>"], warnings: [] };
		}
		const report = readReportFile(reportPath);
		if (report.errors) return { target: target || ".", errors: report.errors, warnings: [] };
		return findingsFromReport(report);
	}
	if (action === "compare") {
		if (!args.baseline || !args.current) {
			return { target: target || ".", errors: ["'amber workflow compare' requires --baseline <path> --current <path>"], warnings: [] };
		}
		const baseline = readReportFile(args.baseline);
		const current = readReportFile(args.current);
		if (baseline.errors) return { target: target || ".", errors: baseline.errors, warnings: [] };
		if (current.errors) return { target: target || ".", errors: current.errors, warnings: [] };
		return compareReports(baseline, current);
	}
	if (action === "plan") {
		const reportPath = args.report;
		const findingId = args.finding;
		if (!reportPath || !findingId) {
			return { target: target || ".", errors: ["'amber workflow plan' requires --report <path> --finding <id> [--dry-run]"], warnings: [] };
		}
		const report = readReportFile(reportPath);
		if (report.errors) return { target: target || ".", errors: report.errors, warnings: [] };
		const finding = (report.findings || []).find((f) => f.id === findingId);
		if (!finding) {
			return { target: target || ".", errors: [`Finding ${findingId} not found in ${reportPath}`], warnings: [] };
		}
		// ADR-0008: plan bridge is dry-run only — plan-input or maintenance-proposal
		// drafts; never edits target code/config.
		const draft = buildFindingDraft(report.target || target || ".", finding);
		const applyHint = draft.kind === "maintenance-proposal"
			? "Dry-run only. Apply the draft via 'amber maintenance propose' after review."
			: "Dry-run only. Apply the draft via 'amber plan' after review.";
		return {
			target: target || ".",
			findingId,
			draft,
			dryRun: true,
			errors: [],
			warnings: [], // kept empty so bypass-print stdout stays parser-safe
			notice: applyHint,
		};
	}
	const label = action == null || action === "" ? "(none)" : String(action);
	return {
		target: target || ".",
		errors: [`Unknown workflow action: ${label}. Known: assess, findings, plan, compare.`],
		warnings: [],
	};
}

module.exports = {
	workflowDispatch,
	assessWorkflow,
	buildReport,
	buildFindings,
	findingsFromReport,
	compareReports,
	resolveSessionCoverage,
	buildPlanDraft,
	buildMaintenanceDraft,
	buildFindingDraft,
	collectMergedSessionObservations,
};
