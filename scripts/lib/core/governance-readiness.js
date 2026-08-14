"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { inspectPolicy } = require("./governance");
const { readJsonSafe, realPathForPotential } = require("./fs-utils");
const { loadTargetRoutes } = require("../route-loader");
const { resolveStateDirForRead } = require("../state-dir-resolver");
const { walkLedgers, verifyLedgerChain } = require("./loop-ledger");

const GOVERNANCE_DOCS = ["POLICY.md", "BOUNDARIES.md", "AUDIT_LOG.md"];

function slash(value) {
	return value.split(path.sep).join("/");
}

function listJsonFiles(dir, suffix) {
	if (!fs.existsSync(dir)) {
		return [];
	}
	return fs
		.readdirSync(dir)
		.filter((name) => name.endsWith(suffix))
		.sort()
		.map((name) => path.join(dir, name));
}

function finding(severity, id, message, detail = {}) {
	return { severity, id, message, ...detail };
}

function inspectGovernanceDocs(targetRoot) {
	const stateDir = resolveStateDirForRead(targetRoot);
	const governanceDir = path.join(stateDir, "governance");
	const docs = GOVERNANCE_DOCS.map((name) => {
		const absolutePath = path.join(governanceDir, name);
		return {
			name,
			path: slash(path.relative(targetRoot, absolutePath)),
			present: fs.existsSync(absolutePath),
		};
	});

	return {
		governanceDir: slash(path.relative(targetRoot, governanceDir)) || ".",
		required: docs,
		missing: docs.filter((doc) => !doc.present).map((doc) => doc.path),
		present: docs.filter((doc) => doc.present).map((doc) => doc.path),
	};
}

function gateIdsForRoute(route) {
	const gateIds = [];
	if (Array.isArray(route.gates)) {
		for (const gate of route.gates) {
			if (gate && typeof gate.id === "string") {
				gateIds.push(gate.id);
			}
		}
	}
	if (Array.isArray(route.stages)) {
		for (const stage of route.stages) {
			if (stage && typeof stage.gateAfter === "string") {
				gateIds.push(stage.gateAfter);
			}
		}
	}
	return [...new Set(gateIds)];
}

function inspectRoutes(targetRoot) {
	const canonicalTarget = realPathForPotential(path.resolve(targetRoot));
	const loaded = loadTargetRoutes(canonicalTarget);
	const { routesDir } = loaded;
	const routes = loaded.routes.map((route) => {
		const gateIds = gateIdsForRoute(route);
		return {
			id: route.routeId,
			file: slash(path.relative(canonicalTarget, route.filePath)),
			stageCount: Array.isArray(route.stages) ? route.stages.length : 0,
			gateIds,
			hasGates: gateIds.length > 0,
			hasUserApprovalGate: gateIds.some((id) => id.startsWith("user-approval")),
		};
	});

	return {
		routesDir: slash(path.relative(canonicalTarget, routesDir)) || ".",
		count: routes.length,
		routes,
		errors: loaded.errors,
		withoutGates: routes.filter((route) => !route.hasGates).map((route) => route.id),
		withUserApprovalGates: routes
			.filter((route) => route.hasUserApprovalGate)
			.map((route) => route.id),
	};
}

