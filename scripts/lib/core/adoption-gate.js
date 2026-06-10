"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
	ADOPTION_COMPARE_METRICS,
	compareAdoptionReports,
	listAdoptionReports,
	parseAdoptionReportForComparison,
	validateAdoptionReports,
} = require("./adoption-reports");

const {
	pathExists,
} = require("./fs-utils");

function adoptionGateFindings(report) {
	const findings = [];
	const missingHarnessFiles = report.metrics.missingHarnessFiles;
	const conflicts = report.metrics.conflicts;

	if (typeof missingHarnessFiles === "number" && missingHarnessFiles > 0) {
		findings.push({
			id: "missing-harness-files",
			severity: "wait",
			message: `${missingHarnessFiles} Harness files are still missing.`,
		});
	}

	if (typeof conflicts === "number" && conflicts > 0) {
		findings.push({
			id: "conflicts-present",
			severity: "wait",
			message: `${conflicts} conflicting files require manual review.`,
		});
	}

	if (report.candidateCommands.length > 0) {
		findings.push({
			id: "candidate-commands-unconfirmed",
			severity: "wait",
			message: `${report.candidateCommands.length} candidate command(s) require human confirmation.`,
		});
	}

	if (report.unknowns.length > 0) {
		findings.push({
			id: "unknowns-present",
			severity: "wait",
			message: `${report.unknowns.length} unknown(s) remain unresolved.`,
		});
	}

	return findings;
}

function buildAdoptionGateContent(gate) {
	const lines = [
		"# Adoption Gate Report",
		"",
		`Report: ${gate.report.file}`,
		`Target: ${gate.report.target}`,
		`Generated: ${gate.report.generatedAt}`,
		`Decision: ${gate.decision}`,
		"",
		"## Findings",
		"",
	];

	if (gate.findings.length === 0) {
		lines.push("- none");
	} else {
		for (const finding of gate.findings) {
			lines.push(`- ${finding.id}: ${finding.message}`);
		}
	}

	lines.push("", "## Metrics", "");
	for (const metric of Object.values(gate.metrics)) {
		lines.push(`- ${metric.label}: ${metric.value ?? "n/a"}`);
	}
	lines.push("");

	return lines.join("\n");
}

function gateAdoptionReport(options = {}) {
	const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	let reportPath = options.report ? path.resolve(options.report) : "";
	const errors = [];
	const warnings = [];

	if (outputPath && pathExists(outputPath)) {
		errors.push(`Gate report already exists: ${outputPath}`);
	}

	if (reportsDir && !reportPath) {
		const listing = listAdoptionReports({ reportsDir });
		errors.push(...listing.errors);
		warnings.push(...listing.warnings);
		if (listing.reports.length === 0) {
			errors.push(`No adoption reports found in: ${reportsDir}`);
		} else {
			reportPath = listing.reports[0].file;
		}
	}

	if (!reportPath) {
		errors.push("adoption gate requires --report or --reports-dir.");
	}

	if (errors.length > 0) {
		return {
			target: reportsDir || "n/a",
			reportsDir,
			outputPath,
			report: null,
			decision: "wait",
			findings: [],
			errors,
			warnings,
		};
	}

	const parsed = parseAdoptionReportForComparison(reportPath);
	if (parsed.error) {
		errors.push(parsed.error);
		return {
			target: reportsDir || "n/a",
			reportsDir,
			outputPath,
			report: null,
			decision: "wait",
			findings: [],
			errors,
			warnings,
		};
	}

	const report = parsed.report;
	const findings = adoptionGateFindings(report);
	const metrics = {};
	for (const [key, label] of ADOPTION_COMPARE_METRICS) {
		metrics[key] = { label, value: report.metrics[key] };
	}

	const gate = {
		target: report.target,
		reportsDir,
		outputPath,
		report: {
			file: report.file,
			target: report.target,
			generatedAt: report.generatedAt,
		},
		decision: findings.length === 0 ? "ready" : "wait",
		findings,
		metrics,
		candidateCommands: report.candidateCommands,
		unknowns: report.unknowns,
		errors,
		warnings,
	};

	if (outputPath) {
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, buildAdoptionGateContent(gate));
	}

	return gate;
}

function nextAdoptionStatusAction(status) {
	if (status.errors.length > 0) {
		return "Fix adoption status errors before sharing this summary.";
	}
	if (status.index.checked && !status.index.valid) {
		return "Fix adoption index links before relying on this status.";
	}
	if (status.gate.decision === "wait") {
		return "Review adoption gate findings before initializing or changing the target project.";
	}
	return "Ready for human approval of the next safe Harness action.";
}

