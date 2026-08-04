"use strict";

const path = require("node:path");

// Declarative flag table driving parseArgs. Each entry maps a CLI flag to the
// args key it sets and how it consumes argv:
//   kind: "value"   -> args[key] = next argv token (default)
//   kind: "boolean" -> args[key] = true, no token consumed
//   accumulate      -> also push the value onto args[accumulate] (repeatable flag)
// Adding a flag is a single row here, not a new branch in a parse ladder.
const FLAG_SPECS = {
	"--target": { key: "target" },
	"--goal": { key: "goal" },
	"--route": { key: "route" },
	"--budget": { key: "budget" },
	"--mode": { key: "mode" },
	"--feature": { key: "feature" },
	"--title": { key: "title" },
	"--plan": { key: "plan" },
	"--file": { key: "file" },
	"--task": { key: "task" },
	"--session": { key: "session" },
	"--request-id": { key: "requestId" },
	"--gate": { key: "gate" },
	"--stage": { key: "stage" },
	"--command": { key: "command" },
	"--result": { key: "result" },
	"--id": { key: "id" },
	"--area": { key: "area" },
	"--behavior": { key: "behavior" },
	"--verify": { key: "verifyVal", accumulate: "verify" },
	"--notes": { key: "notes" },
	"--worker": { key: "worker" },
	"--reviewer": { key: "reviewer" },
	"--backend": { key: "backend" },
	"--concurrency": { key: "concurrency" },
	"--evidence": { key: "evidence" },
	"--version": { key: "version" },
	"--preset": { key: "preset" },
	"--registry": { key: "registry" },
	"--output": { key: "output" },
	"--output-dir": { key: "outputDir" },
	"--out": { key: "out" },
	"--format": { key: "format" },
	"--scope": { key: "scope" },
	"--home": { key: "home" },
	"--bundle-dir": { key: "bundleDir" },
	"--report": { key: "report" },
	"--finding": { key: "finding" },
	"--baseline": { key: "baseline" },
	"--current": { key: "current" },
	"--base": { key: "base" },
	"--head": { key: "head" },
	"--index": { key: "index" },
	"--reports-dir": { key: "reportsDir" },
	"--trace-input": { key: "traceInput" },
	"--agent-config": { key: "agentConfig" },
	"--regression-assertion": { key: "regressionAssertion" },
	"--loop-contract": { key: "loopContract" },
	"--contract": { key: "contract" },
	"--ledger": { key: "ledger" },
	"--trigger-source": { key: "triggerSource" },
	"--stop-reason": { key: "stopReason" },
	"--since": { key: "since" },
	"--threshold": { key: "threshold" },
	"--threshold-days": { key: "thresholdDays" },
	"--hard-stop-status": { key: "hardStopStatus" },
	"--budget-status": { key: "budgetStatus" },
	"--review-bandwidth-status": { key: "reviewBandwidthStatus" },
	"--review-gate-status": { key: "reviewGateStatus" },
	"--priority": { key: "priority" },
	"--paths": { key: "paths" },
	"--decision": { key: "decision", accumulate: "decisions" },
	"--include": { key: "include", accumulate: "includes" },
	"--worktree": { key: "worktree", kind: "boolean" },
	"--json": { key: "json", kind: "boolean" },
	"--dry-run": { key: "dryRun", kind: "boolean" },
	"--with-wiki": { key: "withWiki", kind: "boolean" },
	"--skip-detection": { key: "skipDetection", kind: "boolean" },
	"--confirm": { key: "confirm", kind: "boolean" },
	"--summary": { key: "summary", kind: "boolean" },
	"--all": { key: "all", kind: "boolean" },
	"--explain": { key: "explain", kind: "boolean" },
	"--strict": { key: "strict", kind: "boolean" },
	"--fix-markers": { key: "fixMarkers", kind: "boolean" },
	"--okf": { key: "okf", kind: "boolean" },
	"--markdown": { key: "markdown" },
	"--framework": { key: "framework" },
	"--execute": { key: "execute", kind: "boolean" },
	"--refresh-amber-owned": { key: "refreshAmberOwned", kind: "boolean" },
	"--archive-legacy": { key: "archiveLegacy", kind: "boolean" },
	"--yes": { key: "yes", kind: "boolean" },
	"--warn-only": { key: "warnOnly", kind: "boolean" },
	"--force": { key: "force", kind: "boolean" },
	"--no-fail": { key: "noFail", kind: "boolean" },
	"--no-sessions": { key: "noSessions", kind: "boolean" },
	"--help": { key: "help", kind: "boolean" },
	"-h": { key: "help", kind: "boolean" },
};