function readWorkflowPacks(targetRoot) {
	const packsDir = path.join(targetRoot, "workflow-packs");
	return listJsonFiles(packsDir, ".pack.json").map((filePath) => {
		const read = readJsonSafe(filePath);
		const pack =
			read.value && typeof read.value === "object" && !Array.isArray(read.value)
				? read.value
				: null;
		const loopContracts = Array.isArray(pack?.loopContracts) ? pack.loopContracts : [];
		const reviewGateIssues = loopContracts
			.filter(
				(contract) => !Array.isArray(contract.reviewGates) || contract.reviewGates.length === 0,
			)
			.map((contract) => contract.id || "unknown-loop");
		const workspaceIsolation = pack?.workspaceIsolation || null;
		const hasWorktreeIsolation =
			workspaceIsolation &&
			workspaceIsolation.mutatingLoopsUseWorktree === true &&
			workspaceIsolation.mainCheckoutMutation === false;

		return {
			id: pack?.id || path.basename(filePath, ".pack.json"),
			title: pack?.title || "",
			file: slash(path.relative(targetRoot, filePath)),
			error: read.error || null,
			standards: Array.isArray(pack?.standards) ? pack.standards : [],
			loopContractCount: loopContracts.length,
			reviewGateIssues,
			hasApprovalPolicy: Boolean(pack?.approvalPolicy),
			selfApprovalAllowed: pack?.approvalPolicy?.selfApprovalAllowed,
			hasWorktreeIsolation,
			workspaceIsolation,
		};
	});
}

function inspectWorkflowPacks(targetRoot) {
	const packs = readWorkflowPacks(targetRoot);
	return {
		count: packs.length,
		packs,
		missingReviewGates: packs.flatMap((pack) =>
			pack.reviewGateIssues.map((contractId) => ({ pack: pack.id, contractId })),
		),
		missingWorktreeIsolation: packs
			.filter((pack) => pack.loopContractCount > 0 && !pack.hasWorktreeIsolation)
			.map((pack) => pack.id),
		readErrors: packs
			.filter((pack) => pack.error)
			.map((pack) => ({
				pack: pack.id,
				error: pack.error,
			})),
	};
}

function inspectSecurityGovernance(targetRoot, workflowPacks) {
	const standardPath = path.join(targetRoot, "standards", "security-governance.json");
	const standardExists = fs.existsSync(standardPath);
	const linkedPacks = workflowPacks.packs
		.filter((pack) => pack.standards.includes("security-governance"))
		.map((pack) => pack.id);
	const securityNamedPacks = workflowPacks.packs
		.filter((pack) => /security|secure|vuln/i.test(`${pack.id} ${pack.title} ${pack.file}`))
		.map((pack) => pack.id);

	return {
		standardPath: slash(path.relative(targetRoot, standardPath)),
		standardExists,
		linkedPacks,
		securityNamedPacks,
		unlinkedSecurityPacks: securityNamedPacks.filter((id) => !linkedPacks.includes(id)),
	};
}

function inspectAuditEvidence(targetRoot) {
	const stateDir = resolveStateDirForRead(targetRoot);
	const sessionsDir = path.join(stateDir, "sessions");
	const executionsDir = path.join(stateDir, "executions");
	const sessionDirs = listDirectories(sessionsDir);
	const executionDirs = listDirectories(executionsDir);
	const timelineStats = summarizeTimelineEvidence(sessionDirs);
	const executionCommandCount = countExecutionEvidenceCommands(executionDirs);

	return {
		stateDir: slash(path.relative(targetRoot, stateDir)) || ".",
		sessionCount: sessionDirs.length,
		executionCount: executionDirs.length,
		commandCount: timelineStats.commandCount + executionCommandCount,
		approvalCount: timelineStats.approvalCount,
		hasEvidence: sessionDirs.length > 0 || executionDirs.length > 0,
	};
}

function listDirectories(dir) {
	if (!fs.existsSync(dir)) {
		return [];
	}
	return fs
		.readdirSync(dir)
		.map((name) => path.join(dir, name))
		.filter((entry) => {
			try {
				return fs.statSync(entry).isDirectory();
			} catch {
				return false;
			}
		});
}

function summarizeTimelineEvidence(sessionDirs) {
	// Parse real timeline events. Live verify writes stage_completed /
	// verification_failed with data.command — counting only the phantom
	// command_executed type under-counted every real dogfood session.
	const { readSessionEvents } = require("../session-timeline");
	const { isCommandLikeEvent } = require("./governance");
	let commandCount = 0;
	let approvalCount = 0;
	for (const sessionDir of sessionDirs) {
		const events = readSessionEvents(sessionDir);
		for (const event of events) {
			if (isCommandLikeEvent(event)) commandCount += 1;
			if (
				event.type === "gate_triggered" ||
				event.type === "gate_passed" ||
				event.type === "gate_failed"
			) {
				approvalCount += 1;
			}
		}
	}
	return { commandCount, approvalCount };
}

