"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
	buildPlanContent,
	readPlanField,
	validatePlanContent,
	evaluateStandardChecks,
	buildReviewResult,
} = require("../../scripts/lib/core/planning");

const { MESSAGES } = require("../../scripts/lib/core/terminology");

// A plan body that satisfies every gate requirement: a Feature field, a
// "confirmed" User Confirmation, and a non-empty body under each required
// section. Tests mutate slices of it to assert each gate rule independently.
function validPlanContent(overrides = {}) {
	return [
		`Feature: ${overrides.featureId ?? "F1"}`,
		`User Confirmation: ${overrides.userConfirmation ?? "confirmed"}`,
		"",
		"## High Level Design",
		overrides.highLevelDesign ?? "approach",
		"",
		"## Vertical Slices",
		overrides.verticalSlices ?? "- slice 1",
		"",
		"## Acceptance Criteria",
		overrides.acceptanceCriteria ?? "- criterion",
		"",
		"## Verification",
		overrides.verification ?? "- step",
		"",
		"## Evidence Schema",
		overrides.evidenceSchema ?? "- Command:",
		"",
	].join("\n");
}

const foundResolver = () => ({ found: true, error: null });
const notFoundResolver = () => ({ found: false, error: null });
const errorResolver = () => ({ found: false, error: "disk on fire" });

// Characterization tests for the pure helpers exported from planning.js.
// The remaining exports (scaffoldPlan, validatePlanGate, discoverStandards,
// reviewPlan, acceptPlan) are fs-coupled and intentionally not covered here.
// Pin current behavior of buildPlanContent and readPlanField before any future
// refactor of the plan scaffolding pipeline.

test("buildPlanContent renders a titled plan for a fully-populated feature", () => {
	const feature = {
		id: "F-001",
		user_visible_behavior: "Users can log in with SSO.",
		verification: ["Run npm test", "Manual smoke test"],
	};
	const out = buildPlanContent(feature, "SSO Login");

	assert.equal(out.split("\n")[0], "# Plan: SSO Login");
	assert.ok(out.includes("Feature: F-001"));
	assert.ok(out.includes("Status: implementation-ready"));
	assert.ok(out.includes("User Confirmation: pending"));
	// user_visible_behavior is inlined into the Goal section.
	assert.ok(out.includes("Users can log in with SSO."));
	// verification steps become bullets in the Verification section.
	assert.ok(out.includes("- Run npm test"));
	assert.ok(out.includes("- Manual smoke test"));
	// guardrails check message from terminology is embedded verbatim.
	assert.ok(out.includes("- Existing Amber guardrails still pass."));
});

test("buildPlanContent falls back to default goal text when user_visible_behavior is missing", () => {
	const feature = {
		id: "F-002",
		verification: ["v1"],
	};
	const out = buildPlanContent(feature, "No UVB");
	assert.ok(out.includes("Describe the user-visible outcome."));
});

test("buildPlanContent renders no verification bullets for an empty verification array", () => {
	const feature = {
		id: "F-003",
		user_visible_behavior: "X",
		verification: [],
	};
	const out = buildPlanContent(feature, "Empty");
	const verificationSection = out.split("## Verification\n")[1].split(
		"## Evidence Schema",
	)[0];
	// The section body contains only the surrounding blank lines; no bullets.
	assert.ok(!verificationSection.includes("- "));
});

test("buildPlanContent throws when feature.verification is missing", () => {
	// buildPlanContent calls feature.verification.map unconditionally, so a feature
	// without a verification array throws a TypeError. Pin this so a future
	// defensive guard is a deliberate change rather than a silent fix.
	const feature = { id: "F-004", user_visible_behavior: "X" };
	assert.throws(
		() => buildPlanContent(feature, "Throws"),
		/Cannot read properties of undefined \(reading 'map'\)/,
	);
});

test("buildPlanContent interpolates an undefined title literally", () => {
	// No title argument and no feature.title -> the header receives the string
	// "undefined" rather than throwing or defaulting.
	const feature = {
		id: "F-005",
		user_visible_behavior: "X",
		verification: ["v"],
	};
	const out = buildPlanContent(feature, undefined);
	assert.equal(out.split("\n")[0], "# Plan: undefined");
});

test("readPlanField returns the trimmed value of a matching field", () => {
	const content = "Feature: F-001\nStatus: pending";
	assert.equal(readPlanField(content, "Feature"), "F-001");
	assert.equal(readPlanField(content, "Status"), "pending");
});

test("readPlanField returns an empty string when the field is absent", () => {
	const content = "Feature: F-001\n";
	assert.equal(readPlanField(content, "Missing"), "");
});

test("readPlanField matches case-insensitively", () => {
	const content = "feature: lowercase-value";
	assert.equal(readPlanField(content, "Feature"), "lowercase-value");
});