function parseArgs(argv) {
	const args = { target: process.cwd(), json: false, dryRun: false };

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const spec = FLAG_SPECS[arg];

		if (!spec) {
			args._ = args._ || [];
			args._.push(arg);
			continue;
		}

		if (spec.kind === "boolean") {
			args[spec.key] = true;
			continue;
		}

		const value = argv[index + 1];
		args[spec.key] = value;
		if (spec.accumulate) {
			if (!Array.isArray(args[spec.accumulate])) {
				args[spec.accumulate] = [];
			}
			args[spec.accumulate].push(value);
		}
		index += 1;
	}

	return args;
}

function printAuditClassification(result) {
	if (result.classification?.type) {
		console.log(`Target type: ${result.classification.type}`);
	}
}

function printAuditStarterSummary(result) {
	if (result.auditMode === "product-repo") {
		const template = result.templateStarterFiles;
		const total = template.existing.length + template.missing.length;
		console.log(
			`Template starter files: ${template.existing.length}/${total} in templates/`,
		);
		return;
	}

	console.log(`Existing Amber starter files: ${result.existing.length}`);
	console.log(`Missing Amber starter files: ${result.missing.length}`);
	if (typeof result.workflowArtifactCount === "number" && result.workflowArtifactCount > 0) {
		console.log(
			`Historical .workflow/ artifacts: ${result.workflowArtifactCount} feature directory(s)`,
		);
	}
}

function printAuditStarterDetails(result) {
	if (result.auditMode !== "product-repo") {
		return;
	}

	const missing = result.templateStarterFiles?.missing || [];
	if (missing.length === 0) {
		return;
	}

	console.log("Missing template starter files:");
	for (const item of missing) {
		console.log(`  - ${item}`);
	}
}

function printAuditSummary(result) {
	console.log(`Audit summary: ${result.target}`);
	console.log(`Read-only: ${result.readOnly}`);
	printAuditClassification(result);
	printAuditStarterSummary(result);
	console.log(
		`Suggested additions: ${Array.isArray(result.suggestedAdditions) ? result.suggestedAdditions.length : 0}`,
	);
	console.log(
		`Existing docs: ${Array.isArray(result.docs) ? result.docs.length : 0}`,
	);
	console.log(
		`Wiki-like files: ${Array.isArray(result.wikiLikeFiles) ? result.wikiLikeFiles.length : 0}`,
	);
	console.log(
		`Conflicts: ${Array.isArray(result.conflicts) ? result.conflicts.length : 0}`,
	);

	if (Array.isArray(result.commands) && result.commands.length > 0) {
		console.log("Detected commands:");
		for (const command of result.commands) {
			console.log(
				`  - ${command.source}: ${command.name} -> ${command.command}`,
			);
		}
	}

	if (
		Array.isArray(result.candidateCommands) &&
		result.candidateCommands.length > 0
	) {
		console.log("Candidate commands requiring confirmation:");
		for (const command of result.candidateCommands) {
			console.log(
				`  - ${command.source}: ${command.name} -> ${command.command}`,
			);
		}
	}

	if (
		Array.isArray(result.toolingEvidence) &&
		result.toolingEvidence.length > 0
	) {
		console.log("Tooling evidence:");
		for (const item of result.toolingEvidence) {
			console.log(`  - ${item.source}: ${item.name}`);
		}
	}

	if (Array.isArray(result.unknowns)) {
		console.log("Unknowns:");
		if (result.unknowns.length === 0) {
			console.log("  - none");
		} else {
			for (const item of result.unknowns) {
				console.log(`  - ${item}`);
			}
		}
	}

	if (typeof result.nextSafeCommand === "string") {
		console.log(`Next safe command: ${result.nextSafeCommand}`);
	}
}