function countExecutionEvidenceCommands(executionDirs) {
	let commandCount = 0;
	for (const executionDir of executionDirs) {
		const evidencePath = path.join(executionDir, "evidence.json");
		const evidence = readJsonSafe(evidencePath).value;
		if (Array.isArray(evidence?.commands)) {
			commandCount += evidence.commands.length;
		}
	}
	return commandCount;
}

function collectFindings(sections) {
	const findings = [];

	for (const error of sections.policy.errors || []) {
		findings.push(finding("error", "policy-error", error));
	}
	for (const warning of sections.policy.warnings || []) {
		const id = warning.includes("user-approval") ? "unsafe-user-approval" : "policy-warning";
		findings.push(finding("warning", id, warning));
	}
	for (const error of sections.routes.errors || []) {
		findings.push(finding("error", "route-error", error));
	}
	for (const readError of sections.workflowPacks.readErrors) {
		findings.push(
			finding(
				"error",
				"workflow-pack-read-error",
				`Cannot inspect workflow pack ${readError.pack}: ${readError.error}`,
				readError,
			),
		);
	}
	for (const docPath of sections.docs.missing) {
		findings.push(
			finding("warning", "missing-governance-doc", `Governance document is missing: ${docPath}`, {
				file: docPath,
			}),
		);
	}
	for (const routeId of sections.routes.withoutGates) {
		findings.push(
			finding("warning", "route-without-gates", `Route has no approval gates: ${routeId}`, {
				routeId,
			}),
		);
	}
	for (const issue of sections.workflowPacks.missingReviewGates) {
		findings.push(
			finding(
				"warning",
				"pack-missing-review-gates",
				`Workflow pack ${issue.pack} loop ${issue.contractId} has no review gates.`,
				issue,
			),
		);
	}
	for (const packId of sections.workflowPacks.missingWorktreeIsolation) {
		findings.push(
			finding(
				"warning",
				"pack-missing-worktree-isolation",
				`Workflow pack lacks required worktree isolation: ${packId}`,
				{ pack: packId },
			),
		);
	}
	if (!sections.security.standardExists) {
		findings.push(
			finding(
				"warning",
				"missing-security-standard",
				"Security governance standard is missing: standards/security-governance.json",
			),
		);
	}
	if (
		sections.security.securityNamedPacks.length > 0 &&
		sections.security.unlinkedSecurityPacks.length > 0
	) {
		findings.push(
			finding(
				"warning",
				"security-pack-not-linked",
				`Security workflow packs do not all reference security-governance: ${sections.security.unlinkedSecurityPacks.join(", ")}`,
				{ packs: sections.security.unlinkedSecurityPacks },
			),
		);
	}
	if (!sections.evidence.hasEvidence) {
		findings.push(
			finding(
				"warning",
				"no-audit-evidence",
				"No session or execution evidence found for audit review.",
			),
		);
	}
	// GLX (governed execution) controls.
	if (sections.glx.rulesMissing) {
		findings.push(
			finding(
				"warning",
				"missing-governance-rules",
				"No .amber/governance/rules.json found; governed execution will use built-in defaults.",
			),
		);
	}
	if (sections.glx.unsafeDefaultAllow) {
		findings.push(
			finding(
				"error",
				"unsafe-default-allow",
				"rules.json defaultAction=allow is unsafe — unlisted commands would be permitted.",
			),
		);
	}
	for (const t of sections.glx.tamperedLedgers) {
		findings.push(
			finding(
				"error",
				"ledger-tampered",
				`Hash-chain ledger tampered: ${t.home}/${t.id} (broken at record ${t.brokenAt}: ${t.reason})`,
				{ ledgerHome: t.home, ledgerSub: t.id, brokenAt: t.brokenAt },
			),
		);
	}

	return findings;
}

