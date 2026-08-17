"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	buildPlanContent,
	readPlanField,
	validatePlanContent,
	evaluateStandardChecks,
	buildReviewResult,
	extractScopeBullet,
	buildScopeDiscipline,
	SCOPE_DISCIPLINE_CHECKLIST,
} = require("../../scripts/lib/core/planning");

const { MESSAGES } = require("../../scripts/lib/core/terminology");

// A plan body that satisfies every gate requirement: a Feature field, a
// "confirmed" User Confirmation, and a non-empty body under each required
// section — including a curated Context manifests section with one
// knowledge-surface entry per role (existence is only checked when a
// resolveExists resolver is injected, so these paths need not exist on disk).
// Tests mutate slices of it to assert each gate rule independently.
function validPlanContent(overrides = {}) {
	return [
		`Feature: ${overrides.featureId ?? "F1"}`,
		`User Confirmation: ${overrides.userConfirmation ?? "confirmed"}`,
		"",
		"## High Level Design",
		overrides.highLevelDesign ?? "approach",
		"",
		"## Context manifests",
		overrides.contextManifests ?? "- implement: docs/specs/contract.md\n- review: docs/adr/0001.md",
		"",
		"## Vertical Slices",
		overrides.verticalSlices ?? "- slice 1",
		"",
		"## Resume Checkpoint",
		overrides.resumeCheckpoint ??
			[
				"- Resume Point: test plan is ready to resume.",
				"- Blockers: none.",
				"- Next Action: run the next verification step.",
				"- Recovery Instructions: reopen this plan and continue from the first unchecked slice.",
			].join("\n"),
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
// refactor of the plan scaffolding pipeline. The F026 scope-discipline helpers
// (extractScopeBullet, buildScopeDiscipline) are pure and covered below.

test("buildPlanContent renders a titled plan for a fully-populated feature", () => {
	const feature = {
		id: "F-001",
		user_visible_behavior: "Users can log in with SSO.",
		verification: ["Run npm test", "Manual smoke test"],
	};
	const out = buildPlanContent(feature, "SSO Login", {
		planPath: "docs/plans/F-001-sso-login.md",
	});

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
	// Durable resume metadata gives a fresh agent the exact continuation point.
	assert.ok(out.includes("## Resume Checkpoint"));
	assert.ok(out.includes("- Resume Point:"));
	assert.ok(out.includes("- Blockers:"));
	assert.ok(out.includes("- Next Action: review docs/plans/F-001-sso-login.md"));
	assert.ok(out.includes("- Recovery Instructions:"));
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
	const verificationSection = out.split("## Verification\n")[1].split("## Evidence Schema")[0];
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

// ---- context manifests (F027): scaffold section, gate rules, review echo ----

test("buildPlanContent renders the Context manifests section between High Level Design and Vertical Slices", () => {
	const feature = {
		id: "F-006",
		user_visible_behavior: "X",
		verification: ["v"],
	};
	const out = buildPlanContent(feature, "Manifests", { planPath: "docs/plans/p.md" });
	// Placement: after High Level Design, before Vertical Slices — never inside
	// the Verification → Evidence Schema window the split test pins.
	const hld = out.indexOf("## High Level Design");
	const manifests = out.indexOf("## Context manifests");
	const slices = out.indexOf("## Vertical Slices");
	assert.ok(hld !== -1 && manifests !== -1 && slices !== -1);
	assert.ok(hld < manifests && manifests < slices, "section sits between HLD and Vertical Slices");
	// The rule line states the knowledge-surface-only contract.
	assert.match(out, /knowledge-surface paths only/);
	assert.match(out, /code paths belong in the feature's booked paths/);
	// Both role placeholder bullets are scaffolded.
	assert.match(out, /- implement: <fill: knowledge-surface paths the implementer needs>/);
	assert.match(out, /- review: <fill: knowledge-surface paths the reviewer needs>/);
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
	assert.ok(result.errors.some((e) => e === "Plan feature F1 was not found in feature_list.json."));
});

test("validatePlanContent surfaces a feature_list read error", () => {
	const result = validatePlanContent({
		content: validPlanContent(),
		resolveFeature: errorResolver,
	});
	assert.ok(result.errors.some((e) => e === "Cannot read feature_list.json: disk on fire"));
});

test("validatePlanContent flags each missing required section", () => {
	// Strip the Verification section body so hasSectionWithBody fails for it.
	const content = validPlanContent().replace("## Verification\n- step\n", "## Verification\n\n");
	const result = validatePlanContent({
		content,
		resolveFeature: foundResolver,
	});
	assert.ok(result.errors.some((e) => e === "Plan must include a non-empty Verification section."));
});

test("validatePlanContent requires every Resume Checkpoint field", () => {
	const result = validatePlanContent({
		content: validPlanContent({
			resumeCheckpoint: [
				"- Resume Point: ready",
				"- Blockers: none",
				"- Next Action: continue",
			].join("\n"),
		}),
		resolveFeature: foundResolver,
	});
	assert.ok(
		result.errors.some((e) => e === "Resume Checkpoint must define Recovery Instructions fields."),
	);
});

test("validatePlanContent requires fields for an empty Resume Checkpoint section", () => {
	const result = validatePlanContent({
		content: validPlanContent({ resumeCheckpoint: "" }),
		resolveFeature: foundResolver,
	});
	assert.ok(result.errors.includes("Plan must include a non-empty Resume Checkpoint section."));
	assert.ok(
		result.errors.includes(
			"Resume Checkpoint must define Resume Point, Blockers, Next Action, Recovery Instructions fields.",
		),
	);
});
test("validatePlanContent requires the User Confirmation to be confirmed (case-insensitive)", () => {
	const result = validatePlanContent({
		content: validPlanContent({ userConfirmation: "pending" }),
		resolveFeature: foundResolver,
	});
	assert.ok(
		result.errors.some(
			(e) => e === "User confirmation is required before implementation-ready status.",
		),
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

// ---- validatePlanContent: context-manifest gate rules (F027) ----

test("validatePlanContent requires a non-empty Context manifests section like other required sections", () => {
	const content = validPlanContent().replace(
		"## Context manifests\n- implement: docs/specs/contract.md\n- review: docs/adr/0001.md\n",
		"",
	);
	const result = validatePlanContent({
		content,
		resolveFeature: foundResolver,
	});
	assert.ok(result.errors.includes("Plan must include a non-empty Context manifests section."));
	// An empty section body fails the same way.
	const emptied = validPlanContent().replace(
		/## Context manifests\n[\s\S]*?\n\n## Vertical Slices/,
		"## Context manifests\n\n## Vertical Slices",
	);
	assert.ok(
		validatePlanContent({ content: emptied, resolveFeature: foundResolver }).errors.includes(
			"Plan must include a non-empty Context manifests section.",
		),
	);
});

test("validatePlanContent flags an uncurated placeholder manifest role with a remedy", () => {
	const result = validatePlanContent({
		content: validPlanContent({
			contextManifests:
				"- implement: <fill: knowledge-surface paths the implementer needs>\n- review: docs/adr/0001.md",
		}),
		resolveFeature: foundResolver,
	});
	assert.equal(result.errors.length, 1);
	assert.match(result.errors[0], /implement role still carries scaffold placeholders/);
	assert.match(result.errors[0], /→ fix:/);
});

test("validatePlanContent flags a missing manifest role bullet", () => {
	const result = validatePlanContent({
		content: validPlanContent({
			contextManifests: "- implement: docs/specs/contract.md",
		}),
		resolveFeature: foundResolver,
	});
	assert.equal(result.errors.length, 1);
	assert.match(result.errors[0], /Context manifests must define an review role/);
	assert.match(result.errors[0], /"- review:/);
});

test("validatePlanContent rejects a code-path manifest entry with the booked-paths remedy", () => {
	const result = validatePlanContent({
		content: validPlanContent({
			contextManifests: "- implement: src/app.js\n- review: docs/adr/0001.md",
		}),
		resolveFeature: foundResolver,
	});
	assert.equal(result.errors.length, 1);
	assert.match(result.errors[0], /src\/app\.js/);
	assert.match(result.errors[0], /is a code path — context lists carry knowledge surfaces/);
	assert.match(result.errors[0], /move code paths to the feature's booked paths/);
});

test("validatePlanContent rejects non-knowledge-surface entries outside the allowed sets", () => {
	for (const entry of ["scripts/lib/x.ts", "lib/handler.py", "cmd/main.go", "styles/main.css"]) {
		const result = validatePlanContent({
			content: validPlanContent({
				contextManifests: `- implement: ${entry}\n- review: docs/adr/0001.md`,
			}),
			resolveFeature: foundResolver,
		});
		assert.ok(
			result.errors.some(
				(e) =>
					e.includes(entry) && /is a code path . context lists carry knowledge surfaces/.test(e),
			),
			`${entry} must be rejected as a non-knowledge surface`,
		);
	}
});

test("validatePlanContent accepts every allowed knowledge-surface shape without existence checks", () => {
	// .md anywhere, anything under docs/, schemas/, standards/, and .schema.json.
	// No resolveExists injected: the pure core skips disk-backed existence.
	const result = validatePlanContent({
		content: validPlanContent({
			contextManifests:
				"- implement: docs/specs/contract.md, schemas/action.schema.json, README.md\n- review: standards/amber-delivery.json, schemas/event.schema.json",
		}),
		resolveFeature: foundResolver,
	});
	assert.deepEqual(result.errors, []);
});

test("validatePlanContent flags manifest entries that do not exist via the injected resolver", () => {
	const result = validatePlanContent({
		content: validPlanContent(),
		resolveFeature: foundResolver,
		resolveExists: () => false,
	});
	assert.deepEqual(result.errors, [
		"Context manifest entry docs/specs/contract.md (implement) does not exist in the target repository (or escapes its root). → fix: point the entry at a knowledge surface inside the repository.",
		"Context manifest entry docs/adr/0001.md (review) does not exist in the target repository (or escapes its root). → fix: point the entry at a knowledge surface inside the repository.",
	]);
	// With the resolver reporting existence, the same content passes — proving
	// the errors come from the injection, not a disk hit inside the core.
	assert.deepEqual(
		validatePlanContent({
			content: validPlanContent(),
			resolveFeature: foundResolver,
			resolveExists: () => true,
		}).errors,
		[],
	);
});

test("validatePlanContent parses comma- and space-separated manifest entries", () => {
	const result = validatePlanContent({
		content: validPlanContent({
			contextManifests: "- implement: docs/a.md,docs/b.md docs/c.md\n- review: docs/adr/0001.md",
		}),
		resolveFeature: foundResolver,
		resolveExists: (entry) => entry !== "docs/b.md",
	});
	assert.deepEqual(result.errors, [
		"Context manifest entry docs/b.md (implement) does not exist in the target repository (or escapes its root). → fix: point the entry at a knowledge surface inside the repository.",
	]);
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
			errors: ["User confirmation is required before implementation-ready status."],
			warnings: [],
		},
		standards: [amberDeliveryStandard],
		content,
	});
	const userConfirmationFindings = result.findings.filter((f) => f.checkId === "user-confirmation");
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

// ---- scope-discipline advisories (F026): booked paths vs declared Scope ----

test("extractScopeBullet captures the Scope bullet block and stops at siblings", () => {
	const content = validPlanContent({
		highLevelDesign: [
			"- Context: the tree is messy.",
			"- Proposed approach:",
			"  1. do the thing.",
			"- Risks:",
			"  - small risk.",
			"- Scope:",
			"  - Touches `src/one.js` and surfaces under docs/.",
			"  - Non-goals: nothing else.",
			"- Follow-ups:",
			"  - later.",
		].join("\n"),
	});
	const scope = extractScopeBullet(content);
	assert.match(scope, /src\/one\.js/);
	assert.match(scope, /Non-goals/);
	assert.ok(!scope.includes("Follow-ups"), "sibling bullet ends the Scope block");
	assert.ok(!scope.includes("Context"), "earlier bullets are not Scope");
});

test("extractScopeBullet returns an empty string without a Scope bullet", () => {
	assert.equal(extractScopeBullet(validPlanContent({ highLevelDesign: "- approach only" })), "");
	assert.equal(extractScopeBullet("# Plan: x\n\nno sections here\n"), "");
});

test("buildScopeDiscipline flags booked paths the Scope never mentions", () => {
	const block = buildScopeDiscipline({
		bookedPaths: ["src/secret.js", "docs/readme.md"],
		scopeText: "- Scope: touches `docs/readme.md` only.",
	});
	assert.deepEqual(block.unmentionedPaths, ["src/secret.js"]);
	assert.deepEqual(block.checklist, SCOPE_DISCIPLINE_CHECKLIST);
});

test("buildScopeDiscipline stays quiet on verbatim and directory-prefix mentions", () => {
	const verbatim = buildScopeDiscipline({
		bookedPaths: ["src/one.js"],
		scopeText: "- Scope: touches `src/one.js` and nothing else.",
	});
	assert.deepEqual(verbatim.unmentionedPaths, []);
	const underDir = buildScopeDiscipline({
		bookedPaths: ["src/deep/helper.js"],
		scopeText: "- Scope: work under src/ stays put.",
	});
	assert.deepEqual(underDir.unmentionedPaths, []);
	const bareDir = buildScopeDiscipline({
		bookedPaths: ["src/deep/helper.js"],
		scopeText: "- Scope: confined to the src tree.",
	});
	assert.deepEqual(bareDir.unmentionedPaths, []);
});

test("buildScopeDiscipline returns null without booked paths or a Scope bullet", () => {
	assert.equal(
		buildScopeDiscipline({ bookedPaths: [], scopeText: "- Scope: touches src/." }),
		null,
	);
	assert.equal(buildScopeDiscipline({ bookedPaths: ["src/a.js"], scopeText: "" }), null);
	assert.equal(buildScopeDiscipline({ bookedPaths: ["src/a.js"], scopeText: "   " }), null);
});

test("buildReviewResult rides scope warnings without touching the blocking channels", () => {
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: { errors: [], warnings: ["gate note"] },
		standards: [],
		scopeDisciplineInput: {
			bookedPaths: ["src/extra.js"],
			scopeText: "- Scope: touches docs/readme.md.",
		},
	});
	// The advisory names the path and lands AFTER the gate warnings.
	assert.deepEqual(result.warnings, [
		"gate note",
		"Booked path src/extra.js is not mentioned in the plan's declared Scope — advisory only; confirm it belongs to this feature.",
	]);
	// Structured block carries the diff plus the checklist.
	assert.deepEqual(result.scopeDiscipline.unmentionedPaths, ["src/extra.js"]);
	assert.deepEqual(result.scopeDiscipline.checklist, SCOPE_DISCIPLINE_CHECKLIST);
	// A scope warning alone never blocks: findings/errors/action/readiness stay clean.
	assert.deepEqual(result.findings, []);
	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.requiredUserAction, []);
	assert.deepEqual(result.releaseReadiness, { status: "ready" });
});

test("buildReviewResult without scope input keeps scopeDiscipline null and warnings intact", () => {
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: { errors: [], warnings: ["gate note"] },
		standards: [],
	});
	assert.equal(result.scopeDiscipline, null);
	assert.deepEqual(result.warnings, ["gate note"]);
	assert.deepEqual(result.releaseReadiness, { status: "ready" });
});

test("printResult renders the four-question checklist as advisory review output", () => {
	const { printResult } = require("../../scripts/lib/core/cli-output");
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: { errors: [], warnings: [] },
		standards: [],
		scopeDisciplineInput: {
			bookedPaths: ["src/extra.js"],
			scopeText: "- Scope: touches docs/readme.md.",
		},
	});
	const lines = [];
	const originalLog = console.log;
	console.log = (line) => lines.push(String(line));
	try {
		printResult(result);
	} finally {
		console.log = originalLog;
	}
	const text = lines.join("\n");
	assert.match(text, /Scope discipline checklist \(advisory — never blocks the gate\):/);
	for (const question of SCOPE_DISCIPLINE_CHECKLIST) {
		assert.match(text, new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	}
	// The unmentioned path rides the warnings footer; readiness stays READY.
	assert.match(text, /Warnings: 1/);
	assert.match(text, /src\/extra\.js is not mentioned in the plan's declared Scope/);
	assert.match(text, /Release readiness: READY/);
});

// ---- context-manifest review echo (F027): display-only, never blocks ----

test("buildReviewResult echoes curated manifests as a structured block without blocking", () => {
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: { errors: [], warnings: [] },
		standards: [],
		content: validPlanContent({
			contextManifests:
				"- implement: docs/specs/contract.md, docs/wiki/runbook.md\n- review: docs/adr/0001.md",
		}),
	});
	assert.deepEqual(result.contextManifests, {
		implement: ["docs/specs/contract.md", "docs/wiki/runbook.md"],
		review: ["docs/adr/0001.md"],
	});
	// The echo never adds findings of its own.
	assert.deepEqual(result.findings, []);
	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.releaseReadiness, { status: "ready" });
});

test("buildReviewResult echoes empty arrays for uncurated roles and null without the section", () => {
	const uncurated = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: { errors: [], warnings: [] },
		standards: [],
		content: validPlanContent({
			contextManifests: "- implement: <fill: not yet curated>\n- review: docs/adr/0001.md",
		}),
	});
	assert.deepEqual(uncurated.contextManifests, { implement: [], review: ["docs/adr/0001.md"] });
	const absent = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: { errors: [], warnings: [] },
		standards: [],
		content: "# Plan: x\n\nno manifest section\n",
	});
	assert.equal(absent.contextManifests, null);
});

