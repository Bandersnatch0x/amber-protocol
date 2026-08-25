"use strict";

// F039 slice 4: pin workflowDispatch's plain-body contract across the
// defineCommand routing: assess carries the resolved target, findings/plan
// carry the dispatch target, compare deltas stay target-free on the wire, and
// unknown actions keep the guidance body.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { workflowDispatch } = require("../../scripts/lib/workflow-assessment/adapters/command");

function tmpRoot() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-wf-dispatch-"));
}

test("assess body: resolved target + defaulted errors/warnings", () => {
	const root = tmpRoot();
	const body = workflowDispatch("assess", root, { target: root });
	assert.equal(body.target, root);
	assert.ok(body.report);
	assert.deepEqual(body.errors, []);
	assert.deepEqual(body.warnings, []);
	fs.rmSync(root, { recursive: true, force: true });
});

test("findings guard body: dispatch target fallback to '.'", () => {
	assert.deepEqual(workflowDispatch("findings", "", {}), {
		target: ".",
		errors: ["'amber workflow findings' requires --report <path>"],
		warnings: [],
	});
});

test("compare body: report-relative deltas carry no target on the wire", () => {
	const root = tmpRoot();
	const report = path.join(root, "report.json");
	fs.writeFileSync(
		report,
		JSON.stringify({ target: root, schemaVersion: "1.0.0", findings: [] }),
		"utf8",
	);
	const body = workflowDispatch("compare", root, { baseline: report, current: report });
	assert.ok(Array.isArray(body.dimensionDeltas));
	assert.deepEqual(body.errors, []);
	assert.ok(Array.isArray(body.warnings));
	assert.equal(JSON.stringify(body).includes('"target"'), false);
	fs.rmSync(root, { recursive: true, force: true });
});

test("unknown action: guidance body, (none) label for missing actions", () => {
	assert.deepEqual(workflowDispatch("bogus", "t", {}), {
		target: "t",
		errors: ["Unknown workflow action: bogus. Known: assess, findings, plan, compare."],
		warnings: [],
	});
	assert.deepEqual(workflowDispatch(undefined, "", {}), {
		target: ".",
		errors: ["Unknown workflow action: (none). Known: assess, findings, plan, compare."],
		warnings: [],
	});
});

test("plan body: dry-run draft fields with defaulted errors/warnings", () => {
	const root = tmpRoot();
	const report = path.join(root, "report.json");
	fs.writeFileSync(
		report,
		JSON.stringify({
			target: root,
			schemaVersion: "1.0.0",
			findings: [
				{
					id: "x",
					dimension: "contextAdequacy",
					severity: "warning",
					confidence: "medium",
					summary: "test finding",
					evidenceRefs: ["feature_list.json"],
					owner: "planning",
					verifier: "Check passes.",
					actionKind: "plan-input",
				},
			],
		}),
		"utf8",
	);
	const body = workflowDispatch("plan", root, { report, finding: "x" });
	assert.equal(body.target, root);
	assert.equal(body.findingId, "x");
	assert.equal(body.dryRun, true);
	assert.ok(body.draft);
	assert.deepEqual(body.errors, []);
	assert.deepEqual(body.warnings, []);
	fs.rmSync(root, { recursive: true, force: true });
});
