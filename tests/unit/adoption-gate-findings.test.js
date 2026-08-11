"use strict";

// Behavioral coverage for adoptionGateFindings — the safety-critical decision
// of when the Adoption Gate must say "wait". It had only an export-existence
// check. A finding here means the gate withholds "ready", so the WHEN matters.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const { adoptionGateFindings } = require("../../scripts/lib/core/adoption-gate");

function report(overrides = {}) {
	return {
		targetType: "target-repo",
		metrics: { missingHarnessFiles: 0, conflicts: 0 },
		candidateCommands: [],
		unknowns: [],
		...overrides,
	};
}

function ids(findings) {
	return findings.map((f) => f.id).sort();
}

test("a fully-ready target-repo produces no findings", () => {
	assert.deepEqual(adoptionGateFindings(report()), []);
});

test("a product-repo is exempt and produces no findings even with missing files", () => {
	const findings = adoptionGateFindings(
		report({ targetType: "product-repo", metrics: { missingHarnessFiles: 5, conflicts: 3 } }),
	);
	assert.deepEqual(findings, []);
});

test("missing Amber starter files raise a wait finding", () => {
	const findings = adoptionGateFindings(
		report({ metrics: { missingHarnessFiles: 4, conflicts: 0 } }),
	);
	assert.deepEqual(ids(findings), ["missing-harness-files"]);
	assert.equal(findings[0].severity, "wait");
});

test("conflicting files raise a wait finding", () => {
	const findings = adoptionGateFindings(
		report({ metrics: { missingHarnessFiles: 0, conflicts: 2 } }),
	);
	assert.deepEqual(ids(findings), ["conflicts-present"]);
	assert.equal(findings[0].severity, "wait");
});

test("unconfirmed candidate commands and unresolved unknowns each raise a wait finding", () => {
	const findings = adoptionGateFindings(
		report({ candidateCommands: ["pytest"], unknowns: ["which test runner?"] }),
	);
	assert.deepEqual(ids(findings), ["candidate-commands-unconfirmed", "unknowns-present"]);
	assert.ok(findings.every((f) => f.severity === "wait"));
});

test("a non-numeric metric (e.g. a drift-broken report) does not fabricate a finding", () => {
	// The numeric guard means a null/string metric is treated as "unknown",
	// not as ">0". This documents the defensive behaviour the structured
	// metrics block now backstops by keeping these values numeric.
	const findings = adoptionGateFindings(
		report({ metrics: { missingHarnessFiles: null, conflicts: "n/a" } }),
	);
	assert.deepEqual(findings, []);
});