test("printResult renders both manifest role lists next to the scope-discipline checklist", () => {
	const { printResult } = require("../../scripts/lib/core/cli-output");
	const result = buildReviewResult({
		targetRoot: "/repo",
		planRelativePath: "p.md",
		gateResult: { errors: [], warnings: [] },
		standards: [],
		content: validPlanContent({
			contextManifests: "- implement: docs/specs/contract.md\n- review: docs/adr/0001.md",
		}),
	});
	const lines = [];
	const originalLog = console.log;
	console.log = (line) => lines.push(String(line));
	try {
		printResult(result);
	} finally {
		console.log = originalLog;
	}
	const text = lines.join("\n");
	assert.match(text, /Context manifests \(knowledge surfaces per role\):/);
	assert.match(text, /implement: docs\/specs\/contract\.md/);
	assert.match(text, /review: docs\/adr\/0001\.md/);
	// Display-only: the echo never blocks readiness.
	assert.match(text, /Release readiness: READY/);
});

// F027 review fixes: target-root containment in the existence resolver,
// markdown-wrapped entries, and case-insensitive extensions.
test("validatePlanGate rejects manifest entries that escape the target root", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-manifest-escape-"));
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), "amber-manifest-outside-"));
	try {
		// An existing file OUTSIDE the target root must not satisfy the gate.
		fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
		fs.writeFileSync(path.join(dir, "docs", "inside.md"), "x");
		fs.writeFileSync(path.join(outside, "escaped.md"), "x");
		const relEscape = path
			.relative(dir, path.join(outside, "escaped.md"))
			.split(path.sep)
			.join("/");
		const { validatePlanGate } = require("../../scripts/lib/core/planning");
		const planRel = "docs/plans/T001-escape.md";
		fs.mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
		fs.writeFileSync(
			path.join(dir, planRel),
			validPlanContent({
				contextManifests: `- implement: docs/inside.md, ${relEscape}\n- review: docs/inside.md`,
			}),
		);
		const result = validatePlanGate(dir, planRel);
		assert.ok(
			result.errors.some((e) => e.includes(relEscape) && e.includes("escapes its root")),
			`escape entry must be rejected: ${result.errors.join(" | ")}`,
		);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(outside, { recursive: true, force: true });
	}
});

test("splitManifestEntries strips markdown wrappers around paths", () => {
	const { validatePlanContent } = require("../../scripts/lib/core/planning");
	const result = validatePlanContent({
		content: validPlanContent({
			contextManifests: "- implement: `docs/a.md`, **docs/b.md**\n- review: docs/c.md",
		}),
		resolveFeature: foundResolver,
		resolveExists: () => true,
	});
	assert.deepEqual(
		result.errors.filter((e) => e.includes("code path")),
		[],
		"wrapped knowledge-surface paths must not be mistaken for code paths",
	);
});

test("isKnowledgeSurfacePath matches extensions case-insensitively", () => {
	const { isKnowledgeSurfacePath } = require("../../scripts/lib/core/planning");
	assert.equal(isKnowledgeSurfacePath("README.MD"), true);
	assert.equal(isKnowledgeSurfacePath("Docs/Specs/Contract.Md"), true);
	assert.equal(isKnowledgeSurfacePath("src/App.JS"), false);
});
