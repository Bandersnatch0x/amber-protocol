"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { assess, buildDraft, compare, findings } = require("../../scripts/lib/workflow-assessment");

const REPO_ROOT = path.resolve(__dirname, "../..");

function createTargetRepository(t) {
	const target = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-effectiveness-"));
	t.after(() => fs.rmSync(target, { recursive: true, force: true }));
	return target;
}

function writeTargetFile(target, relativePath, content) {
	const filePath = path.join(target, ...relativePath.split("/"));
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(
		filePath,
		typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`,
		"utf8",
	);
}

test("Workflow Effectiveness facade assesses a Target Repository", () => {
	const report = assess(REPO_ROOT, { noSessions: true });

	assert.equal(report.schemaVersion, "1.0.0");
	assert.equal(report.target, REPO_ROOT);
	assert.deepEqual(Object.keys(report.dimensions), [
		"contextAdequacy",
		"lifecycleDiscipline",
		"verificationCoverage",
		"deliveryIntegrity",
		"improvementLoop",
	]);
	assert.equal(report.coverage.session, "not-applicable");
	assert.equal("overall" in report, false);
});

test("Workflow Effectiveness facade preserves an all-not-applicable dimension", (t) => {
	const target = createTargetRepository(t);

	const report = assess(target, { noSessions: true });
	const dimension = report.dimensions.improvementLoop;

	assert.deepEqual(
		dimension.checks.map((check) => check.status),
		["not-applicable", "not-applicable", "not-applicable"],
	);
	assert.equal(dimension.score, null);
	assert.equal(dimension.coverage, "not-applicable");
	assert.equal(dimension.confidence, "high");
});

test("Workflow Effectiveness facade caps confidence for partial evidence", (t) => {
	const target = createTargetRepository(t);
	writeTargetFile(
		target,
		"docs/wiki/engineering/harness-evolution.md",
		"Finding: repeated verification gap\nFinding: repeated verification gap\n",
	);

	const report = assess(target, { noSessions: true });
	const dimension = report.dimensions.improvementLoop;

	assert.deepEqual(
		dimension.checks.map((check) => check.status),
		["pass", "not-applicable", "not-applicable"],
	);
	assert.equal(dimension.score, 100);
	assert.equal(dimension.coverage, "partial");
	assert.equal(dimension.confidence, "medium");
});

test("Workflow Effectiveness facade scores fully covered evidence", (t) => {
	const target = createTargetRepository(t);
	const handoffFiles = [
		"README.md",
		"session-summary.md",
		"verification-evidence.md",
		"next-actions.md",
		"risks.md",
		"recovery-commands.md",
		"manifest.json",
	];
	for (const name of handoffFiles) {
		let content = "fixture\n";
		if (name === "risks.md") content = "# Handoff\n\n## Risks\n\n- No known risks.\n";
		if (name === "recovery-commands.md") {
			content = "# Handoff\n\n## Recovery Commands\n\n- `npm test`\n";
		}
		writeTargetFile(target, `.amber/handoff/latest/${name}`, content);
	}

	const report = assess(target, { noSessions: true });
	const dimension = report.dimensions.deliveryIntegrity;

	assert.deepEqual(
		dimension.checks.map((check) => check.status),
		["pass", "pass"],
	);
	assert.equal(dimension.score, 100);
	assert.equal(dimension.coverage, "covered");
});

test("Workflow Effectiveness facade scores failed evidence with high confidence", (t) => {
	const target = createTargetRepository(t);
	const route = JSON.parse(
		fs.readFileSync(path.join(REPO_ROOT, "routes", "refactor-safe.route.json"), "utf8"),
	);
	route.gates = [];
	route.stages = route.stages.map((stage) => {
		const withoutGate = { ...stage };
		delete withoutGate.gateAfter;
		return withoutGate;
	});
	writeTargetFile(target, "routes/refactor-safe.route.json", route);
	writeTargetFile(target, ".amber/governance/rules.json", { defaultAction: "allow" });
	writeTargetFile(
		target,
		"workflow-packs/secure-code-review.pack.json",
		fs.readFileSync(path.join(REPO_ROOT, "workflow-packs", "secure-code-review.pack.json"), "utf8"),
	);
	writeTargetFile(target, ".amber/sessions/fixture/manifest.json", {
		sessionId: "fixture",
		createdAt: "2026-01-01T00:00:00.000Z",
		goal: "Exercise lifecycle evidence through the facade",
		route: { id: "refactor-safe" },
		status: "completed",
	});
	writeTargetFile(
		target,
		".amber/sessions/fixture/timeline.jsonl",
		[
			JSON.stringify({
				type: "stage_completed",
				timestamp: "2026-01-01T00:00:00.000Z",
			}),
			JSON.stringify({
				type: "gate_passed",
				data: { gateId: "user-approval" },
				timestamp: "2026-01-01T00:00:01.000Z",
			}),
			"",
		].join("\n"),
	);

	const report = assess(target, { claudeHome: path.join(target, ".claude-home") });
	const dimension = report.dimensions.lifecycleDiscipline;

	assert.deepEqual(
		dimension.checks.map((check) => check.status),
		["fail", "fail", "pass", "pass"],
	);
	assert.equal(dimension.score, 50);
	assert.equal(dimension.coverage, "covered");
	assert.equal(dimension.confidence, "high");
});

test("Workflow Effectiveness facade compares report evidence", () => {
	const baseline = {
		schemaVersion: "1.0.0",
		dimensions: { contextAdequacy: { score: 60, coverage: "covered" } },
		findings: [],
		coverage: {},
	};
	const current = {
		schemaVersion: "2.0.0",
		dimensions: { contextAdequacy: { score: 80, coverage: "partial" } },
		findings: [],
		coverage: {},
	};

	const result = compare(baseline, current);

	assert.equal(result.versionMismatch, true);
	assert.equal(result.dimensionDeltas[0].scoreDelta, 20);
	assert.deepEqual(
		result.suspiciousImprovements.map((item) => item.dimension),
		["contextAdequacy"],
	);
	assert.ok(result.warnings.some((warning) => warning.includes("Schema version mismatch")));
});

test("Workflow Effectiveness facade exposes report findings", () => {
	const result = findings({
		target: "repo",
		findings: [{ id: "ca-1-feature-observable", dimension: "contextAdequacy" }],
	});

	assert.equal(result.target, "repo");
	assert.equal(result.count, 1);
	assert.equal(result.findings[0].id, "ca-1-feature-observable");
});

test("Workflow Effectiveness facade builds an action draft", () => {
	const report = {
		target: "repo",
		findings: [
			{
				id: "ca-1-feature-observable",
				summary: "Feature behavior is not observable.",
				owner: "planning",
				verifier: "Feature records behavior and Verification.",
				actionKind: "plan-input",
			},
		],
	};

	const result = buildDraft(report, "ca-1-feature-observable");

	assert.equal(result.ok, true);
	assert.equal(result.findingId, "ca-1-feature-observable");
	assert.equal(result.draft.kind, "plan-input");
	assert.ok(result.draft.content.includes("Feature behavior is not observable."));
});

test("Workflow Effectiveness facade returns a domain failure for an unknown finding", () => {
	const result = buildDraft({ target: "repo", findings: [] }, "missing");

	assert.equal(result.ok, false);
	assert.equal(result.findingId, "missing");
	assert.deepEqual(result.errors, ["Finding missing not found."]);
});
