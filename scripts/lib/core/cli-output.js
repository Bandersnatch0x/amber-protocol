"use strict";

const path = require("node:path");

function parseArgs(argv) {
	const args = { target: process.cwd(), json: false, dryRun: false };

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--target") {
			args.target = argv[index + 1];
			index += 1;
		} else if (arg === "--goal") {
			args.goal = argv[index + 1];
			index += 1;
		} else if (arg === "--route") {
			args.route = argv[index + 1];
			index += 1;
		} else if (arg === "--budget") {
			args.budget = argv[index + 1];
			index += 1;
		} else if (arg === "--worktree") {
			args.worktree = true;
		} else if (arg === "--mode") {
			args.mode = argv[index + 1];
			index += 1;
		} else if (arg === "--feature") {
			args.feature = argv[index + 1];
			index += 1;
		} else if (arg === "--title") {
			args.title = argv[index + 1];
			index += 1;
		} else if (arg === "--plan") {
			args.plan = argv[index + 1];
			index += 1;
		} else if (arg === "--file") {
			args.file = argv[index + 1];
			index += 1;
		} else if (arg === "--task") {
			args.task = argv[index + 1];
			index += 1;
		} else if (arg === "--session") {
			args.session = argv[index + 1];
			index += 1;
		} else if (arg === "--worker") {
			args.worker = argv[index + 1];
			index += 1;
		} else if (arg === "--reviewer") {
			args.reviewer = argv[index + 1];
			index += 1;
		} else if (arg === "--backend") {
			args.backend = argv[index + 1];
			index += 1;
		} else if (arg === "--concurrency") {
			args.concurrency = argv[index + 1];
			index += 1;
		} else if (arg === "--decision") {
			args.decision = argv[index + 1];
			if (!Array.isArray(args.decisions)) {
				args.decisions = [];
			}
			args.decisions.push(argv[index + 1]);
			index += 1;
		} else if (arg === "--evidence") {
			args.evidence = argv[index + 1];
			index += 1;
		} else if (arg === "--version") {
			args.version = argv[index + 1];
			index += 1;
		} else if (arg === "--preset") {
			args.preset = argv[index + 1];
			index += 1;
		} else if (arg === "--registry") {
			args.registry = argv[index + 1];
			index += 1;
		} else if (arg === "--output") {
			args.output = argv[index + 1];
			index += 1;
		} else if (arg === "--output-dir") {
			args.outputDir = argv[index + 1];
			index += 1;
		} else if (arg === "--bundle-dir") {
			args.bundleDir = argv[index + 1];
			index += 1;
		} else if (arg === "--include") {
			args.include = argv[index + 1];
			if (!Array.isArray(args.includes)) {
				args.includes = [];
			}
			args.includes.push(argv[index + 1]);
			index += 1;
		} else if (arg === "--report") {
			args.report = argv[index + 1];
			index += 1;
		} else if (arg === "--base") {
			args.base = argv[index + 1];
			index += 1;
		} else if (arg === "--head") {
			args.head = argv[index + 1];
			index += 1;
		} else if (arg === "--index") {
			args.index = argv[index + 1];
			index += 1;
		} else if (arg === "--reports-dir") {
			args.reportsDir = argv[index + 1];
			index += 1;
		} else if (arg === "--trace-input") {
			args.traceInput = argv[index + 1];
			index += 1;
		} else if (arg === "--agent-config") {
			args.agentConfig = argv[index + 1];
			index += 1;
		} else if (arg === "--regression-assertion") {
			args.regressionAssertion = argv[index + 1];
			index += 1;
		} else if (arg === "--loop-contract") {
			args.loopContract = argv[index + 1];
			index += 1;
		} else if (arg === "--contract") {
			args.contract = argv[index + 1];
			index += 1;
		} else if (arg === "--ledger") {
			args.ledger = argv[index + 1];
			index += 1;
		} else if (arg === "--trigger-source") {
			args.triggerSource = argv[index + 1];
			index += 1;
		} else if (arg === "--stop-reason") {
			args.stopReason = argv[index + 1];
			index += 1;
		} else if (arg === "--since") {
			args.since = argv[index + 1];
			index += 1;
		} else if (arg === "--threshold") {
			args.threshold = argv[index + 1];
			index += 1;
		} else if (arg === "--threshold-days") {
			args.thresholdDays = argv[index + 1];
			index += 1;
		} else if (arg === "--hard-stop-status") {
			args.hardStopStatus = argv[index + 1];
			index += 1;
		} else if (arg === "--budget-status") {
			args.budgetStatus = argv[index + 1];
			index += 1;
		} else if (arg === "--review-bandwidth-status") {
			args.reviewBandwidthStatus = argv[index + 1];
			index += 1;
		} else if (arg === "--review-gate-status") {
			args.reviewGateStatus = argv[index + 1];
			index += 1;
		} else if (arg === "--priority") {
			args.priority = argv[index + 1];
			index += 1;
		} else if (arg === "--json") {
			args.json = true;
		} else if (arg === "--dry-run") {
			args.dryRun = true;
		} else if (arg === "--confirm") {
			args.confirm = true;
		} else if (arg === "--summary") {
			args.summary = true;
		} else if (arg === "--all") {
			args.all = true;
		} else if (arg === "--explain") {
			args.explain = true;
		} else if (arg === "--strict") {
			args.strict = true;
		} else if (arg === "--fix-markers") {
			args.fixMarkers = true;
		} else if (arg === "--help" || arg === "-h") {
			args.help = true;
		} else {
			args._ = args._ || [];
			args._.push(arg);
		}
	}

	return args;
}

