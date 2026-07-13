"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { validateHandoff } = require("./audit");
const { resolveTarget } = require("./fs-utils");
const { buildGovernanceReport } = require("./governance-report");
const { renderHandoff } = require("../handoff-command");

const REQUIRED_BUNDLE_FILES = [
	"README.md",
	"session-summary.md",
	"verification-evidence.md",
	"next-actions.md",
	"risks.md",
	"recovery-commands.md",
	"manifest.json",
];

function slash(value) {
	return value.split(path.sep).join("/");
}

function defaultBundleDir(targetRoot) {
	return path.join(targetRoot, ".amber", "handoff", "latest");
}

function resolveTargetRelativePath(targetRoot, candidate) {
	if (!candidate) return defaultBundleDir(targetRoot);
	return path.isAbsolute(candidate) ? candidate : path.resolve(targetRoot, candidate);
}

function section(content, title) {
	const pattern = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
	const match = content.match(pattern);
	if (!match) return "None recorded.\n";
	const start = match.index + match[0].length;
	const rest = content.slice(start);
	const next = rest.search(/^##\s+/m);
	return (next >= 0 ? rest.slice(0, next) : rest).trim() + "\n";
}

function renderReadme({ targetRoot, generatedAt, report }) {
	return [
		"# Amber Handoff Bundle",
		"",
		`Target: ${targetRoot}`,
		`Generated: ${generatedAt}`,
		`Readiness score: ${report.scores.overall}/100 (${report.decision})`,
		"",
		"This bundle is the portable continuation artifact for Amber Protocol work.",
		"It captures the current state, evidence, risks, next actions, and recovery commands without requiring chat history.",
		"",
		"## Files",
		"",
		"- session-summary.md",
		"- verification-evidence.md",
		"- next-actions.md",
		"- risks.md",
		"- recovery-commands.md",
		"- manifest.json",
		"",
	].join("\n");
}

function renderVerificationEvidence(handoffContent, report) {
	const evidence = section(handoffContent, "Verification Evidence");
	return [
		"# Verification Evidence",
		"",
		evidence.trim(),
		"",
		"## Evidence Score",
		"",
		`- Evidence: ${report.scores.evidence}/100`,
		`- Feature evidence records: ${report.summary.featureEvidence}`,
		"",
	].join("\n");
}

function renderNextActions(report) {
	const lines = ["# Next Actions", ""];
	if (report.nextActions.length === 0) {
		lines.push("- No blocking next action. Validate the bundle before handoff.");
	} else {
		for (const action of report.nextActions) {
			lines.push(`- [${action.severity}] ${action.id}`);
			lines.push(`  - Why: ${action.why}`);
			lines.push(`  - Run: \`${action.command}\``);
			lines.push(`  - Expected outcome: ${action.expectedOutcome}`);
			lines.push(`  - Blocks: ${action.blocks.join(", ")}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

function renderRisks(report) {
	const lines = ["# Risks", ""];
	const findings = report.readiness.findings || [];
	if (findings.length === 0) {
		lines.push("- None recorded.");
	} else {
		for (const finding of findings) {
			lines.push(`- [${finding.severity}] ${finding.id}: ${finding.message}`);
		}
	}
	lines.push("", "## Maintenance", "");
	if ((report.maintenance.staleDocs || []).length === 0) {
		lines.push("- No stale docs detected.");
	} else {
		for (const doc of report.maintenance.staleDocs) {
			lines.push(`- ${doc.path}: ${doc.reason}`);
		}
	}
	lines.push("");
	return lines.join("\n");
}

function renderRecoveryCommands(targetDisplay) {
	return [
		"# Recovery Commands",
		"",
		"Run these from the Amber repository root unless your installation documents a different entry point.",
		"",
		`- Validate setup: \`node scripts/amber.js doctor --target ${targetDisplay}\``,
		`- Rebuild governance report: \`node scripts/amber.js governance report --target ${targetDisplay}\``,
		`- Inspect next action: \`node scripts/amber.js next --target ${targetDisplay}\``,
		`- Regenerate live handoff: \`node scripts/amber.js handoff --target ${targetDisplay}\``,
		`- Rebuild bundle: \`node scripts/amber.js handoff bundle --target ${targetDisplay}\``,
		`- Validate bundle: \`node scripts/amber.js handoff validate --target ${targetDisplay}\``,
		"",
	].join("\n");
}

function writeFile(outputDir, rel, content) {
	const filePath = path.join(outputDir, rel);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content);
	return filePath;
}

function buildManifest({ targetRoot, outputDir, generatedAt, report }) {
	return {
		schemaVersion: 1,
		artifactType: "amber-handoff-bundle",
		target: targetRoot,
		generatedAt,
		readinessScore: report.scores.overall,
		decision: report.decision,
		files: REQUIRED_BUNDLE_FILES.filter((file) => file !== "manifest.json"),
		bundleDir: outputDir,
	};
}

function writeHandoffBundle(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const targetDisplay = options.targetDisplay || target || ".";
	const outputDir = resolveTargetRelativePath(targetRoot, options.outputDir || options.bundleDir);
	const generatedAt = options.generatedAt || new Date().toISOString();
	const report = buildGovernanceReport(targetRoot, { targetDisplay });
	const handoffContent = renderHandoff(targetRoot);

	const files = [];
	files.push(writeFile(outputDir, "README.md", renderReadme({ targetRoot, generatedAt, report })));
	files.push(writeFile(outputDir, "session-summary.md", handoffContent));
	files.push(writeFile(outputDir, "verification-evidence.md", renderVerificationEvidence(handoffContent, report)));
	files.push(writeFile(outputDir, "next-actions.md", renderNextActions(report)));
	files.push(writeFile(outputDir, "risks.md", renderRisks(report)));
	files.push(writeFile(outputDir, "recovery-commands.md", renderRecoveryCommands(targetDisplay)));
	files.push(writeFile(outputDir, "manifest.json", `${JSON.stringify(buildManifest({ targetRoot, outputDir, generatedAt, report }), null, 2)}\n`));

	const validation = validateHandoffBundle(outputDir);
	const handoffValidation = validateHandoff(targetRoot);
	return {
		target: targetRoot,
		outputDir,
		files: files.map((filePath) => slash(path.relative(outputDir, filePath))),
		manifestPath: path.join(outputDir, "manifest.json"),
		valid: validation.valid,
		readinessScore: report.scores.overall,
		decision: report.decision,
		text: `Handoff bundle written: ${outputDir}\nFiles: ${files.length}\nReadiness score: ${report.scores.overall}/100 (${report.decision})`,
		errors: [...validation.errors, ...(handoffValidation.errors || [])],
		warnings: [...validation.warnings, ...(handoffValidation.warnings || [])],
	};
}

function validateHandoffBundle(bundleDir) {
	const resolved = path.resolve(bundleDir || defaultBundleDir(process.cwd()));
	const errors = [];
	const warnings = [];

	if (!fs.existsSync(resolved)) {
		return {
			bundleDir: resolved,
			valid: false,
			errors: [`handoff bundle directory is missing: ${resolved}`],
			warnings,
		};
	}

	for (const rel of REQUIRED_BUNDLE_FILES) {
		if (!fs.existsSync(path.join(resolved, rel))) {
			errors.push(`${rel} is missing from handoff bundle.`);
		}
	}

	let manifest = null;
	const manifestPath = path.join(resolved, "manifest.json");
	if (fs.existsSync(manifestPath)) {
		try {
			manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
		} catch (error) {
			errors.push(`manifest.json is not valid JSON: ${error.message}`);
		}
	}

	if (manifest) {
		if (manifest.artifactType !== "amber-handoff-bundle") {
			errors.push("manifest.json artifactType must be amber-handoff-bundle.");
		}
		const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
		for (const rel of REQUIRED_BUNDLE_FILES.filter((file) => file !== "manifest.json")) {
			if (!manifestFiles.includes(rel)) {
				errors.push(`manifest.json does not list required file: ${rel}`);
			}
		}
	}

	return {
		bundleDir: resolved,
		valid: errors.length === 0,
		manifest,
		errors,
		warnings,
		text: errors.length === 0
			? `Handoff bundle valid: ${resolved}`
			: `Handoff bundle invalid: ${resolved}\nErrors: ${errors.length}`,
	};
}

module.exports = {
	REQUIRED_BUNDLE_FILES,
	defaultBundleDir,
	resolveTargetRelativePath,
	writeHandoffBundle,
	validateHandoffBundle,
};