function buildAdoptionStatusContent(status) {
	const lines = [
		"# Adoption Status",
		"",
		`Reports directory: ${status.reportsDir}`,
		`Reports: ${status.reports.count}`,
		`Latest report: ${status.latestReport ? status.latestReport.file : "none"}`,
		`Index checked: ${status.index.checked}`,
		`Index valid: ${status.index.valid ?? "n/a"}`,
		`Gate decision: ${status.gate.decision}`,
		`Next safe action: ${status.nextSafeAction}`,
		"",
		"## Blockers",
		"",
	];

	if (status.blockers.length === 0) {
		lines.push("- none");
	} else {
		for (const blocker of status.blockers) {
			lines.push(`- ${blocker.id}: ${blocker.message}`);
		}
	}

	lines.push("", "## Compare Summary", "");
	if (!status.compare) {
		lines.push("- Not enough reports to compare.");
	} else {
		lines.push(`- Base: ${status.compare.base.file}`);
		lines.push(`- Head: ${status.compare.head.file}`);
		lines.push(
			`- Missing Harness files delta: ${status.compare.metrics.missingHarnessFiles.delta ?? "n/a"}`,
		);
		lines.push(
			`- Candidate commands added: ${status.compare.candidateCommands.added.length}`,
		);
		lines.push(`- Unknowns removed: ${status.compare.unknowns.removed.length}`);
	}

	lines.push("");
	return lines.join("\n");
}

function statusAdoptionReports(options = {}) {
	const reportsDir = options.reportsDir ? path.resolve(options.reportsDir) : "";
	const indexPath = options.index ? path.resolve(options.index) : "";
	const outputPath = options.output ? path.resolve(options.output) : "";
	const errors = [];
	const warnings = [];

	if (!reportsDir) {
		errors.push("adoption status requires --reports-dir.");
	}
	if (outputPath && pathExists(outputPath)) {
		errors.push(`Status report already exists: ${outputPath}`);
	}
	if (errors.length > 0) {
		return {
			kind: "adoption-status",
			target: reportsDir || "n/a",
			reportsDir,
			outputPath,
			reports: { count: 0 },
			latestReport: null,
			index: { checked: Boolean(indexPath), valid: null, errors: [] },
			gate: { decision: "wait", findings: [] },
			compare: null,
			blockers: [],
			nextSafeAction: "Fix adoption status errors before sharing this summary.",
			errors,
			warnings,
		};
	}

	const listing = listAdoptionReports({ reportsDir });
	errors.push(...listing.errors);
	warnings.push(...listing.warnings);
	if (listing.reports.length === 0) {
		errors.push(`No adoption reports found in: ${reportsDir}`);
	}

	const latestReport = listing.reports[0] || null;
	const index = { checked: Boolean(indexPath), valid: null, errors: [] };
	if (indexPath) {
		const validation = validateAdoptionReports({
			reportsDir,
			index: indexPath,
		});
		index.valid = validation.errors.length === 0;
		index.errors = validation.errors;
		warnings.push(...validation.warnings);
	}

	const gate = latestReport
		? gateAdoptionReport({ report: latestReport.file })
		: { decision: "wait", findings: [] };
	warnings.push(...(gate.warnings || []));
	errors.push(...(gate.errors || []));

	let compare = null;
	if (listing.reports.length >= 2) {
		compare = compareAdoptionReports({ reportsDir });
		warnings.push(...(compare.warnings || []));
		errors.push(...(compare.errors || []));
	}

	const status = {
		kind: "adoption-status",
		target: latestReport ? latestReport.target : reportsDir,
		reportsDir,
		outputPath,
		reports: {
			count: listing.reports.length,
			files: listing.reports.map((report) => report.file),
		},
		latestReport,
		index,
		gate: {
			decision: gate.decision,
			findings: gate.findings || [],
		},
		compare,
		blockers: gate.findings || [],
		nextSafeAction: "",
		errors,
		warnings,
	};

	status.nextSafeAction = nextAdoptionStatusAction(status);

	if (outputPath && errors.length === 0) {
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, buildAdoptionStatusContent(status));
	}

	return status;
}

module.exports = {
	adoptionGateFindings,
	buildAdoptionGateContent,
	gateAdoptionReport,
	nextAdoptionStatusAction,
	buildAdoptionStatusContent,
	statusAdoptionReports,
};
