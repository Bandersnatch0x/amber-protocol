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

// The di-1 finding note carries the missing-file count and list, so it proves the
// bundle was actually read rather than merely accepted.
function handoffCompletenessNote(body) {
	const finding = (body.report.findings || []).find((f) => f.id === "di-1-handoff-complete");
	assert.ok(finding, "expected a di-1-handoff-complete finding");
	return finding.summary || finding.note || "";
}

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

test("workflow report reads refuse symlinks that escape the target", () => {
	const root = tmpRoot();
	const outside = tmpRoot();
	const outsideReport = path.join(outside, "report.json");
	const linkedReport = path.join(root, "report.json");
	fs.writeFileSync(outsideReport, JSON.stringify({ findings: [] }), "utf8");
	fs.symlinkSync(outsideReport, linkedReport);
	try {
		const result = workflowDispatch("findings", root, { report: "report.json" });
		assert.match(result.errors[0], /outside the target root/i);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("workflow assessment output refuses outside directories and output-file symlinks", () => {
	const root = tmpRoot();
	const outside = tmpRoot();
	try {
		const outsideDir = path.join(outside, "reports");
		const escapedDir = workflowDispatch("assess", root, {
			target: root,
			noSessions: true,
			outputDir: outsideDir,
		});
		assert.match(escapedDir.errors[0], /outside the target root/i);
		assert.equal(fs.existsSync(path.join(outsideDir, "workflow-assessment.json")), false);

		const outputDir = path.join(root, "reports");
		fs.mkdirSync(outputDir, { recursive: true });
		const outsideFile = path.join(outside, "assessment.json");
		fs.writeFileSync(outsideFile, "sentinel\n", "utf8");
		fs.symlinkSync(outsideFile, path.join(outputDir, "workflow-assessment.json"));
		const escapedFile = workflowDispatch("assess", root, {
			target: root,
			noSessions: true,
			outputDir,
		});
		assert.match(escapedFile.errors[0], /outside the target root/i);
		assert.equal(fs.readFileSync(outsideFile, "utf8"), "sentinel\n");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

// issues/0354: the adapter validated the bundle path and then handed its RESULT to
// collectHandoff, which ran the same guard a second time. On a target reached through
// an ancestor junction the guard returns the PHYSICAL path while targetRoot stays
// LEXICAL, so the second pass refused a bundle that sits inside the target itself.
test("assess reads a handoff bundle in a target reached through an ancestor junction", (t) => {
	const container = tmpRoot();
	const real = path.join(container, "real");
	const link = path.join(container, "link");
	fs.mkdirSync(real, { recursive: true });
	try {
		fs.symlinkSync(real, link, process.platform === "win32" ? "junction" : "dir");
	} catch (error) {
		fs.rmSync(container, { recursive: true, force: true });
		if (/EPERM|ENOSYS|not permitted/i.test(error.message)) {
			t.skip(`directory links unavailable: ${error.message}`);
			return;
		}
		throw error;
	}
	// The target is named through the junction, so lexical and physical paths differ.
	const target = path.join(link, "proj");
	const bundle = path.join(target, "bundle");
	try {
		fs.mkdirSync(bundle, { recursive: true });
		assert.notEqual(fs.realpathSync.native(target), path.resolve(target));
		fs.writeFileSync(path.join(bundle, "risks.md"), "# Risks\n\n- drift\n", "utf8");
		fs.writeFileSync(
			path.join(bundle, "recovery-commands.md"),
			"# Recovery Commands\n\n- npm test\n",
			"utf8",
		);
		const relative = workflowDispatch("assess", target, {
			target,
			noSessions: true,
			handoffBundleDir: "bundle",
		});
		assert.deepEqual(relative.errors, []);
		// Not just "no error": the two files written under the junction-reached target
		// must be the ones the report stops listing as missing.
		const note = handoffCompletenessNote(relative);
		assert.match(note, /missing 5 required file/);
		assert.ok(!/risks\.md/.test(note) && !/recovery-commands\.md/.test(note), note);
		// The absolute lexical form must work too: that is what a caller passing
		// --target and --handoff-bundle-dir <abs> actually sends.
		const absolute = workflowDispatch("assess", target, {
			target,
			noSessions: true,
			handoffBundleDir: bundle,
		});
		assert.deepEqual(absolute.errors, []);
		assert.match(handoffCompletenessNote(absolute), /missing 5 required file/);
		// Containment still holds: the same guard must still refuse a real escape.
		const outside = tmpRoot();
		try {
			const escaped = workflowDispatch("assess", target, {
				target,
				noSessions: true,
				handoffBundleDir: outside,
			});
			assert.match(escaped.errors[0], /outside the target root/i);
		} finally {
			fs.rmSync(outside, { recursive: true, force: true });
		}
	} finally {
		fs.rmSync(container, { recursive: true, force: true });
	}
});

test("workflow assessment handoff bundle reads refuse outside directories", () => {
	const root = tmpRoot();
	const outside = tmpRoot();
	try {
		const result = workflowDispatch("assess", root, {
			target: root,
			noSessions: true,
			handoffBundleDir: outside,
		});
		assert.match(result.errors[0], /outside the target root/i);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});