function decideReadiness(findings) {
	if (findings.some((item) => item.severity === "error")) {
		return "block";
	}
	if (findings.some((item) => item.severity === "warning")) {
		return "warn";
	}
	return "ready";
}

// Single source of truth for finding-id → remediation (#61).
// readiness.buildNextActions uses `summary`; governance-report uses the rich fields.
const ACTION_LIBRARY = {
	"policy-error": {
		severity: "high",
		// Not "increase autonomy" — autonomous execution was removed (ADR-0001/0005).
		// This finding is about a leftover/corrupt policy file or governance policy surface.
		summary: "Fix governance policy errors (or remove a corrupt leftover autonomous-policy.json).",
		why: "Governance policy errors make the repository unsafe to route through governed workflows.",
		command: "node scripts/amber.js governance policy --target <repo>",
		expectedOutcome: "Policy errors are fixed or recorded as explicit owner-approved exceptions.",
		blocks: ["governance-score", "governed-workflow"],
	},
	"unsafe-user-approval": {
		severity: "high",
		summary:
			"Set leftover autonomous-policy gates['user-approval'] to 'block' (auto-approve is not supported).",
		why: "A leftover policy claiming user-approval=approve contradicts the removed autonomous executor and confuses operators.",
		command: "node scripts/amber.js governance policy --target <repo>",
		expectedOutcome:
			"Leftover policy is fixed, removed, or documented as non-executing config only.",
		blocks: ["safety-score", "governed-workflow"],
	},
	"policy-warning": {
		severity: "medium",
		summary: "Review policy warnings and record the owner-approved exception if intentional.",
		why: "Policy warnings reduce trust in governed automation boundaries.",
		command: "node scripts/amber.js governance policy --target <repo>",
		expectedOutcome: "Warnings are resolved or consciously accepted.",
		blocks: ["governance-score"],
	},
	"route-error": {
		severity: "high",
		summary: "Fix unreadable or invalid route definitions before using governed delivery routes.",
		why: "Invalid routes cannot be used as repeatable delivery workflows.",
		command: "node scripts/amber.js route validate <route-file> --target <repo>",
		expectedOutcome: "Route definitions validate cleanly.",
		blocks: ["governed-workflow", "continuity-score"],
	},
	"workflow-pack-read-error": {
		severity: "high",
		summary: "Fix unreadable workflow pack JSON before relying on workflow-pack controls.",
		why: "Unreadable workflow packs cannot provide trustworthy execution constraints.",
		command: "node scripts/amber.js pack validate --file <pack-file>",
		expectedOutcome: "Workflow pack JSON can be parsed and inspected.",
		blocks: ["governance-score", "safety-score"],
	},
	"missing-governance-doc": {
		severity: "medium",
		summary: "Run amber governance docs --target <repo> or add the missing governance documents.",
		why: "Missing governance documents leave policy, boundary, or audit context invisible.",
		command: "node scripts/amber.js governance docs --target <repo>",
		expectedOutcome: "Required governance documents exist under .amber/governance.",
		blocks: ["governance-score", "handoff-readiness"],
	},
	"route-without-gates": {
		severity: "medium",
		summary: "Add route gates around planning, implementation, review, or merge stages.",
		why: "Routes without gates do not enforce review or approval checkpoints.",
		command: "node scripts/amber.js route inspect <route-id> --target <repo>",
		expectedOutcome:
			"Routes include gates around planning, implementation, review, or merge stages.",
		blocks: ["safety-score", "governed-workflow"],
	},
	"pack-missing-review-gates": {
		severity: "medium",
		summary: "Add reviewGates to each workflow pack loop contract.",
		why: "Loop contracts without review gates cannot prove independent review.",
		command: "node scripts/amber.js pack inspect --file <pack-file>",
		expectedOutcome: "Each loop contract defines review gates.",
		blocks: ["safety-score", "governed-workflow"],
	},
	"pack-missing-worktree-isolation": {
		severity: "medium",
		summary: "Require worktree isolation for mutating workflow-pack loops.",
		why: "Mutating loops need worktree isolation to avoid accidental main checkout changes.",
		command: "node scripts/amber.js pack readiness --file <pack-file>",
		expectedOutcome:
			"Mutating loop contracts require isolated worktrees and forbid main checkout mutation.",
		blocks: ["safety-score"],
	},
	"missing-security-standard": {
		severity: "medium",
		summary:
			"Run amber governance standards init to create standards/security-governance.json, then map coverage with amber governance standards.",
		why: "Security pack claims need an auditable standard to map controls and gaps.",
		command: "node scripts/amber.js governance standards init --target <repo>",
		expectedOutcome:
			"Creates standards/security-governance.json (declarative security-governance standard), clearing this finding. Re-run `governance standards` to map coverage.",
		blocks: ["safety-score", "governance-score"],
	},
	"security-pack-not-linked": {
		severity: "medium",
		summary: "Link security workflow packs to the security-governance standard.",
		why: "Security-named workflow packs should link to the security governance standard.",
		command: "node scripts/amber.js governance standards --target <repo>",
		expectedOutcome: "Security workflow packs reference security-governance.",
		blocks: ["safety-score"],
	},
	"no-audit-evidence": {
		severity: "medium",
		summary: "Run governed sessions and export evidence when work completes.",
		why: "A complete product loop needs verification evidence before handoff is trustworthy.",
		command:
			'node scripts/amber.js session start --target <repo> --goal "verify current delivery" --confirm',
		expectedOutcome:
			"A governed session or execution records verification evidence that can be exported.",
		blocks: ["evidence-score", "handoff-readiness"],
	},
	"missing-governance-rules": {
		severity: "medium",
		summary: "Run amber governance rules init --target <repo> to scaffold a safe-default policy.",
		why: "Built-in defaults are safe, but a repository-local policy is easier to inspect and hand off.",
		command: "node scripts/amber.js governance rules init --target <repo>",
		expectedOutcome: ".amber/governance/rules.json exists with defaultAction=deny.",
		blocks: ["governance-score", "safety-score"],
	},
	"unsafe-default-allow": {
		severity: "high",
		summary: "Set rules.json defaultAction to 'deny' — unlisted commands must not be permitted.",
		why: "defaultAction=allow permits unlisted commands and breaks deny-by-default governance.",
		command: "node scripts/amber.js governance rules inspect --target <repo>",
		expectedOutcome: "rules.json uses defaultAction=deny and deny-wins command policy.",
		blocks: ["governance-score", "safety-score", "governed-workflow"],
	},
	"ledger-tampered": {
		severity: "high",
		summary:
			"Investigate the flagged ledger record; restore it from version control if it was edited.",
		why: "A tampered ledger means evidence continuity cannot be trusted.",
		command: "node scripts/amber.js ledger verify-anchoring --target <repo>",
		expectedOutcome:
			"Tampered ledger records are investigated and restored from version control if appropriate.",
		blocks: ["evidence-score", "handoff-readiness"],
	},
};