// Shared "Errors: N" footer used by every structured result branch below.
// Empty or absent errors render as "Errors: 0".
function printErrorFooter(result) {
	if (Array.isArray(result.errors) && result.errors.length > 0) {
		console.log(`Errors: ${result.errors.length}`);
		for (const error of result.errors) {
			console.log(`  - ${error}`);
		}
	} else {
		console.log("Errors: 0");
	}
}

// Shared "Warnings: N" footer; prints nothing when there are no warnings.
function printWarningFooter(result) {
	if (Array.isArray(result.warnings) && result.warnings.length > 0) {
		console.log(`Warnings: ${result.warnings.length}`);
		for (const warning of result.warnings) {
			console.log(`  - ${warning}`);
		}
	}
}

// Init/scaffold extras: wiki readiness and Git-workflow/governance detection.
// Every field is optional — prints nothing when a section is absent, so plain
// `init` (no --with-wiki, non-git target) renders exactly as before.
function printInitInsights(result) {
	const wiki = result.wikiReadiness;
	if (wiki) {
		console.log("");
		console.log(`Wiki readiness: ${wiki.present}/${wiki.total} files present`);
		if (Array.isArray(wiki.missing) && wiki.missing.length > 0) {
			console.log(`  Missing: ${wiki.missing.length}`);
			for (const file of wiki.missing.slice(0, 5)) {
				console.log(`    - ${file}`);
			}
		}
		if (
			Array.isArray(wiki.contextPlaceholders) &&
			wiki.contextPlaceholders.length > 0
		) {
			console.log(
				`  Still placeholder (fill these in): ${wiki.contextPlaceholders.length}`,
			);
			for (const file of wiki.contextPlaceholders.slice(0, 8)) {
				console.log(`    ! ${file}`);
			}
		}
	}

	const detection = result.detection;
	if (detection && detection.workflow) {
		const wf = detection.workflow;
		console.log("");
		console.log(`Git workflow: ${wf.detected} (${wf.confidence} confidence)`);
		if (Array.isArray(wf.evidence) && wf.evidence.length > 0) {
			console.log("  Evidence:");
			for (const item of wf.evidence.slice(0, 4)) {
				console.log(`    - ${item}`);
			}
		}
	}
	if (detection && detection.governance) {
		const g = detection.governance;
		const review = g.recommendations && g.recommendations.codeReview;
		const missing =
			g.recommendations && g.recommendations.gitignore
				? g.recommendations.gitignore.missing
				: [];
		console.log("");
		console.log(`Team size: ${g.teamSize} (${g.contributors} contributor(s))`);
		if (review) {
			console.log(`  Code review: ${review.strategy}`);
		}
		if (Array.isArray(missing) && missing.length > 0) {
			console.log("  Suggested .gitignore additions:");
			for (const pattern of missing) {
				console.log(`    - ${pattern}`);
			}
		}
	}
}

