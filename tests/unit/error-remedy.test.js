"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { scaffoldPlan, validatePlanGate, reviewPlan } = require("../../scripts/lib/core/planning");

function tmpRepo() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-error-remedy-"));
}

function setupPendingPlan(dir) {
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({
			features: [
				{ id: "F001", title: "Login", status: "not_started", verification: [], evidence: [] },
			],
		}) + "\n",
	);
	const plansDir = path.join(dir, "docs", "plans");
	fs.mkdirSync(plansDir, { recursive: true });
	fs.writeFileSync(
		path.join(plansDir, "F001-login.md"),
		"Feature: F001\nStatus: implementation-ready\nUser Confirmation: pending\n",
	);
	return "docs/plans/F001-login.md";
}

describe("error-site remedies", () => {
	it("plan: feature-not-found error keeps its sentence and appends a feature add fix", () => {
		const dir = tmpRepo();
		fs.writeFileSync(path.join(dir, "feature_list.json"), JSON.stringify({ features: [] }) + "\n");
		const result = scaffoldPlan(dir, { feature: "F009", title: "Ghost" });
		const joined = result.errors.join(" ");
		assert.match(joined, /Feature F009 was not found in feature_list\.json\./);
		assert.match(joined, /→ fix: amber feature add --id F009/);
	});

	it("gate: user-confirmation error string is left unchanged (protects strict-equality tests)", () => {
		const dir = tmpRepo();
		const planPath = setupPendingPlan(dir);
		const result = validatePlanGate(dir, planPath);
		assert.ok(
			result.errors.includes("User confirmation is required before implementation-ready status."),
			"gate error string must stay verbatim",
		);
	});

	it("review: user-confirmation finding carries a structured gate --confirm remedy", () => {
		const dir = tmpRepo();
		const planPath = setupPendingPlan(dir);
		const result = reviewPlan(dir, planPath);
		const finding = result.findings.find((f) => f.checkId === "user-confirmation");
		assert.ok(finding, "expected a user-confirmation finding");
		assert.match(
			finding.remedy,
			/amber gate --confirm --target \. --plan docs\/plans\/F001-login\.md/,
		);
		// message stays clean (no inline fix) — symmetric with doctor's structured remedy.
		assert.equal(
			finding.message,
			"User confirmation is required before implementation-ready status.",
		);
	});
});