function buildNextActions(findings) {
	const actions = findings.map((item) => ACTION_LIBRARY[item.id]?.summary).filter(Boolean);
	return [...new Set(actions)];
}

// GLX controls: is the declarative policy present and safe, and are all
// hash-chain ledgers intact? A tampered ledger is a hard block (evidence is
// unreliable); a missing/unsafe rules.json is a warning/block respectively.
function inspectGlxControls(targetRoot) {
	const stateDir = resolveStateDirForRead(targetRoot);
	const rulesPath = path.join(stateDir, "governance", "rules.json");
	const rulesMissing = !fs.existsSync(rulesPath);
	let unsafeDefaultAllow = false;
	if (!rulesMissing) {
		try {
			const parsed = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
			if (parsed && parsed.defaultAction === "allow") unsafeDefaultAllow = true;
		} catch {
			/* unparseable rules.json counts as missing for readiness */
		}
	}

	// Scan every hash-chain ledger home for tampering via the canonical walker.
	const tamperedLedgers = [];
	walkLedgers(stateDir, ({ home, sub, ledgerPath }) => {
		const v = verifyLedgerChain(ledgerPath);
		if (!v.intact) tamperedLedgers.push({ home, id: sub, brokenAt: v.brokenAt, reason: v.reason });
	});
	return { rulesMissing, unsafeDefaultAllow, tamperedLedgers };
}

