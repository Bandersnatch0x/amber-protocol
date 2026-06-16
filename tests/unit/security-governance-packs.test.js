"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const PACKS = [
	"workflow-packs/security-audit.pack.json",
	"workflow-packs/secure-code-review.pack.json",
	"workflow-packs/vuln-repair-verification.pack.json",
];

function load(relativePath) {
	return JSON.parse(
		fs.readFileSync(path.join(__dirname, "..", "..", relativePath), "utf8"),
	);
}

function isSemver(version) {
	return /^\d+\.\d+\.\d+/.test(version);
}

for (const packPath of PACKS) {
	test(`${packPath} has required security-governance pack shape`, () => {
		const pack = load(packPath);
		assert.ok(pack.id, "id is required");
		assert.ok(pack.title, "title is required");
		assert.ok(isSemver(pack.version), "version must be semver");
		assert.ok(Array.isArray(pack.steps) && pack.steps.length > 0, "steps required");
		assert.ok(
			pack.approvalPolicy && typeof pack.approvalPolicy === "object",
			"approvalPolicy required",
		);
		assert.ok(
			pack.standards.includes("security-governance"),
			"must reference security-governance standard",
		);
		assert.ok(
			!pack.gates,
			"must not use a top-level gates field; use loopContracts[].reviewGates",
		);

		assert.ok(
			Array.isArray(pack.loopContracts) && pack.loopContracts.length > 0,
			"loopContracts required",
		);
		for (const contract of pack.loopContracts) {
			assert.ok(
				Array.isArray(contract.reviewGates) && contract.reviewGates.length > 0,
				"reviewGates must be nested under loopContracts",
			);
			assert.equal(contract.execution.executesAnything, false);
			assert.equal(contract.execution.schedulesJobs, false);
			assert.equal(contract.execution.dispatchesAgents, false);
			assert.equal(contract.execution.writesExternalSystems, false);
		}

		const json = JSON.stringify(pack);
		assert.ok(
			json.includes("requires-human-approval") ||
				json.includes("report-only") ||
				json.includes("without executing") ||
				json.includes("without mutating"),
			"pack must declare a non-execution boundary",
		);
	});
}

test("standards/security-governance.json defines categories and severities", () => {
	const standard = load("standards/security-governance.json");
	assert.ok(Array.isArray(standard.categories) && standard.categories.length >= 6);
	const categoryIds = standard.categories.map((c) => c.id);
	assert.ok(categoryIds.includes("dependency-vulnerability-review"));
	assert.ok(categoryIds.includes("secret-exposure-review"));
	assert.ok(categoryIds.includes("permission-surface-review"));
	assert.ok(categoryIds.includes("insecure-code-generation-review"));
	assert.ok(categoryIds.includes("vulnerability-repair-verification"));
	assert.ok(categoryIds.includes("high-risk-agent-action-review"));

	for (const category of standard.categories) {
		assert.ok(category.name);
		assert.ok(Array.isArray(category.requiredEvidence));
		assert.ok(category.remediationExpectation);
	}

	assert.ok(Array.isArray(standard.severityNames) && standard.severityNames.length > 0);
});
