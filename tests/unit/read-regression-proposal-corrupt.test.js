"use strict";

// Unit tests for readRegressionProposal's corrupt-file hardening. Its try/catch
// only guards JSON *syntax* errors; a file whose contents are a valid JSON
// literal `null` parses cleanly, then `data.regressionProposal` throws on the
// null. Since extractRegressionProposals walks every executions/*/evidence.json,
// one such file would crash the whole maintenance inspection. The reader must
// skip it (return null) the same way it skips an unparseable file.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	readRegressionProposal,
	extractRegressionProposals,
} = require("../../scripts/lib/core/maintenance");

function tempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "regression-corrupt-"));
}

function writeEvidence(targetRoot, taskId, contents) {
	const dir = path.join(targetRoot, ".amber", "executions", taskId);
	fs.mkdirSync(dir, { recursive: true });
	const filePath = path.join(dir, "evidence.json");
	fs.writeFileSync(filePath, contents);
	return filePath;
}

test("readRegressionProposal returns null instead of throwing on a JSON null body", () => {
	const root = tempTarget();
	const filePath = writeEvidence(root, "t1", "null");
	assert.equal(readRegressionProposal(filePath, "t1", root), null);
});

test("readRegressionProposal returns null instead of throwing on a JSON scalar body", () => {
	const root = tempTarget();
	const filePath = writeEvidence(root, "t2", "42");
	assert.equal(readRegressionProposal(filePath, "t2", root), null);
});

test("extractRegressionProposals skips a corrupt evidence file instead of crashing", () => {
	const root = tempTarget();
	writeEvidence(root, "broken", "null");
	writeEvidence(
		root,
		"good",
		JSON.stringify({
			taskId: "good",
			regressionProposal: { status: "proposed", assertion: "must not regress" },
		}),
	);
	const proposals = extractRegressionProposals(root);
	assert.deepEqual(
		proposals.map((p) => p.taskId),
		["good"],
	);
});