function printResult(result, options = {}) {
	if (options.json) {
		process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
		return;
	}

	if (Array.isArray(result.created)) {
		const skipped = Array.isArray(result.skipped) ? result.skipped : [];
		console.log(`Target: ${result.target}`);
		console.log(`Created: ${result.created.length}`);
		for (const item of result.created) {
			console.log(`  + ${item}`);
		}
		console.log(`Skipped: ${skipped.length}`);
		for (const item of skipped) {
			console.log(`  - ${item}`);
		}

		if (Array.isArray(result.warnings) && result.warnings.length > 0) {
			console.log("");
			for (const warning of result.warnings) {
				console.log(`WARNING: ${warning}`);
			}
		}
		if (Array.isArray(result.nextSteps) && result.nextSteps.length > 0) {
			console.log("");
			console.log("Next steps:");
			for (const step of result.nextSteps) {
				console.log(`  ${step}`);
			}
		}
		printInitInsights(result);
		if (Array.isArray(result.errors)) {
			if (result.errors.length === 0) {
				console.log("Errors: 0");
			} else {
				console.log(`Errors: ${result.errors.length}`);
				for (const error of result.errors) {
					console.log(`  - ${error}`);
				}
			}
		}
		printWarningFooter(result);
		return;
	}

	if (Array.isArray(result.missing)) {
		if (options.summary) {
			printAuditSummary(result);
			return;
		}
		console.log(`Target: ${result.target}`);
		console.log(`Read-only: ${result.readOnly}`);
		printAuditClassification(result);
		printAuditStarterSummary(result);
		if (result.auditMode === "product-repo") {
			printAuditStarterDetails(result);
		} else {
			for (const item of result.missing) {
				console.log(`  - ${item}`);
			}
		}
		if (
			Array.isArray(result.suggestedAdditions) &&
			result.suggestedAdditions.length > 0
		) {
			console.log("Suggested additions:");
			for (const item of result.suggestedAdditions) {
				console.log(`  - ${item}`);
			}
		}
		if (result.commands.length > 0) {
			console.log("Detected commands:");
			for (const command of result.commands) {
				console.log(
					`  - ${command.source}: ${command.name} -> ${command.command}`,
				);
			}
		}
		if (
			Array.isArray(result.candidateCommands) &&
			result.candidateCommands.length > 0
		) {
			console.log("Candidate commands requiring confirmation:");
			for (const command of result.candidateCommands) {
				console.log(
					`  - ${command.source}: ${command.name} -> ${command.command}`,
				);
			}
		}
		if (
			Array.isArray(result.toolingEvidence) &&
			result.toolingEvidence.length > 0
		) {
			console.log("Tooling evidence:");
			for (const item of result.toolingEvidence) {
				console.log(`  - ${item.source}: ${item.name}`);
			}
		}
		if (Array.isArray(result.docs) && result.docs.length > 0) {
			console.log("Existing docs:");
			for (const item of result.docs) {
				console.log(`  - ${item}`);
			}
		}
		if (
			Array.isArray(result.wikiLikeFiles) &&
			result.wikiLikeFiles.length > 0
		) {
			console.log("Wiki-like files:");
			for (const item of result.wikiLikeFiles) {
				console.log(`  - ${item}`);
			}
		}
		if (
			Array.isArray(result.suggestedPatches) &&
			result.suggestedPatches.length > 0
		) {
			console.log("Suggested patches requiring approval:");
			for (const patch of result.suggestedPatches) {
				console.log(`  - ${patch.file}: ${patch.suggestion}`);
			}
		}
		if (Array.isArray(result.unknowns)) {
			console.log("Unknowns:");
			if (result.unknowns.length === 0) {
				console.log("  - none");
			} else {
				for (const item of result.unknowns) {
					console.log(`  - ${item}`);
				}
			}
		}
		if (result.conflicts.length > 0) {
			console.log("Files that will not be touched:");
			for (const item of result.conflicts) {
				console.log(`  - ${item}`);
			}
		}
		if (typeof result.nextSafeCommand === "string") {
			console.log(`Next safe command: ${result.nextSafeCommand}`);
		}
		return;
	}

	if (Array.isArray(result.reports)) {
		console.log(`Reports directory: ${result.reportsDir || "n/a"}`);
		if (result.outputPath) {
			console.log(`Index: ${result.outputPath}`);
		}
		if (result.indexPath) {
			console.log(`Index: ${result.indexPath}`);
		}
		if (typeof result.valid === "boolean") {
			console.log(`Valid: ${result.valid}`);
			console.log(`Index checked: ${result.checkedIndex}`);
		}
		console.log(`Reports: ${result.reports.length}`);
		for (const report of result.reports) {
			console.log(
				`  - ${report.generatedAt}: ${path.basename(report.file)} -> ${report.target}`,
			);
		}
		printErrorFooter(result);
		printWarningFooter(result);
		return;
	}

	if (result.base && result.head && result.metrics) {
		console.log(`Base: ${result.base.file}`);
		console.log(`Head: ${result.head.file}`);
		console.log(`Same target: ${result.sameTarget}`);
		if (result.outputPath) {
			console.log(`Diff: ${result.outputPath}`);
		}
		console.log("Metric deltas:");
		for (const metric of Object.values(result.metrics)) {
			console.log(
				`  - ${metric.label}: ${metric.base ?? "n/a"} -> ${metric.head ?? "n/a"} (${metric.delta ?? "n/a"})`,
			);
		}
		console.log(
			`Candidate commands added: ${result.candidateCommands.added.length}`,
		);
		console.log(`Unknowns removed: ${result.unknowns.removed.length}`);
		printErrorFooter(result);
		return;
	}

	if (result.report && result.decision && Array.isArray(result.findings)) {
		console.log(`Report: ${result.report.file}`);
		console.log(`Target: ${result.report.target}`);
		console.log(`Decision: ${result.decision}`);
		if (result.outputPath) {
			console.log(`Gate report: ${result.outputPath}`);
		}
		console.log(`Findings: ${result.findings.length}`);
		for (const finding of result.findings) {
			console.log(`  - ${finding.id}: ${finding.message}`);
		}
		printErrorFooter(result);
		return;
	}

	if (result.kind === "adoption-selected-files") {
		console.log(`Output: ${result.outputPath || "n/a"}`);
		console.log(`Target: ${result.target || "n/a"}`);
		console.log(`Bundle directory: ${result.bundleDir || "n/a"}`);
		console.log(
			`Selected files: ${Array.isArray(result.selectedFiles) ? result.selectedFiles.length : 0}`,
		);
		console.log(
			`Required selected: ${Array.isArray(result.requiredSelected) ? result.requiredSelected.length : 0}`,
		);
		console.log(
			`Optional selected: ${Array.isArray(result.optionalSelected) ? result.optionalSelected.length : 0}`,
		);
		printErrorFooter(result);
		return;
	}

	if (result.kind === "adoption-apply-plan") {
		console.log(`Output: ${result.outputPath || "n/a"}`);
		console.log(`Target: ${result.target || "n/a"}`);
		console.log(`Bundle directory: ${result.bundleDir || "n/a"}`);
		console.log(`Dry run: ${result.dryRun}`);
		console.log(`Apply ready: ${result.applyReady}`);
		console.log(
			`Created preview: ${result.preview ? result.preview.created.length : 0}`,
		);
		console.log(
			`Skipped existing: ${result.preview ? result.preview.skipped.length : 0}`,
		);
		printErrorFooter(result);
		return;
	}

	if (result.kind === "adoption-decision-record") {
		console.log(`Output: ${result.outputPath || "n/a"}`);
		console.log(`Target: ${result.target || "n/a"}`);
		console.log(`Bundle directory: ${result.bundleDir || "n/a"}`);
		console.log(`Gate decision: ${result.gateDecision}`);
		console.log(`Approval status: ${result.approvalStatus}`);
		console.log(
			`Decisions: ${Array.isArray(result.decisions) ? result.decisions.length : 0}`,
		);
		if (Array.isArray(result.decisions)) {
			for (const decision of result.decisions) {
				console.log(`  - ${decision.id}: ${decision.status}`);
			}
		}
		printErrorFooter(result);
		return;
	}

	if (result.kind === "adoption-next-actions") {
		console.log(`Output: ${result.outputPath || "n/a"}`);
		console.log(`Target: ${result.target || "n/a"}`);
		console.log(`Bundle directory: ${result.bundleDir || "n/a"}`);
		console.log(`Gate decision: ${result.gateDecision}`);
		console.log(
			`Approval gates: ${Array.isArray(result.approvalGates) ? result.approvalGates.length : 0}`,
		);
		if (Array.isArray(result.approvalGates)) {
			for (const gate of result.approvalGates) {
				console.log(`  - ${gate.id}: ${gate.question}`);
			}
		}
		printErrorFooter(result);
		return;
	}

	if (result.kind === "adoption-bundle") {
		console.log(`Bundle directory: ${result.outputDir || "n/a"}`);
		console.log(`Target: ${result.target || "n/a"}`);
		console.log(`Latest report: ${result.latestReport || "none"}`);
		console.log(`Gate decision: ${result.gateDecision}`);
		console.log(
			`Files: ${Array.isArray(result.files) ? result.files.length : 0}`,
		);
		if (Array.isArray(result.files)) {
			for (const file of result.files) {
				console.log(`  - ${file.relativePath}`);
			}
		}
		console.log(`Next safe action: ${result.nextSafeAction}`);
		printErrorFooter(result);
		return;
	}

	if (result.kind === "adoption-status") {
		console.log(`Reports directory: ${result.reportsDir || "n/a"}`);
		console.log(`Reports: ${result.reports.count}`);
		console.log(
			`Latest report: ${result.latestReport ? result.latestReport.file : "none"}`,
		);
		console.log(`Index checked: ${result.index.checked}`);
		console.log(`Index valid: ${result.index.valid ?? "n/a"}`);
		console.log(`Gate decision: ${result.gate.decision}`);
		if (result.outputPath) {
			console.log(`Status report: ${result.outputPath}`);
		}
		console.log(`Blockers: ${result.blockers.length}`);
		for (const blocker of result.blockers) {
			console.log(`  - ${blocker.id}: ${blocker.message}`);
		}
		console.log(`Next safe action: ${result.nextSafeAction}`);
		printErrorFooter(result);
		return;
	}

	console.log(`Target: ${result.target || "n/a"}`);
	if (typeof result.text === "string") {
		console.log(result.text);
	}
	if (result.classification && result.classification.type) {
		console.log(`Target type: ${result.classification.type}`);
	}
	if (Array.isArray(result.checks) && result.checks.length > 0) {
		console.log("Checks:");
		for (const check of result.checks) {
			const status = check.passed ? "PASS" : "FAIL";
			const detail = check.detail ? ` (${check.detail})` : "";
			console.log(`  [${status}] ${check.name}${detail}`);
			if (!check.passed && check.remedy) {
				console.log(`         → fix: ${check.remedy}`);
			}
		}
	}
	// Review-specific output: show which standards and checks were evaluated
	if (Array.isArray(result.loadedStandards) && result.loadedStandards.length > 0) {
		console.log(`Standards loaded: ${result.loadedStandards.join(", ")}`);
	}
	if (Array.isArray(result.applicableChecks) && result.applicableChecks.length > 0) {
		console.log("Checks evaluated:");
		for (const check of result.applicableChecks) {
			console.log(`  - ${check.id}: ${check.description || "(no description)"}`);
		}
	}
	if (result.releaseReadiness && result.releaseReadiness.status) {
		const statusLabel =
			result.releaseReadiness.status === "ready" ? "READY" : "BLOCKED";
		console.log(`Release readiness: ${statusLabel}`);
	}

	if (Array.isArray(result.productChecks) && result.productChecks.length > 0) {
		console.log("Product checks:");
		for (const check of result.productChecks) {
			console.log(
				`  - ${check.name}: errors=${check.errors}, warnings=${check.warnings}`,
			);
		}
	}
	// Some command results (e.g. execution validate-integration) carry their
	// own shape without an errors/warnings envelope; default to empty arrays so
	// the generic footer never crashes on a missing field.
	const errors = Array.isArray(result.errors) ? result.errors : [];
	const warnings = Array.isArray(result.warnings) ? result.warnings : [];

	if (errors.length === 0) {
		console.log("Errors: 0");
	} else {
		console.log(`Errors: ${errors.length}`);
		for (const error of errors) {
			console.log(`  - ${error}`);
		}
	}

	if (warnings.length > 0) {
		console.log(`Warnings: ${warnings.length}`);
		for (const warning of warnings) {
			console.log(`  - ${warning}`);
		}
	}
}

module.exports = {
	parseArgs,
	printAuditSummary,
	printResult,
};