test("readPlanField matches across multiple lines (multiline mode)", () => {
	const content = "Header line\nFeature: F-999\nTrailing line";
	assert.equal(readPlanField(content, "Feature"), "F-999");
});

test("readPlanField trims surrounding whitespace from the captured value", () => {
	const content = "Feature:   spaced-value   \r";
	assert.equal(readPlanField(content, "Feature"), "spaced-value");
});

test("readPlanField matches a value with no space after the colon", () => {
	const content = "Feature:multi";
	assert.equal(readPlanField(content, "Feature"), "multi");
});

test("readPlanField escapes regex metacharacters in the field name", () => {
	// A field name containing regex metacharacters (dots, brackets) must be
	// matched literally, not interpreted as a pattern.
	assert.equal(readPlanField("a.b: 5", "a.b"), "5");
	assert.equal(readPlanField("a-b: 6", "a-b"), "6");
	assert.equal(readPlanField("Result: with [brackets]", "Result"), "with [brackets]");
});

// ---- validatePlanContent: pure gate-validation core (fs injected away) ----

test("validatePlanContent accepts a fully-valid plan with a found feature", () => {
	const result = validatePlanContent({
		content: validPlanContent(),
		resolveFeature: foundResolver,
	});
	assert.equal(result.feature, "F1");
	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.warnings, []);
});

test("validatePlanContent flags a missing Feature field", () => {
	const result = validatePlanContent({
		content: validPlanContent({ featureId: "" }).replace("Feature: \n", ""),
		resolveFeature: foundResolver,
	});
	assert.ok(result.errors.some((e) => e === "Plan must include a Feature field."));
	assert.equal(result.feature, null);
});

test("validatePlanContent flags a feature that is not found", () => {
	const result = validatePlanContent({
		content: validPlanContent(),
		resolveFeature: notFoundResolver,
	});
	assert.ok(
		result.errors.some((e) =>
			e === "Plan feature F1 was not found in feature_list.json."),
	);
});

test("validatePlanContent surfaces a feature_list read error", () => {
	const result = validatePlanContent({
		content: validPlanContent(),
		resolveFeature: errorResolver,
	});
	assert.ok(
		result.errors.some((e) =>
			e === "Cannot read feature_list.json: disk on fire"),
	);
});

test("validatePlanContent flags each missing required section", () => {
	// Strip the Verification section body so hasSectionWithBody fails for it.
	const content = validPlanContent().replace("## Verification\n- step\n", "## Verification\n\n");
	const result = validatePlanContent({
		content,
		resolveFeature: foundResolver,
	});
	assert.ok(
		result.errors.some((e) =>
			e === "Plan must include a non-empty Verification section."),
	);
});

test("validatePlanContent requires the User Confirmation to be confirmed (case-insensitive)", () => {
	const result = validatePlanContent({
		content: validPlanContent({ userConfirmation: "pending" }),
		resolveFeature: foundResolver,
	});
	assert.ok(
		result.errors.some((e) =>
			e === "User confirmation is required before implementation-ready status."),
	);
	// "Confirmed" with any casing satisfies the gate.
	assert.deepEqual(
		validatePlanContent({
			content: validPlanContent({ userConfirmation: "Confirmed" }),
			resolveFeature: foundResolver,
		}).errors,
		[],
	);
});

test("validatePlanContent orders errors feature-field, then sections, then confirmation", () => {
	// Everything wrong at once: missing feature, no sections, no confirmation.
	const result = validatePlanContent({
		content: "# Plan: x\n\nUser Confirmation: no\n",
		resolveFeature: foundResolver,
	});
	assert.equal(result.errors[0], "Plan must include a Feature field.");
	// Sections come next, in declared order.
	assert.ok(result.errors[1].startsWith("Plan must include a non-empty High Level Design"));
	assert.ok(
		result.errors[result.errors.length - 1] ===
			"User confirmation is required before implementation-ready status.",
	);
});

// ---- buildReviewResult: pure review assembly ----

test("buildReviewResult with no gate errors and no standards is ready", () => {
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "docs/plans/x.md",
		gateResult: { errors: [], warnings: [] },
		standards: [],
	});
	assert.deepEqual(result.findings, []);
	assert.deepEqual(result.applicableChecks, []);
	assert.deepEqual(result.requiredUserAction, []);
	assert.deepEqual(result.releaseReadiness, { status: "ready" });
	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.loadedStandards, []);
});

test("buildReviewResult classifies the user-confirmation error distinctly", () => {
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: {
			errors: [
				"User confirmation is required before implementation-ready status.",
				"Plan must include a non-empty Verification section.",
			],
			warnings: [],
		},
		standards: [],
	});
	assert.equal(result.findings.length, 2);
	assert.equal(result.findings[0].checkId, "user-confirmation");
	assert.equal(result.findings[0].severity, "error");
	assert.equal(result.findings[1].checkId, "plan-gate");
});

