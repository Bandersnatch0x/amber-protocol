"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	renderAdoptionGateDocument,
	renderAdoptionNextActionsDocument,
	renderAdoptionBundleReadme,
	renderAdoptionReport,
} = require("../../scripts/lib/core/adoption-composer/index");

const { defaultAdoptionBoundaries } = require("../../scripts/lib/core/terminology");
const {
	buildAdoptionAuditMetrics,
	parseAdoptionMetricsBlock,
} = require("../../scripts/lib/core/adoption-metrics");

test("renderAdoptionGateDocument includes findings and metrics", () => {
	const markdown = renderAdoptionGateDocument({
		report: {
			file: "report.md",
			target: "/tmp/repo",
			generatedAt: "2026-06-18",
		},
		decision: "wait",
		findings: [{ id: "missing-harness-files", message: "2 Amber starter files are still missing." }],
		metrics: {
			conflicts: { label: "Conflicts", value: 0 },
		},
	});
	assert.match(markdown, /# Adoption Gate Report/);
	assert.match(markdown, /## Findings/);
	assert.match(markdown, /missing-harness-files/);
	assert.match(markdown, /## Metrics/);
});

test("renderAdoptionBundleReadme uses target repository boundary labels", () => {
	const markdown = renderAdoptionBundleReadme({
		target: "/tmp/repo",
		generatedAt: "2026-06-18",
		reportsDir: "docs/adoptions",
		latestReport: "latest.md",
		gateDecision: "wait",
		nextSafeAction: "Review",
		files: [{ relativePath: "README.md" }],
		boundaries: defaultAdoptionBoundaries(),
	});
	assert.match(markdown, /Target repository files copied: false/);
	assert.doesNotMatch(markdown, /target project/i);
});

test("renderAdoptionReport includes adoption report header and no-init notice", () => {
	const markdown = renderAdoptionReport({
		targetRoot: "/tmp/repo",
		audit: {
			readOnly: true,
			classification: { type: "target-repo" },
			auditMode: "target-repo",
			existing: [],
			missing: ["AGENTS.md"],
			docs: [],
			wikiLikeFiles: [],
			conflicts: [],
			candidateCommands: [],
			unknowns: [],
			nextSafeCommand: "node scripts/amber.js init --target . --dry-run",
		},
		metrics: {
			existingHarnessFiles: 0,
			missingHarnessFiles: 1,
			templateStarterFilesPresent: 0,
			templateStarterFilesMissing: 0,
			existingDocs: 0,
			wikiLikeFiles: 0,
			conflicts: 0,
			staleDocs: 0,
		},
		initDryRun: { created: [], skipped: [], notApplicable: false },
		team: {
			installed: false,
			registry: { name: "test-registry", versions: {} },
			lock: null,
		},
		teamUpdatePreview: null,
		maintenance: {
			staleDocs: [],
			rulePackDrift: { drifted: false },
			upgradeAssistant: { currentVersion: null, latestVersion: "1.0.0" },
		},
	});
	assert.match(markdown, /# Amber Protocol Adoption Report/);
	assert.match(markdown, /No target-repository files were initialized/);
	assert.match(markdown, /## Team Distribution/);
});

test("renderAdoptionReport embeds a machine-readable metrics block with staleDocs from maintenance", () => {
	const markdown = renderAdoptionReport({
		targetRoot: "/tmp/repo",
		audit: {
			readOnly: true,
			classification: { type: "target-repo" },
			auditMode: "target-repo",
			existing: ["AGENTS.md", "feature_list.json"],
			missing: ["PROGRESS.md"],
			docs: ["README.md"],
			wikiLikeFiles: ["docs/wiki/index.md"],
			conflicts: ["CLAUDE.md"],
			candidateCommands: [],
			unknowns: [],
			nextSafeCommand: "node scripts/amber.js init --target . --dry-run",
		},
		metrics: {
			existingHarnessFiles: 2,
			missingHarnessFiles: 1,
			templateStarterFilesPresent: 0,
			templateStarterFilesMissing: 0,
			existingDocs: 1,
			wikiLikeFiles: 1,
			conflicts: 1,
			staleDocs: 2,
		},
		initDryRun: { created: [], skipped: [], notApplicable: false },
		team: {
			installed: false,
			registry: { name: "test-registry", versions: {} },
			lock: null,
		},
		teamUpdatePreview: null,
		maintenance: {
			staleDocs: [{ path: "docs/old.md" }, { path: "docs/older.md" }],
			rulePackDrift: { drifted: false },
			upgradeAssistant: { currentVersion: null, latestVersion: "1.0.0" },
		},
	});
	assert.deepEqual(parseAdoptionMetricsBlock(markdown), {
		existingHarnessFiles: 2,
		missingHarnessFiles: 1,
		templateStarterFilesPresent: 0,
		templateStarterFilesMissing: 0,
		existingDocs: 1,
		wikiLikeFiles: 1,
		conflicts: 1,
		staleDocs: 2,
	});
});

test("renderAdoptionReport derives metrics from audit when metrics are omitted", () => {
	const audit = {
		readOnly: true,
		classification: { type: "target-repo" },
		auditMode: "target-repo",
		existing: ["AGENTS.md", "feature_list.json"],
		missing: ["PROGRESS.md"],
		docs: ["README.md"],
		wikiLikeFiles: ["docs/wiki/index.md"],
		conflicts: ["CLAUDE.md"],
		candidateCommands: [],
		unknowns: [],
		nextSafeCommand: "node scripts/amber.js init --target . --dry-run",
	};
	const maintenance = {
		staleDocs: [{ path: "docs/old.md" }, { path: "docs/older.md" }],
		rulePackDrift: { drifted: false },
		upgradeAssistant: { currentVersion: null, latestVersion: "1.0.0" },
	};
	// No `metrics` field: the renderer must derive them from `audit` instead of
	// throwing on metrics.* access.
	const markdown = renderAdoptionReport({
		targetRoot: "/tmp/repo",
		audit,
		initDryRun: { created: [], skipped: [], notApplicable: false },
		team: {
			installed: false,
			registry: { name: "test-registry", versions: {} },
			lock: null,
		},
		teamUpdatePreview: null,
		maintenance,
	});
	assert.match(markdown, /# Amber Protocol Adoption Report/);
	assert.deepEqual(parseAdoptionMetricsBlock(markdown), {
		...buildAdoptionAuditMetrics(audit),
		staleDocs: maintenance.staleDocs.length,
	});
});

test("renderAdoptionReport recommends a dry-run team install first", () => {
	const markdown = renderAdoptionReport({
		targetRoot: "/tmp/repo",
		audit: {
			readOnly: true,
			classification: { type: "target-repo" },
			auditMode: "target-repo",
			existing: [],
			missing: [],
			docs: [],
			wikiLikeFiles: [],
			conflicts: [],
			candidateCommands: [],
			unknowns: [],
		},
		initDryRun: { created: [], skipped: [], notApplicable: false },
		team: {
			installed: false,
			registry: { name: "test-registry", versions: { "1.0.0": {} } },
			lock: null,
		},
		teamUpdatePreview: null,
		maintenance: {
			staleDocs: [],
			rulePackDrift: { drifted: false },
			upgradeAssistant: { currentVersion: null, latestVersion: "1.0.0" },
		},
	});

	assert.match(
		markdown,
		/team install --target <target> --version 1\.0\.0 --preset safe-bootstrap --dry-run --json/,
	);
	assert.doesNotMatch(
		markdown,
		/team install --target <target> --version 1\.0\.0 --preset safe-bootstrap`/,
	);
});

test("renderAdoptionNextActionsDocument does not duplicate boundary lines", () => {
	const markdown = renderAdoptionNextActionsDocument({
		target: "/tmp/repo",
		bundleDir: "bundle",
		latestReport: "latest.md",
		gateDecision: "wait",
		nextSafeAction: "Review",
		boundaries: defaultAdoptionBoundaries(),
		findings: [],
		requiredHarnessFiles: ["AGENTS.md"],
		optionalStarterWikiFiles: [],
		candidateCommands: [],
		unknowns: [],
		approvalGates: [],
	});
	const dynamicMatches = markdown.match(/Dynamic Workflow executed/g) || [];
	assert.equal(dynamicMatches.length, 1);
});
