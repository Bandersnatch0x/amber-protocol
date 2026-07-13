"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { inspectPolicy } = require("./governance");
const { readJsonSafe } = require("./fs-utils");
const { loadRoutes } = require("../route-loader");
const { resolveStateDirForRead } = require("../state-dir-resolver");
const { walkLedgers, verifyLedgerChain } = require("./loop-ledger");

const GOVERNANCE_DOCS = [
	"POLICY.md",
	"BOUNDARIES.md",
	"AUDIT_LOG.md",
];

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
	const routesDir = path.join(targetRoot, "routes");
	const loaded = loadRoutes(routesDir);
	const routes = loaded.routes.map((route) => {
		const gateIds = gateIdsForRoute(route);
		return {
			id: route.routeId,
			file: slash(path.relative(targetRoot, route.filePath)),
			stageCount: Array.isArray(route.stages) ? route.stages.length : 0,
			gateIds,
			hasGates: gateIds.length > 0,
			hasUserApprovalGate: gateIds.some((id) => id.startsWith("user-approval")),
		};
	});

	return {
		routesDir: slash(path.relative(targetRoot, routesDir)) || ".",
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
		const pack = read.value && typeof read.value === "object" && !Array.isArray(read.value)
			? read.value
			: null;
		const loopContracts = Array.isArray(pack?.loopContracts) ? pack.loopContracts : [];
		const reviewGateIssues = loopContracts
			.filter((contract) => !Array.isArray(contract.reviewGates) || contract.reviewGates.length === 0)
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
		readErrors: packs.filter((pack) => pack.error).map((pack) => ({
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

function countMatches(value, pattern) {
	return (value.match(pattern) || []).length;
}

function summarizeTimelineEvidence(sessionDirs) {
	let commandCount = 0;
	let approvalCount = 0;
	for (const sessionDir of sessionDirs) {
		const timelinePath = path.join(sessionDir, "timeline.jsonl");
		if (!fs.existsSync(timelinePath)) {
			continue;
		}
		let raw = "";
		try {
			raw = fs.readFileSync(timelinePath, "utf8");
		} catch {
			continue;
		}
		commandCount += countMatches(raw, /"type"\s*:\s*"command_executed"/g);
		approvalCount += countMatches(raw, /"type"\s*:\s*"gate_(triggered|passed|failed)"/g);
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
		const id = warning.includes("user-approval")
			? "unsafe-user-approval"
			: "policy-warning";
		findings.push(finding("warning", id, warning));
	}
	for (const error of sections.routes.errors || []) {
		findings.push(finding("error", "route-error", error));
	}
	for (const readError of sections.workflowPacks.readErrors) {
		findings.push(finding(
			"error",
			"workflow-pack-read-error",
			`Cannot inspect workflow pack ${readError.pack}: ${readError.error}`,
			readError,
		));
	}
	for (const docPath of sections.docs.missing) {
		findings.push(finding(
			"warning",
			"missing-governance-doc",
			`Governance document is missing: ${docPath}`,
			{ file: docPath },
		));
	}
	for (const routeId of sections.routes.withoutGates) {
		findings.push(finding(
			"warning",
			"route-without-gates",
			`Route has no approval gates: ${routeId}`,
			{ routeId },
		));
	}
	for (const issue of sections.workflowPacks.missingReviewGates) {
		findings.push(finding(
			"warning",
			"pack-missing-review-gates",
			`Workflow pack ${issue.pack} loop ${issue.contractId} has no review gates.`,
			issue,
		));
	}
	for (const packId of sections.workflowPacks.missingWorktreeIsolation) {
		findings.push(finding(
			"warning",
			"pack-missing-worktree-isolation",
			`Workflow pack lacks required worktree isolation: ${packId}`,
			{ pack: packId },
		));
	}
	if (!sections.security.standardExists) {
		findings.push(finding(
			"warning",
			"missing-security-standard",
			"Security governance standard is missing: standards/security-governance.json",
		));
	}
	if (
		sections.security.securityNamedPacks.length > 0 &&
		sections.security.unlinkedSecurityPacks.length > 0
	) {
		findings.push(finding(
			"warning",
			"security-pack-not-linked",
			`Security workflow packs do not all reference security-governance: ${sections.security.unlinkedSecurityPacks.join(", ")}`,
			{ packs: sections.security.unlinkedSecurityPacks },
		));
	}
	if (!sections.evidence.hasEvidence) {
		findings.push(finding(
			"warning",
			"no-audit-evidence",
			"No session or execution evidence found for audit review.",
		));
	}
	// GLX (governed execution) controls.
	if (sections.glx.rulesMissing) {
		findings.push(finding(
			"warning",
			"missing-governance-rules",
			"No .amber/governance/rules.json found; governed execution will use built-in defaults.",
		));
	}
	if (sections.glx.unsafeDefaultAllow) {
		findings.push(finding(
			"error",
			"unsafe-default-allow",
			"rules.json defaultAction=allow is unsafe — unlisted commands would be permitted.",
		));
	}
	for (const t of sections.glx.tamperedLedgers) {
		findings.push(finding(
			"error",
			"ledger-tampered",
			`Hash-chain ledger tampered: ${t.home}/${t.id} (broken at record ${t.brokenAt}: ${t.reason})`,
			{ ledgerHome: t.home, ledgerSub: t.id, brokenAt: t.brokenAt },
		));
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

function buildNextActions(findings) {
	const actionsByFinding = {
		"policy-error": "Fix autonomous-policy.json errors before increasing agent autonomy.",
		"unsafe-user-approval": "Set gates['user-approval'] to 'block' unless an explicit live approval process exists.",
		"policy-warning": "Review policy warnings and record the owner-approved exception if intentional.",
		"route-error": "Fix unreadable or invalid route definitions before using governed delivery routes.",
		"workflow-pack-read-error": "Fix unreadable workflow pack JSON before relying on workflow-pack controls.",
		"missing-governance-doc": "Run amber governance docs --target <repo> or add the missing governance documents.",
		"route-without-gates": "Add route gates around planning, implementation, review, or merge stages.",
		"pack-missing-review-gates": "Add reviewGates to each workflow pack loop contract.",
		"pack-missing-worktree-isolation": "Require worktree isolation for mutating workflow-pack loops.",
		"missing-security-standard": "Run amber governance standards init to create standards/security-governance.json, then map coverage with amber governance standards.",
		"security-pack-not-linked": "Link security workflow packs to the security-governance standard.",
		"no-audit-evidence": "Run governed sessions and export evidence when work completes.",
		"missing-governance-rules": "Run amber governance rules init --target <repo> to scaffold a safe-default policy.",
		"unsafe-default-allow": "Set rules.json defaultAction to 'deny' — unlisted commands must not be permitted.",
		"ledger-tampered": "Investigate the flagged ledger record; restore it from version control if it was edited.",
	};
	const actions = findings
		.map((item) => actionsByFinding[item.id])
		.filter(Boolean);
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
	const lines = [
		`Governance Readiness: ${result.decision}`,
		`Findings: ${result.findings.length}`,
	];
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
	lines.push(`- Governance docs present: ${result.sections.docs.present.length}/${GOVERNANCE_DOCS.length}`);
	lines.push(`- Routes: ${result.sections.routes.count}`);
	lines.push(`- Workflow packs: ${result.sections.workflowPacks.count}`);
	lines.push(`- Security standard present: ${result.sections.security.standardExists ? "yes" : "no"}`);
	lines.push(`- Sessions: ${result.sections.evidence.sessionCount}`);
	lines.push(`- Executions: ${result.sections.evidence.executionCount}`);
	const glx = result.sections.glx || {};
	const glxRulesStatus = glx.rulesMissing ? "missing" : glx.unsafeDefaultAllow ? "unsafe (defaultAction=allow)" : "present (safe)";
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
	inspectGovernanceReadiness,
	inspectGlxControls,
	renderReadinessText,
	renderReadinessMarkdown,
	writeReadinessMarkdown,
};
