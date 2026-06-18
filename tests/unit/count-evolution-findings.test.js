"use strict";

// Unit tests for countEvolutionFindings — the shared evolution-counting core
// extracted from extractEvolutionFindings and rollupEvolutionFindings. Pins
// the count+sort behavior directly, plus the two lineage adapters' shapes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	countEvolutionFindings,
	extractEvolutionFindings,
	rollupEvolutionFindings,
} = require("../../scripts/lib/core/maintenance");

function tempTarget() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "evo-count-"));
}

function writeEvolution(targetRoot, content) {
	const dir = path.join(targetRoot, "docs", "wiki", "engineering");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "harness-evolution.md"), content);
}

test("countEvolutionFindings returns [] when the evolution file is missing", () => {
	assert.deepEqual(countEvolutionFindings(tempTarget()), []);
});

test("countEvolutionFindings counts occurrences and sorts by count desc then text asc", () => {
	const root = tempTarget();
	writeEvolution(root, "Finding: beta\nFinding: beta\nFinding: alpha\nFinding: gamma\nFinding: gamma\nFinding: gamma\n");
	const result = countEvolutionFindings(root);
	assert.deepEqual(
		result.map((r) => [r.finding, r.count]),
		[
			["gamma", 3],
			["beta", 2],
			["alpha", 1],
		],
	);
});

test("countEvolutionFindings keeps single occurrences (no threshold filter)", () => {
	const root = tempTarget();
	writeEvolution(root, "Finding: once\n");
	assert.deepEqual(
		countEvolutionFindings(root).map((r) => r.finding),
		["once"],
	);
});

test("extractEvolutionFindings filters to count > 1 and keeps the finding key", () => {
	const root = tempTarget();
	writeEvolution(root, "Finding: dup\nFinding: dup\nFinding: solo\n");
	const result = extractEvolutionFindings(root);
	assert.deepEqual(
		result.map((r) => [r.finding, r.count]),
		[["dup", 2]],
	);
});

test("rollupEvolutionFindings filters to count >= 2, renames to text, and reports threshold", () => {
	const root = tempTarget();
	writeEvolution(root, "Finding: dup\nFinding: dup\nFinding: solo\n");
	const result = rollupEvolutionFindings(root);
	assert.equal(result.threshold, 2);
	assert.deepEqual(
		result.findings.map((r) => [r.text, r.count]),
		[["dup", 2]],
	);
});

test("rollupEvolutionFindings returns empty findings with threshold when the file is missing", () => {
	assert.deepEqual(rollupEvolutionFindings(tempTarget()), {
		findings: [],
		threshold: 2,
	});
});

test("extractEvolutionFindings and rollupEvolutionFindings apply the same significance cutoff", () => {
	// Invariant: both lineage adapters must agree on which findings are
	// significant. They share one threshold source, so the rolled-up set and
	// the extracted set always reference the identical findings.
	const root = tempTarget();
	writeEvolution(
		root,
		"Finding: thrice\nFinding: thrice\nFinding: thrice\nFinding: twice\nFinding: twice\nFinding: once\n",
	);
	const extracted = extractEvolutionFindings(root).map((r) => r.finding);
	const rolled = rollupEvolutionFindings(root).findings.map((r) => r.text);
	assert.deepEqual(rolled, extracted);
	assert.deepEqual(rolled, ["thrice", "twice"]);
});