test("buildReviewResult marks the release blocked and requires user action when findings exist", () => {
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: { errors: ["Plan must include a non-empty Goal section."], warnings: [] },
		standards: [],
	});
	assert.deepEqual(result.releaseReadiness, { status: "blocked" });
	assert.deepEqual(result.requiredUserAction, [
		"Confirm the plan and resolve review findings before acceptance.",
	]);
});

test("buildReviewResult expands standards into applicable checks", () => {
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: { errors: [], warnings: [] },
		standards: [
			{ id: "std-a", checks: [{ id: "c1", description: "first" }] },
			{ id: "std-b", checks: [] },
		],
	});
	assert.deepEqual(result.loadedStandards, ["std-a", "std-b"]);
	assert.deepEqual(result.applicableChecks, [
		{ standard: "std-a", id: "c1", description: "first" },
	]);
	assert.deepEqual(result.nonApplicableChecks, []);
});

test("buildReviewResult echoes gate warnings and derives errors from findings", () => {
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: { errors: ["boom"], warnings: ["watch out"] },
		standards: [],
	});
	assert.deepEqual(result.warnings, ["watch out"]);
	assert.deepEqual(result.errors, ["boom"]);
});

// ---- evaluateStandardChecks: standards become executable, not decorative ----

const amberDeliveryStandard = {
	id: "amber-delivery",
	checks: [
		{ id: "user-confirmation", description: "needs confirmation" },
		{ id: "verification-evidence", description: "needs evidence fields" },
		{ id: "scope-boundary", description: "needs scope acknowledgment" },
	],
};

test("evaluateStandardChecks passes a fully valid confirmed plan", () => {
	const content = validPlanContent({
		userConfirmation: "confirmed",
		acceptanceCriteria: `- criterion\n${MESSAGES.planGuardrailsCheck}`,
		evidenceSchema: "- Command:\n- Result:\n- Date:\n- Notes:",
	});
	const findings = evaluateStandardChecks({
		content,
		standards: [amberDeliveryStandard],
	});
	assert.deepEqual(findings, []);
});

test("evaluateStandardChecks flags missing user confirmation", () => {
	const findings = evaluateStandardChecks({
		content: validPlanContent({
			userConfirmation: "pending",
			acceptanceCriteria: `- criterion\n${MESSAGES.planGuardrailsCheck}`,
			evidenceSchema: "- Command:\n- Result:\n- Date:\n- Notes:",
		}),
		standards: [amberDeliveryStandard],
	});
	assert.equal(findings.length, 1);
	assert.equal(findings[0].checkId, "user-confirmation");
});

test("evaluateStandardChecks flags incomplete evidence schema fields", () => {
	const findings = evaluateStandardChecks({
		content: validPlanContent({
			userConfirmation: "confirmed",
			acceptanceCriteria: `- ok\n${MESSAGES.planGuardrailsCheck}`,
			evidenceSchema: "- Command:",
		}),
		standards: [amberDeliveryStandard],
	});
	assert.ok(
		findings.some((f) => f.checkId === "verification-evidence" && /Result/.test(f.message)),
	);
});

test("evaluateStandardChecks flags acceptance criteria without scope acknowledgment", () => {
	const findings = evaluateStandardChecks({
		content: validPlanContent({
			userConfirmation: "confirmed",
			acceptanceCriteria: "- ship it",
			evidenceSchema: "- Command:\n- Result:\n- Date:",
		}),
		standards: [amberDeliveryStandard],
	});
	assert.ok(findings.some((f) => f.checkId === "scope-boundary"));
});

test("buildReviewResult merges standard findings without duplicating gate user-confirmation", () => {
	const content = validPlanContent({ userConfirmation: "pending" });
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: {
			errors: [
				"User confirmation is required before implementation-ready status.",
			],
			warnings: [],
		},
		standards: [amberDeliveryStandard],
		content,
	});
	const userConfirmationFindings = result.findings.filter(
		(f) => f.checkId === "user-confirmation",
	);
	assert.equal(userConfirmationFindings.length, 1);
});

test("buildReviewResult blocks release when only a standard check fails", () => {
	const content = validPlanContent({
		userConfirmation: "confirmed",
		acceptanceCriteria: "- ship the slice",
		evidenceSchema: "- Command:\n- Result:\n- Date:",
	});
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: { errors: [], warnings: [] },
		standards: [amberDeliveryStandard],
		content,
	});
	assert.equal(result.releaseReadiness.status, "blocked");
	assert.ok(result.findings.some((f) => f.checkId === "scope-boundary"));
});
