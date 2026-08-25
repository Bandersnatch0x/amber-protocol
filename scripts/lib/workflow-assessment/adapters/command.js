"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isMissingPath, resolveTarget } = require("../../core/fs-utils");
const { defineCommand } = require("../../subcommand-dispatcher");
const { assess, buildDraft, compare, findings } = require("..");
const { renderJson, renderMarkdown } = require("./renderers");

function readReportFile(filePath) {
	// Distinguish read failures (missing file, permission, race) from
	// unparseable content so callers get a precise machine-friendly cause.
	if (isMissingPath(filePath)) {
		return { errors: [`Report not found: ${filePath}.`] };
	}
	let raw;
	try {
		raw = fs.readFileSync(path.resolve(filePath), "utf8");
	} catch (error) {
		return { errors: [`Unable to read report ${filePath}: ${error.message}.`] };
	}
	try {
		return JSON.parse(raw);
	} catch (error) {
		return { errors: [`Invalid JSON in report ${filePath}: ${error.message}.`] };
	}
}

function assessWorkflow(args) {
	const targetRoot = resolveTarget(args.target);
	const format = args.format === "markdown" ? "markdown" : "json";
	const report = assess(targetRoot, {
		noSessions: args.noSessions === true,
		handoffBundleDir: args.handoffBundleDir,
	});
	const output = format === "markdown" ? renderMarkdown(report) : renderJson(report);
	const result = {
		target: targetRoot,
		format,
		report,
		errors: [],
		warnings: [],
	};
	if (args.outputDir) {
		const outputDir = path.resolve(args.outputDir);
		fs.mkdirSync(outputDir, { recursive: true });
		const extension = format === "markdown" ? "md" : "json";
		const outputPath = path.join(outputDir, `workflow-assessment.${extension}`);
		fs.writeFileSync(outputPath, output, "utf8");
		result.outputPath = outputPath;
	}
	return result;
}

function dispatchFindings(target, args) {
	if (!args.report) {
		return {
			target: target || ".",
			errors: ["'amber workflow findings' requires --report <path>"],
			warnings: [],
		};
	}
	const report = readReportFile(args.report);
	if (report.errors) {
		return { target: target || ".", errors: report.errors, warnings: [] };
	}
	return { ...findings(report), errors: [], warnings: [] };
}

function dispatchCompare(target, args) {
	if (!args.baseline || !args.current) {
		return {
			target: target || ".",
			errors: ["'amber workflow compare' requires --baseline <path> --current <path>"],
			warnings: [],
		};
	}
	const baseline = readReportFile(args.baseline);
	const current = readReportFile(args.current);
	if (baseline.errors) {
		return { target: target || ".", errors: baseline.errors, warnings: [] };
	}
	if (current.errors) {
		return { target: target || ".", errors: current.errors, warnings: [] };
	}
	// Compare deltas are report-relative and never carried a target; the
	// explicit undefined keeps the dispatcher's args.target prepend off the wire.
	return { target: undefined, ...compare(baseline, current), errors: [] };
}

function dispatchPlan(target, args) {
	if (!args.report || !args.finding) {
		return {
			target: target || ".",
			errors: ["'amber workflow plan' requires --report <path> --finding <id> [--dry-run]"],
			warnings: [],
		};
	}
	const report = readReportFile(args.report);
	if (report.errors) {
		return { target: target || ".", errors: report.errors, warnings: [] };
	}
	const result = buildDraft(report, args.finding, target);
	if (!result.ok) {
		return {
			target: target || ".",
			errors: [`Finding ${args.finding} not found in ${args.report}`],
			warnings: [],
		};
	}
	const notice =
		result.draft.kind === "maintenance-proposal"
			? "Dry-run only. Apply the draft via 'amber maintenance propose' after review."
			: "Dry-run only. Apply the draft via 'amber plan' after review.";
	return {
		target: target || ".",
		findingId: result.findingId,
		draft: result.draft,
		dryRun: true,
		errors: [],
		warnings: [],
		notice,
	};
}

function workflowDispatch(action, target, args = {}) {
	// Handlers close over the caller's (target, args) pair — assessWorkflow
	// reads args.target itself, and the per-action helpers take target
	// directly — so the dispatcher owns only routing and the unknown body.
	const dispatch = defineCommand({
		command: "workflow",
		actions: ["assess", "findings", "compare", "plan"],
		handlers: {
			assess: () => assessWorkflow(args),
			findings: () => dispatchFindings(target, args),
			compare: () => dispatchCompare(target, args),
			plan: () => dispatchPlan(target, args),
		},
		unknown: () => {
			const label = action == null || action === "" ? "(none)" : String(action);
			return {
				target: target || ".",
				errors: [`Unknown workflow action: ${label}. Known: assess, findings, plan, compare.`],
				warnings: [],
			};
		},
	});
	return dispatch(action, args).result;
}

module.exports = { workflowDispatch };