function isProductRepoAudit(result) {
	return result.classification?.type === "product-repo";
}

function printProductRepoAuditNotes() {
	console.log(
		"Note: Missing Amber starter files at repo root are expected for the Amber Protocol product repository.",
	);
	console.log(
		"Starter scaffolds live under templates/ and are installed into targets via init.",
	);
}

function printAuditSummary(result) {
	console.log(`Audit summary: ${result.target}`);
	console.log(`Read-only: ${result.readOnly}`);
	if (result.classification?.type) {
		console.log(`Target type: ${result.classification.type}`);
	}
	console.log(`Existing Amber starter files: ${result.existing.length}`);
	console.log(`Missing Amber starter files: ${result.missing.length}`);
	if (isProductRepoAudit(result)) {
		printProductRepoAuditNotes();
	}
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
		if (Array.isArray(result.warnings) && result.warnings.length > 0) {
			console.log(`Warnings: ${result.warnings.length}`);
			for (const warning of result.warnings) {
				console.log(`  - ${warning}`);
			}
		}
		return;
	}

	if (Array.isArray(result.missing)) {
		if (options.summary) {
			printAuditSummary(result);
			return;
		}
		console.log(`Target: ${result.target}`);
		console.log(`Read-only: ${result.readOnly}`);
		if (result.classification?.type) {
			console.log(`Target type: ${result.classification.type}`);
		}
		console.log(`Existing Amber starter files: ${result.existing.length}`);
		console.log(`Missing Amber starter files: ${result.missing.length}`);
		if (isProductRepoAudit(result)) {
			printProductRepoAuditNotes();
		}
		for (const item of result.missing) {
			console.log(`  - ${item}`);
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
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
		if (Array.isArray(result.warnings) && result.warnings.length > 0) {
			console.log(`Warnings: ${result.warnings.length}`);
			for (const warning of result.warnings) {
				console.log(`  - ${warning}`);
			}
		}
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
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
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
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
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
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
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
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
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
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
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
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
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
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
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
		if (Array.isArray(result.errors) && result.errors.length > 0) {
			console.log(`Errors: ${result.errors.length}`);
			for (const error of result.errors) {
				console.log(`  - ${error}`);
			}
		} else {
			console.log("Errors: 0");
		}
		return;
	}

	console.log(`Target: ${result.target || "n/a"}`);
	if (typeof result.text === "string") {
		console.log(result.text);
	}
	if (result.classification && result.classification.type) {
		console.log(`Target type: ${result.classification.type}`);
	}
	if (Array.isArray(result.productChecks) && result.productChecks.length > 0) {
		console.log("Product checks:");
		for (const check of result.productChecks) {
			console.log(
				`  - ${check.name}: errors=${check.errors}, warnings=${check.warnings}`,
			);
		}
	}
	if (result.errors.length === 0) {
		console.log("Errors: 0");
	} else {
		console.log(`Errors: ${result.errors.length}`);
		for (const error of result.errors) {
			console.log(`  - ${error}`);
		}
	}

	if (result.warnings.length > 0) {
		console.log(`Warnings: ${result.warnings.length}`);
		for (const warning of result.warnings) {
			console.log(`  - ${warning}`);
		}
	}
}

module.exports = {
	parseArgs,
	printAuditSummary,
	printResult,
};