// Confidence classification for .amber/governance/rules.json rules (T1,
// ADR-0011). Each rule is graded high/medium/low so the safety philosophy can
// decide the allowed execution shape: high → governed execution, medium →
// dry-run only, low → human review and refusal. Pure function; takes the
// parsed rules object ({ schemaVersion, defaultAction, rules: [...] }) and
// returns one entry per rule: [{ ruleId, confidence, reason }].
//
// Classification (deterministic, fail-closed):
//   high   → explicit allow/deny action + deterministic matcher (exact/prefix)
//            + non-empty mapsTo (traceable to a governance/ASI claim).
//   medium → explicit action but no mapsTo (intent clear, not traceable), or a
//            fuzzy matcher (regex) whose matching confidence is only partial.
//   low    → cannot be evaluated or cannot ever fire: missing explicit action,
//            missing pattern, or a non-object rule entry.
function confidenceClass(confidence, ruleId, reason) {
	return { ruleId, confidence, reason };
}

function classifyConfidenceRule(rule, index) {
	const ruleId =
		rule && typeof rule.id === "string" && rule.id.length > 0 ? rule.id : `rule-${index + 1}`;
	if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
		return confidenceClass(
			"low",
			ruleId,
			`Rule ${ruleId} is not an object; it cannot be matched or gated.`,
		);
	}
	const action = rule.action;
	if (action !== "allow" && action !== "deny") {
		return confidenceClass(
			"low",
			ruleId,
			`Rule ${ruleId} has no explicit allow/deny action; it cannot be evaluated with confidence.`,
		);
	}
	if (typeof rule.pattern !== "string" || rule.pattern.length === 0) {
		return confidenceClass(
			"low",
			ruleId,
			`Rule ${ruleId} has no pattern to match; it can never fire.`,
		);
	}
	const match = typeof rule.match === "string" ? rule.match : "";
	const mapsTo = Array.isArray(rule.mapsTo)
		? rule.mapsTo.filter((item) => typeof item === "string" && item.length > 0)
		: [];
	if (mapsTo.length > 0 && (match === "exact" || match === "prefix")) {
		return confidenceClass(
			"high",
			ruleId,
			`Rule ${ruleId} declares action "${action}", a deterministic ${match} matcher, and maps to ${mapsTo.join(", ")}; traceable for governed execution.`,
		);
	}
	if (mapsTo.length === 0) {
		return confidenceClass(
			"medium",
			ruleId,
			`Rule ${ruleId} declares action "${action}" but no mapsTo; intent is clear but not traceable to a governance claim.`,
		);
	}
	return confidenceClass(
		"medium",
		ruleId,
		`Rule ${ruleId} uses a fuzzy ${match} matcher; matching confidence is partial.`,
	);
}

function computeConfidenceClasses(rules) {
	const list = Array.isArray(rules?.rules) ? rules.rules : [];
	return list.map(classifyConfidenceRule);
}

