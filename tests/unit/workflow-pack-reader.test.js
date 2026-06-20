"use strict";

// Tests for readWorkflowPackFile (the extracted read-and-parse prelude) plus
// characterization of the error path that previously had no coverage. These
// pin the two inspectors' "cannot read" behavior before and after the
// readWorkflowPackFile extraction.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	readWorkflowPackFile,
	inspectWorkflowPack,
	inspectWorkflowPackReadiness,
} = require("../../scripts/lib/core/workflow-packs");

function tempFile(name, content) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wf-${name}-`));
	const file = path.join(dir, "pack.json");
	fs.writeFileSync(file, content);
	return file;
}

test("readWorkflowPackFile parses a valid pack", () => {
	const file = tempFile("valid", JSON.stringify({ id: "x", version: "1.0.0" }));
	const result = readWorkflowPackFile(file, { executionOnError: {} });
	assert.equal(result.ok, true);
	assert.equal(result.data.id, "x");
	assert.equal(path.isAbsolute(result.packPath), true);
});

test("readWorkflowPackFile surfaces a parse failure with the injected error shape", () => {
	const file = tempFile("bad", "{not json");
	const result = readWorkflowPackFile(file, {
		executionOnError: { executesAnything: false, schedulesJobs: false },
	});
	assert.equal(result.ok, false);
	assert.ok(result.result.errors[0].startsWith("Cannot read workflow pack:"));
	assert.deepEqual(result.result.execution, {
		executesAnything: false,
		schedulesJobs: false,
	});
	assert.equal(result.result.warnings.length, 0);
});

test("inspectWorkflowPack error path carries the minimal execution shape", () => {
	const file = tempFile("insp-bad", "{not json");
	const result = inspectWorkflowPack(file);
	assert.ok(result.errors[0].startsWith("Cannot read workflow pack:"));
	assert.deepEqual(result.execution, { executesAnything: false });
});

test("inspectWorkflowPackReadiness error path carries the readiness execution shape", () => {
	const file = tempFile("ready-bad", "{not json");
	const result = inspectWorkflowPackReadiness(file);
	assert.ok(result.errors[0].startsWith("Cannot read workflow pack:"));
	assert.deepEqual(result.execution, {
		executesAnything: false,
		schedulesJobs: false,
		callsExternalSystems: false,
	});
});

test("a missing file is reported as a read failure", () => {
	const result = inspectWorkflowPack(path.join(tempFile("missing", "{}"), "nope.json"));
	assert.ok(result.errors.some((e) => e.startsWith("Cannot read workflow pack:")));
	assert.equal(result.execution.executesAnything, false);
});

test("inspectWorkflowPackReadiness runs readiness analysis on a valid pack", () => {
	const file = tempFile(
		"ready-ok",
		JSON.stringify({ id: "x", title: "X", version: "1.0.0", steps: [] }),
	);
	const result = inspectWorkflowPackReadiness(file);
	assert.equal(result.execution.executesAnything, false);
	assert.equal(result.execution.schedulesJobs, false);
	assert.ok(result.readiness && typeof result.readiness === "object");
});

test("a missing --file path is reported clearly, not as a cryptic EISDIR", () => {
	// readWorkflowPackFile previously resolved "" to cwd and tried to readJson a
	// directory, surfacing "EISDIR: illegal operation on a directory". The guard
	// must name the missing input instead.
	for (const missing of [undefined, "", "   "]) {
		const read = readWorkflowPackFile(missing, { executionOnError: {} });
		assert.equal(read.ok, false);
		assert.ok(
			read.result.errors.some((e) => /specified|--file/.test(e)),
			`expected a missing-path error for ${JSON.stringify(missing)}, got: ${JSON.stringify(read.result.errors)}`,
		);
	}
});

test("inspectWorkflowPack surfaces a missing-path error without throwing", () => {
	const result = inspectWorkflowPack("");
	assert.ok(result.errors.some((e) => /specified|--file/.test(e)));
	assert.equal(result.execution.executesAnything, false);
});