function inspectGovernanceReadiness(targetRoot) {
	const target = path.resolve(targetRoot || process.cwd());
	const workflowPacks = inspectWorkflowPacks(target);
	const sections = {
		policy: inspectPolicy(target),
		docs: inspectGovernanceDocs(target),
		routes: inspectRoutes(target),
		workflowPacks,
		security: inspectSecurityGovernance(target, workflowPacks),
		evidence: inspectAuditEvidence(target),
		glx: inspectGlxControls(target),
	};
	const findings = collectFindings(sections);
	const decision = decideReadiness(findings);

	return {
		target,
		decision,
		findings,
		sections,
		nextActions: buildNextActions(findings),
		errors: findings.filter((item) => item.severity === "error").map((item) => item.message),
		warnings: findings.filter((item) => item.severity === "warning").map((item) => item.message),
	};
}

function renderReadinessText(result) {
	const lines = [`Governance Readiness: ${result.decision}`, `Findings: ${result.findings.length}`];
	for (const item of result.findings) {
		lines.push(`  - ${item.severity} ${item.id}: ${item.message}`);
	}
	if (result.nextActions.length > 0) {
		lines.push("Next actions:");
		for (const action of result.nextActions) {
			lines.push(`  - ${action}`);
		}
	}
	return lines.join("\n");
}

function renderReadinessMarkdown(result) {
	const lines = [
		"# Governance Readiness Report",
		"",
		`**Target:** ${result.target}`,
		`**Decision:** ${result.decision}`,
		"",
		"## Findings",
		"",
	];

	if (result.findings.length === 0) {
		lines.push("- none", "");
	} else {
		for (const item of result.findings) {
			lines.push(`- **${item.severity}** \`${item.id}\`: ${item.message}`);
		}
		lines.push("");
	}

	lines.push("## Sections", "");
	lines.push(`- Policy overrides: ${result.sections.policy.overrides.length}`);
	lines.push(
		`- Governance docs present: ${result.sections.docs.present.length}/${GOVERNANCE_DOCS.length}`,
	);
	lines.push(`- Routes: ${result.sections.routes.count}`);
	lines.push(`- Workflow packs: ${result.sections.workflowPacks.count}`);
	lines.push(
		`- Security standard present: ${result.sections.security.standardExists ? "yes" : "no"}`,
	);
	lines.push(`- Sessions: ${result.sections.evidence.sessionCount}`);
	lines.push(`- Executions: ${result.sections.evidence.executionCount}`);
	const glx = result.sections.glx || {};
	const glxRulesStatus = glx.rulesMissing
		? "missing"
		: glx.unsafeDefaultAllow
			? "unsafe (defaultAction=allow)"
			: "present (safe)";
	lines.push(`- GLX rules: ${glxRulesStatus}`);
	lines.push(`- GLX tampered ledgers: ${(glx.tamperedLedgers || []).length}`);
	lines.push("");

	lines.push("## Next Actions", "");
	if (result.nextActions.length === 0) {
		lines.push("- none");
	} else {
		for (const action of result.nextActions) {
			lines.push(`- ${action}`);
		}
	}
	lines.push("");

	return lines.join("\n");
}

function writeReadinessMarkdown(result, outputPath) {
	const output = path.resolve(outputPath);
	fs.mkdirSync(path.dirname(output), { recursive: true });
	fs.writeFileSync(output, renderReadinessMarkdown(result));
	return output;
}

module.exports = {
	GOVERNANCE_DOCS,
	ACTION_LIBRARY,
	inspectGovernanceReadiness,
	inspectGlxControls,
	renderReadinessText,
	renderReadinessMarkdown,
	writeReadinessMarkdown,
	// Pure per-concern collectors. Already filesystem-in / plain-object-out; the
	// deepening (#6) only exposes them so each readiness concern is testable
	// through its own seam instead of only through the aggregate
	// inspectGovernanceReadiness. No behaviour change.
	inspectGovernanceDocs,
	inspectRoutes,
	inspectWorkflowPacks,
	inspectSecurityGovernance,
	inspectAuditEvidence,
	// Pure rule-classification function (T1, ADR-0011). Exported separately so
	// loop-policy's confidence_gating block and tests can grade rules without
	// touching any filesystem or readiness aggregation.
	computeConfidenceClasses,
};
