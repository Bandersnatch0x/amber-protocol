"use strict";

// F023 dedicated suite: post-accept learning write-back checkpoint.
//
// Covers the pure trigger classification, the `learnings` lifecycle step gating
// (via the lifecycle SSOT), the read-only inspector, the booking writer (the
// checkpoint's only write), the `amber learnings` CLI surface end-to-end, and
// the handoff "Learning write-back" section. Contract doc:
// docs/specs/2026-08-15-learning-writeback.md — invariants are numbered there
// and each test below anchors at least one.

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
	TRIGGER_CATEGORIES,
	detectWriteBackTriggers,
	learningWriteBackGuidance,
	inspectLearningWriteBack,
	bookLearningWriteBack,
} = require("../../scripts/lib/core/learning-writeback");
const {
	LEARNING_OWNER_ROUTES,
	LEARNING_OWNER_IDS,
	getLearningOwner,
} = require("../../scripts/lib/core/learning-owner-routing");
const {
	buildContext,
	inferNextStep,
	evaluateLifecycle,
} = require("../../scripts/lib/core/lifecycle");
const { REQUIRED_HARNESS_FILES } = require("../../scripts/lib/core/constants");
const { validateFeatureListData } = require("../../scripts/lib/core/validators");
const { renderHandoff, writeHandoff } = require("../../scripts/lib/handoff-command");
const { installTargetRoutes } = require("../helpers/target-routes");

const roots = [];

function makeRoot(prefix) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	roots.push(dir);
	return dir;
}

after(() => {
	for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

// ── Trigger classification (pure) ────────────────────────────────────────────

const categoryIds = () => TRIGGER_CATEGORIES.map((c) => c.id);

describe("trigger classification (pure)", () => {
	it("classifies schema paths: .schema.json suffix plus schemas/ and migrations/ segments", () => {
		assert.deepEqual(
			categoryIds(),
			["schema", "contract", "infra"],
			"three categories, fixed order",
		);
		for (const p of [
			"schemas/route.schema.json",
			"src/config.schema.json",
			"schemas/anything.ts",
			"db/migrations/001.sql",
			"migrations/002_add_users.sql",
		]) {
			const r = detectWriteBackTriggers([p]);
			assert.deepEqual(r.matchedCategories, ["schema"], `${p} must match schema only`);
			assert.deepEqual(r.triggered[0].matches, [p], "matched path is listed verbatim");
		}
	});

	it("classifies contract paths: docs/specs and docs/contracts sequences plus openapi/swagger basenames", () => {
		for (const p of [
			"docs/specs/foo.md",
			"docs/contracts/api.md",
			"openapi.yaml",
			"swagger.json",
			"api/openapi.v2.yml",
		]) {
			const r = detectWriteBackTriggers([p]);
			assert.deepEqual(r.matchedCategories, ["contract"], `${p} must match contract only`);
		}
	});

	it("classifies infra paths: workflows, k8s, infra segments plus Dockerfile/docker-compose basenames", () => {
		for (const p of [
			".github/workflows/ci.yml",
			"Dockerfile",
			"docker-compose.prod.yml",
			"k8s/deploy.yaml",
			"infra/queue.ts",
		]) {
			const r = detectWriteBackTriggers([p]);
			assert.deepEqual(r.matchedCategories, ["infra"], `${p} must match infra only`);
		}
	});

	it("a plain source path matches nothing", () => {
		for (const p of ["src/index.js", "lib/util.ts", "README.md", "docs/notes/general.md"]) {
			assert.deepEqual(
				detectWriteBackTriggers([p]),
				{ triggered: [], matchedCategories: [] },
				`${p} must not trigger`,
			);
		}
	});

	it("accepts Windows backslash separators", () => {
		assert.deepEqual(detectWriteBackTriggers(["docs\\specs\\foo.md"]).matchedCategories, [
			"contract",
		]);
		assert.deepEqual(detectWriteBackTriggers(["db\\migrations\\001.sql"]).matchedCategories, [
			"schema",
		]);
		assert.deepEqual(detectWriteBackTriggers([".github\\workflows\\ci.yml"]).matchedCategories, [
			"infra",
		]);
	});

	it("matches case-insensitively but lists the original path", () => {
		const r = detectWriteBackTriggers(["Docs/Specs/x.md", "SCHEMAS/route.json", "K8s/deploy.yaml"]);
		assert.deepEqual(
			r.matchedCategories,
			["schema", "contract", "infra"],
			"all three matched, in TRIGGER_CATEGORIES order",
		);
		assert.ok(
			r.triggered.find((t) => t.category === "contract").matches.includes("Docs/Specs/x.md"),
		);
	});

	it("detects multiple categories from one path list", () => {
		const r = detectWriteBackTriggers([
			"src/index.js",
			"schemas/route.schema.json",
			"Dockerfile",
			"docs/specs/contract.md",
		]);
		assert.deepEqual(r.matchedCategories, ["schema", "contract", "infra"]);
		assert.deepEqual(
			r.triggered.map((t) => t.matches),
			[["schemas/route.schema.json"], ["docs/specs/contract.md"], ["Dockerfile"]],
		);
	});

	it("filters non-string and blank entries without throwing", () => {
		const r = detectWriteBackTriggers([null, 42, "", "   ", undefined, {}, "Dockerfile"]);
		assert.deepEqual(r.matchedCategories, ["infra"]);
		assert.deepEqual(r.triggered[0].matches, ["Dockerfile"]);
	});

	it("an empty list (or non-list input) yields no triggers, and classification is deterministic", () => {
		assert.deepEqual(detectWriteBackTriggers([]), { triggered: [], matchedCategories: [] });
		const once = detectWriteBackTriggers(["schemas/a.schema.json", "Dockerfile"]);
		const twice = detectWriteBackTriggers(["schemas/a.schema.json", "Dockerfile"]);
		assert.deepEqual(once, twice, "identical input → identical output (invariant 1)");
	});

	it("guidance names the three knowledge surfaces", () => {
		const lines = learningWriteBackGuidance();
		assert.equal(lines.length, 3);
		const joined = lines.join("\n");
		assert.ok(joined.includes("docs/specs/"));
		assert.ok(joined.includes("docs/wiki/"));
		assert.ok(joined.includes("docs/adr/"));
	});
});

describe("durable learning owner taxonomy", () => {
	it("defines the eight canonical routes in stable order", () => {
		assert.deepEqual(LEARNING_OWNER_IDS, [
			"skill",
			"hook",
			"command",
			"standard",
			"script",
			"workflow-pack",
			"loop-contract",
			"ci",
		]);
		assert.deepEqual(
			LEARNING_OWNER_ROUTES.map((route) => route.id),
			LEARNING_OWNER_IDS,
		);
		assert.ok(Object.isFrozen(LEARNING_OWNER_ROUTES));
		for (const route of LEARNING_OWNER_ROUTES) {
			assert.ok(Object.isFrozen(route), `${route.id} route must be immutable`);
			assert.match(route.decisionQuestion, /\?$/);
			assert.ok(route.responsibility.length > 20);
			assert.equal(getLearningOwner(route.id), route);
		}
	});

	it("keeps route boundaries distinct, including declarative non-execution surfaces", () => {
		const byId = Object.fromEntries(LEARNING_OWNER_ROUTES.map((route) => [route.id, route]));
		assert.match(byId.skill.responsibility, /instruction/i);
		assert.match(byId.hook.responsibility, /lifecycle|deterministic/i);
		assert.match(byId.command.responsibility, /entry/i);
		assert.match(byId.standard.responsibility, /review/i);
		assert.match(byId.script.responsibility, /deterministic/i);
		assert.match(byId["workflow-pack"].responsibility, /declarative/i);
		assert.match(byId["loop-contract"].responsibility, /trigger|cadence|state|review/i);
		assert.match(byId.ci.responsibility, /protected|PR|event/i);
		assert.match(byId["workflow-pack"].responsibility, /not|never|does not|without/i);
		assert.match(byId["loop-contract"].responsibility, /not|never|does not|without/i);
	});

	it("keeps the owner-routing wiki catalog in exact parity with the core taxonomy", () => {
		const wikiPath = path.join(__dirname, "..", "..", "docs", "wiki", "learning-owner-routing.md");
		const wiki = fs.readFileSync(wikiPath, "utf8");
		const block = wiki.match(
			/<!-- learning-owner-catalog:start -->\r?\n([\s\S]*?)\r?\n<!-- learning-owner-catalog:end -->/,
		);
		assert.ok(block, "wiki must contain the machine-checked owner catalog markers");

		const documentedRoutes = block[1]
			.split(/\r?\n/)
			.map((line) => line.match(/^\| `([^`]+)` \| (.+) \| (.+) \|$/))
			.filter(Boolean)
			.map((match) => ({
				id: match[1],
				decisionQuestion: match[2],
				responsibility: match[3],
			}));

		assert.deepEqual(documentedRoutes, LEARNING_OWNER_ROUTES);
	});
});

// ── Fixture synthesis ────────────────────────────────────────────────────────
//
// Enough on-disk state for buildContext to resolve a feature focus and for the
// lifecycle to reach the post-accept tail: scaffold (init done), a confirmed
// plan, evidence on the feature (feature-evidence done), a live handoff file
// (handoff done), and the plan logged in the evolution log (accept done).

function writeFeatureList(root, features) {
	fs.writeFileSync(
		path.join(root, "feature_list.json"),
		`${JSON.stringify({ features }, null, 2)}\n`,
	);
}

function writeScaffold(root) {
	for (const rel of REQUIRED_HARNESS_FILES) {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		if (!fs.existsSync(abs)) fs.writeFileSync(abs, "");
	}
	writeFeatureList(root, []);
	installTargetRoutes(root);
}

// A validator-clean feature entry (validateFeatureListData passes) — booking
// round-trips must keep feature_list.json valid against the repo's own rules.
function validFeature(id, over = {}) {
	return {
		id,
		area: "harness",
		title: `Feature ${id}`,
		user_visible_behavior: "behavior",
		status: "accepted",
		priority: 1,
		verification: ["node --test tests/unit/"],
		evidence: [{ date: "2026-08-15", command: "node --test", result: "pass" }],
		notes: [],
		...over,
	};
}

function writePlan(root, featureId, rel, { confirmed = true } = {}) {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(
		abs,
		[
			"# Plan",
			"",
			`Feature: ${featureId}`,
			...(confirmed ? ["User Confirmation: confirmed"] : []),
			"",
			"## Goal",
			"",
			"Goal text.",
			"",
		].join("\n"),
	);
	return rel;
}

function writeEvolutionLog(root, planRel) {
	const dir = path.join(root, "docs", "wiki", "engineering");
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "harness-evolution.md"),
		`# Harness Evolution\n\n- accepted ${planRel} on 2026-08-15\n`,
	);
}

function writeLiveHandoff(root) {
	fs.writeFileSync(
		path.join(root, "session-handoff.md"),
		[
			"# Session Handoff (regenerated from live state)",
			"",
			"## Summary",
			"",
			"Work verified and accepted; continuity regenerated.",
			"",
			"## Verification Evidence",
			"",
			"- node --test — Result: pass (exit 0)",
			"",
			"## Next Actions",
			"",
			"- continue",
			"",
		].join("\n"),
	);
}

// A repo whose feature focus sits exactly at the post-accept checkpoint: every
// earlier step done, accept logged, and the feature's booked paths carrying the
// given trigger shape. paths=null means a feature with no trigger paths.
function acceptedRepo(prefix, featureId, paths) {
	const root = makeRoot(prefix);
	writeScaffold(root);
	const planRel = `docs/plans/${featureId}-plan.md`;
	writePlan(root, featureId, planRel);
	writeLiveHandoff(root);
	writeEvolutionLog(root, planRel);
	writeFeatureList(root, [validFeature(featureId, { paths })]);
	return root;
}

// ── Lifecycle step gating ────────────────────────────────────────────────────

describe("lifecycle step gating (learnings step via the SSOT)", () => {
	it("an accepted feature with trigger paths gets the learnings step next (invariants 3, 5)", () => {
		const root = acceptedRepo("amber-learn-step-", "F023T", [
			"docs/specs/2026-08-15-thing.md",
			"src/index.js",
		]);
		const ctx = buildContext(root, { feature: "F023T" });
		const step = inferNextStep(ctx);
		assert.ok(step, "advisor must still advise after accept when triggers matched");
		assert.equal(step.id, "learnings");
		assert.ok(typeof step.label === "string" && step.label.length > 0, "label present");
		assert.match(step.remedy, /amber learnings/);
		assert.match(step.remedy, /--feature F023T/);
		assert.match(step.why, /contract/, "why names the matched category");
	});

	it("after booking, the learnings step is done and no longer advised", () => {
		const root = acceptedRepo("amber-learn-done-", "F023D", ["schemas/route.schema.json"]);
		bookLearningWriteBack(root, {
			featureId: "F023D",
			surfaces: ["docs/specs/f023d.md"],
			owner: "command",
		});
		const ctx = buildContext(root, { feature: "F023D" });
		const entry = evaluateLifecycle(ctx).find((s) => s.id === "learnings");
		assert.ok(entry, "step still applies (triggers matched)");
		assert.equal(entry.done, true, "booking is the only done-condition");
		assert.equal(inferNextStep(ctx), null, "advisor has nothing left to require");
	});

	it("a feature with no trigger paths never sees the learnings step, even accepted and unbooked", () => {
		const root = acceptedRepo("amber-learn-none-", "F023N", ["src/index.js", "lib/util.ts"]);
		const ctx = buildContext(root, { feature: "F023N" });
		assert.equal(
			evaluateLifecycle(ctx).some((s) => s.id === "learnings"),
			false,
			"no trigger matched → the step does not apply (no fake gate)",
		);
		assert.equal(inferNextStep(ctx), null, "nothing left to require for a trigger-free feature");
	});

	it("before accept, trigger paths alone do not surface the step", () => {
		const root = acceptedRepo("amber-learn-pre-", "F023P", ["k8s/deploy.yaml"]);
		// Remove the accept evidence: the plan is no longer logged as accepted.
		fs.rmSync(path.join(root, "docs", "wiki", "engineering", "harness-evolution.md"));
		const ctx = buildContext(root, { feature: "F023P" });
		assert.equal(
			evaluateLifecycle(ctx).some((s) => s.id === "learnings"),
			false,
			"learnings applies only after accept",
		);
		assert.equal(inferNextStep(ctx).id, "accept", "accept is still the next step");
	});
});

// ── Inspection (read-only) ───────────────────────────────────────────────────

describe("inspectLearningWriteBack", () => {
	it("explicit featureId, found + unreviewed: status unreviewed, text lists category and NOT-booked remedy", () => {
		const root = acceptedRepo("amber-learn-insp-", "F023I", ["docs/specs/2026-08-15-x.md"]);
		const r = inspectLearningWriteBack(root, { featureId: "F023I" });
		assert.deepEqual(r.errors, []);
		assert.deepEqual(r.warnings, []);
		assert.equal(r.featureFound, true);
		assert.equal(r.status, "unreviewed");
		assert.deepEqual(r.matchedCategories, ["contract"]);
		assert.match(r.text, /Trigger contract/);
		assert.match(r.text, /Review NOT booked/);
		assert.match(r.text, /amber learnings --feature F023I --reviewed --owner <id>/);
		assert.deepEqual(
			r.ownerCatalog.map((route) => route.id),
			LEARNING_OWNER_IDS,
		);
		assert.equal(r.ownerStatus, "unbooked");
	});

	it("booked feature: status reviewed and text shows the booked date", () => {
		const root = acceptedRepo("amber-learn-rev-", "F023R", ["docs/specs/2026-08-15-y.md"]);
		const booked = bookLearningWriteBack(root, {
			featureId: "F023R",
			surfaces: ["docs/specs/2026-08-15-y.md"],
			owner: "command",
		});
		assert.deepEqual(booked.errors, []);
		const r = inspectLearningWriteBack(root, { featureId: "F023R" });
		assert.equal(r.status, "reviewed");
		const date = r.learningWriteBack && r.learningWriteBack.date;
		assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
		assert.match(r.text, new RegExp(`Review booked ${date}`));
		assert.equal(r.owner, "command");
		assert.equal(r.ownerRoute.id, "command");
		assert.match(r.text, /Owner: command/);
		assert.match(r.text, /decision question/i);
		assert.doesNotMatch(r.text, /Review NOT booked/);
	});

	it("marks a reviewed ownerless record as legacy while keeping it reviewed", () => {
		const root = acceptedRepo("amber-learn-legacy-", "F023L", ["docs/specs/legacy.md"]);
		const feature = readFeatures(root).features[0];
		feature.learningWriteBack = {
			reviewed: true,
			date: "2026-08-14",
			surfaces: ["docs/specs/legacy.md"],
		};
		writeFeatureList(root, [feature]);

		const r = inspectLearningWriteBack(root, { featureId: "F023L" });
		assert.equal(r.status, "reviewed");
		assert.equal(r.ownerStatus, "legacy");
		assert.equal(r.owner, null);
		assert.match(r.text, /legacy/i);
		assert.equal(inferNextStep(buildContext(root, { feature: "F023L" })), null);
		assert.deepEqual(validateFeatureListData(readFeatures(root)).errors, []);
	});

	it("nonexistent featureId: featureFound false, visible text, no errors", () => {
		const root = acceptedRepo("amber-learn-miss-", "F023M", ["Dockerfile"]);
		const r = inspectLearningWriteBack(root, { featureId: "F404" });
		assert.deepEqual(r.errors, [], "a missing feature is visible text, never an error");
		assert.equal(r.featureFound, false);
		assert.equal(r.status, "not-found");
		assert.match(r.text, /F404/);
	});

	it("no featureId and no resolvable focus: visible no-focus text, no errors", () => {
		const root = makeRoot("amber-learn-nofocus-");
		fs.writeFileSync(path.join(root, "README.md"), "# empty target\n");
		const r = inspectLearningWriteBack(root, {});
		assert.deepEqual(r.errors, []);
		assert.equal(r.featureId, null);
		assert.equal(r.featureFound, false);
		assert.equal(r.status, "no-focus");
		assert.match(r.text, /--feature/);
	});

	it("degrades visibly for not-accepted and no-trigger features", () => {
		const notAccepted = makeRoot("amber-learn-preacc-");
		writePlan(notAccepted, "F023A", "docs/plans/F023A-plan.md");
		writeFeatureList(notAccepted, [validFeature("F023A", { paths: ["Dockerfile"] })]);
		const a = inspectLearningWriteBack(notAccepted, { featureId: "F023A" });
		assert.deepEqual(a.errors, []);
		assert.equal(a.status, "not-accepted");
		assert.match(a.text, /not accepted yet/);

		const noTriggers = acceptedRepo("amber-learn-notrig-", "F023B", ["src/index.js"]);
		const b = inspectLearningWriteBack(noTriggers, { featureId: "F023B" });
		assert.deepEqual(b.errors, []);
		assert.equal(b.status, "no-triggers");
		assert.match(b.text, /No mandatory write-back triggers/);
	});

	it("inspection writes nothing (invariant 2)", () => {
		const root = acceptedRepo("amber-learn-ro-", "F023O", ["infra/queue.ts"]);
		const before = fs.readFileSync(path.join(root, "feature_list.json"), "utf8");
		const r = inspectLearningWriteBack(root, { featureId: "F023O" });
		assert.deepEqual(r.errors, []);
		assert.equal(
			fs.readFileSync(path.join(root, "feature_list.json"), "utf8"),
			before,
			"inspect must not write feature_list.json",
		);
	});
});

// ── Booking round-trip ───────────────────────────────────────────────────────

function readFeatures(root) {
	return JSON.parse(fs.readFileSync(path.join(root, "feature_list.json"), "utf8"));
}

describe("bookLearningWriteBack", () => {
	it("books {reviewed, date, surfaces} onto the named entry only; other entries untouched", () => {
		const root = makeRoot("amber-learn-book-");
		writeFeatureList(root, [
			validFeature("F900", { paths: ["schemas/route.schema.json", "src/a.js"] }),
			validFeature("F901", { paths: ["src/b.js"] }),
		]);
		const r = bookLearningWriteBack(root, {
			featureId: "F900",
			surfaces: ["docs/specs/f900.md", "docs/wiki/gotchas.md"],
			owner: "command",
		});
		assert.deepEqual(r.errors, []);
		assert.deepEqual(r.warnings, []);

		const data = readFeatures(root);
		const booked = data.features.find((f) => f.id === "F900");
		assert.equal(booked.learningWriteBack.reviewed, true);
		assert.match(booked.learningWriteBack.date, /^\d{4}-\d{2}-\d{2}$/);
		assert.deepEqual(booked.learningWriteBack.surfaces, [
			"docs/specs/f900.md",
			"docs/wiki/gotchas.md",
		]);
		assert.equal(booked.learningWriteBack.owner, "command");
		// Everything else about the booked entry survives.
		const { learningWriteBack: _learningWriteBack, ...rest } = booked;
		assert.deepEqual(
			rest,
			validFeature("F900", { paths: ["schemas/route.schema.json", "src/a.js"] }),
		);
		// The other entry is untouched, deep-equal.
		assert.deepEqual(
			data.features.find((f) => f.id === "F901"),
			validFeature("F901", { paths: ["src/b.js"] }),
		);
	});

	it("keeps feature_list.json valid under the repo's own validator after booking", () => {
		const root = makeRoot("amber-learn-valid-");
		writeFeatureList(root, [validFeature("F900", { paths: ["docs/specs/a.md"] })]);
		assert.deepEqual(
			validateFeatureListData(readFeatures(root)).errors,
			[],
			"fixture starts valid",
		);
		bookLearningWriteBack(root, {
			featureId: "F900",
			surfaces: ["docs/specs/a.md"],
			owner: "standard",
		});
		const { errors } = validateFeatureListData(readFeatures(root));
		assert.deepEqual(errors, [], "booking must not break validate-feature-list rules");
	});

	it("re-booking is an explicit overwrite of date/surfaces", () => {
		const root = makeRoot("amber-learn-rebook-");
		writeFeatureList(root, [validFeature("F900", { paths: ["Dockerfile"] })]);
		bookLearningWriteBack(root, {
			featureId: "F900",
			surfaces: ["docs/specs/first.md"],
			owner: "command",
		});
		const r = bookLearningWriteBack(root, {
			featureId: "F900",
			surfaces: ["docs/specs/second.md"],
			owner: "hook",
		});
		assert.deepEqual(r.errors, []);
		assert.match(r.text, /previous booking overwritten/);
		const booked = readFeatures(root).features[0].learningWriteBack;
		assert.equal(booked.reviewed, true);
		assert.deepEqual(booked.surfaces, ["docs/specs/second.md"], "surfaces replaced, not merged");
		assert.equal(booked.owner, "hook", "owner is replaced on re-booking");
	});

	for (const [label, options, expected] of [
		[
			"missing owner",
			{ featureId: "F900", surfaces: ["docs/specs/x.md"] },
			/ requires exactly one explicit --owner/,
		],
		[
			"unknown owner",
			{ featureId: "F900", surfaces: ["docs/specs/x.md"], owner: "rule" },
			/Unknown learning owner.*skill, hook, command, standard, script, workflow-pack, loop-contract, ci/,
		],
		[
			"comma-combined owner",
			{ featureId: "F900", surfaces: ["docs/specs/x.md"], owner: "command,hook" },
			/comma-separated values are not allowed/,
		],
		[
			"repeated owner",
			{
				featureId: "F900",
				surfaces: ["docs/specs/x.md"],
				owners: ["command", "hook"],
				owner: "hook",
			},
			/requires exactly one explicit --owner.*repeated/,
		],
	]) {
		it(`${label} fails before mutation`, () => {
			const root = makeRoot(`amber-learn-owner-${label.replace(/\W+/g, "-")}-`);
			writeFeatureList(root, [validFeature("F900", { paths: ["Dockerfile"] })]);
			const before = fs.readFileSync(path.join(root, "feature_list.json"), "utf8");
			const r = bookLearningWriteBack(root, options);
			assert.ok(r.errors.length > 0);
			assert.match(r.errors.join("\n"), expected);
			assert.equal(fs.readFileSync(path.join(root, "feature_list.json"), "utf8"), before);
		});
	}

	it("missing featureId errors and writes nothing (never books an auto-resolved feature)", () => {
		const root = makeRoot("amber-learn-noid-");
		writeFeatureList(root, [validFeature("F900", { paths: ["Dockerfile"] })]);
		const before = fs.readFileSync(path.join(root, "feature_list.json"), "utf8");
		const r = bookLearningWriteBack(root, { surfaces: ["docs/specs/x.md"] });
		assert.ok(r.errors.length > 0);
		assert.match(r.errors.join("\n"), /requires --feature/);
		assert.match(r.errors.join("\n"), /never books an auto-resolved/);
		assert.equal(fs.readFileSync(path.join(root, "feature_list.json"), "utf8"), before);
	});

	it("nonexistent feature errors and leaves the file byte-identical", () => {
		const root = makeRoot("amber-learn-ghost-");
		writeFeatureList(root, [validFeature("F900", { paths: ["Dockerfile"] })]);
		const before = fs.readFileSync(path.join(root, "feature_list.json"), "utf8");
		const r = bookLearningWriteBack(root, {
			featureId: "F404",
			surfaces: ["docs/specs/x.md"],
			owner: "command",
		});
		assert.ok(r.errors.length > 0);
		assert.match(r.errors.join("\n"), /F404/);
		assert.equal(fs.readFileSync(path.join(root, "feature_list.json"), "utf8"), before);
	});
});

// ── CLI end-to-end ───────────────────────────────────────────────────────────

const CLI = path.join(__dirname, "..", "..", "scripts", "amber.js");

function runCli(args) {
	return spawnSync(process.execPath, [CLI, ...args], {
		cwd: __dirname,
		encoding: "utf8",
		env: { ...process.env },
	});
}

describe("amber learnings (CLI)", () => {
	it("inspect renders the trigger and the NOT-booked remedy, exit 0", () => {
		const root = acceptedRepo("amber-learn-cli-", "F023C", ["docs/specs/2026-08-15-cli.md"]);
		const r = runCli(["learnings", "--target", root, "--feature", "F023C"]);
		assert.equal(r.status, 0, `stderr: ${r.stderr}`);
		assert.match(r.stdout, /Trigger contract/);
		assert.match(r.stdout, /Review NOT booked/);
		assert.match(r.stdout, /amber learnings --feature F023C --reviewed/);
	});

	it("--reviewed without --feature exits 1 with the never-book-auto-resolved error", () => {
		const root = acceptedRepo("amber-learn-clinofx-", "F023X", ["Dockerfile"]);
		const before = fs.readFileSync(path.join(root, "feature_list.json"), "utf8");
		const r = runCli(["learnings", "--target", root, "--reviewed"]);
		assert.equal(r.status, 1);
		assert.match(r.stdout, /requires --feature/);
		assert.match(r.stdout, /never books an auto-resolved feature/);
		assert.equal(fs.readFileSync(path.join(root, "feature_list.json"), "utf8"), before);
	});

	it("repeatable --surface flags and comma-separated values both book every surface", () => {
		const root = acceptedRepo("amber-learn-clisurf-", "F023S", ["schemas/a.schema.json"]);
		const r = runCli([
			"learnings",
			"--target",
			root,
			"--feature",
			"F023S",
			"--reviewed",
			"--owner",
			"command",
			"--surface",
			"docs/specs/f023s.md",
			"--surface",
			"docs/wiki/notes.md",
		]);
		assert.equal(r.status, 0, `stderr: ${r.stderr}`);
		assert.deepEqual(readFeatures(root).features[0].learningWriteBack.surfaces, [
			"docs/specs/f023s.md",
			"docs/wiki/notes.md",
		]);

		const comma = acceptedRepo("amber-learn-clicomma-", "F023U", ["schemas/a.schema.json"]);
		const rc = runCli([
			"learnings",
			"--target",
			comma,
			"--feature",
			"F023U",
			"--reviewed",
			"--owner",
			"command",
			"--surface",
			"docs/specs/one.md, docs/wiki/two.md",
		]);
		assert.equal(rc.status, 0, `stderr: ${rc.stderr}`);
		assert.deepEqual(readFeatures(comma).features[0].learningWriteBack.surfaces, [
			"docs/specs/one.md",
			"docs/wiki/two.md",
		]);
	});

	it("--json emits a machine-readable envelope with the expected fields", () => {
		const root = acceptedRepo("amber-learn-clijson-", "F023J", ["infra/queue.ts"]);
		const r = runCli(["learnings", "--target", root, "--feature", "F023J", "--json"]);
		assert.equal(r.status, 0, `stderr: ${r.stderr}`);
		const envelope = JSON.parse(r.stdout);
		assert.equal(envelope.featureId, "F023J");
		assert.equal(envelope.featureFound, true);
		assert.equal(envelope.status, "unreviewed");
		assert.deepEqual(envelope.matchedCategories, ["infra"]);
		assert.ok(Array.isArray(envelope.triggered) && envelope.triggered.length === 1);
		assert.deepEqual(envelope.errors, []);
	});

	it("booking through the CLI clears the checkpoint (advisor goes quiet)", () => {
		const root = acceptedRepo("amber-learn-clifin-", "F023F", ["docs/specs/f.md"]);
		const r = runCli([
			"learnings",
			"--target",
			root,
			"--feature",
			"F023F",
			"--reviewed",
			"--owner",
			"command",
		]);
		assert.equal(r.status, 0, `stderr: ${r.stderr}`);
		assert.match(r.stdout, /Learning review booked for feature: F023F/);
		assert.equal(inferNextStep(buildContext(root, { feature: "F023F" })), null);
	});
});

// ── Handoff section ──────────────────────────────────────────────────────────

describe("handoff Learning write-back section", () => {
	it("renders when the focus feature is accepted + triggered + unbooked, naming feature and remedy", () => {
		const root = acceptedRepo("amber-learn-handoff-", "F023H", ["docs/specs/2026-08-15-h.md"]);
		const text = renderHandoff(root);
		assert.match(text, /## Learning write-back/);
		assert.match(text, /F023H/);
		assert.match(text, /contract/);
		assert.match(text, /--reviewed/);
		// writeHandoff persists the same section into session-handoff.md.
		const { changed } = writeHandoff(root);
		assert.equal(changed, true);
		assert.match(
			fs.readFileSync(path.join(root, "session-handoff.md"), "utf8"),
			/## Learning write-back/,
		);
	});

	it("is absent once the review is booked", () => {
		const root = acceptedRepo("amber-learn-handoff2-", "F023G", ["docs/specs/2026-08-15-g.md"]);
		bookLearningWriteBack(root, {
			featureId: "F023G",
			surfaces: ["docs/specs/2026-08-15-g.md"],
			owner: "command",
		});
		const text = renderHandoff(root);
		assert.doesNotMatch(text, /Learning write-back/, "booked review silences the reminder");
	});
});

// saveFeatures writes the Prettier JSON format this repo enforces, so a
// booking produces a one-field diff instead of a whole-file reformat and the
// file stays clean under format:check (review finding on F023). Guarded by
// spawning the real prettier on the booked fixture.
it("booking keeps feature_list.json Prettier-clean (format:check contract)", () => {
	const dir = acceptedRepo("amber-learn-fmt-", "FMT1", ["docs/specs/contract.md"]);
	const r = bookLearningWriteBack(dir, {
		featureId: "FMT1",
		surfaces: ["docs/specs/contract.md"],
		owner: "command",
	});
	assert.deepEqual(r.errors, []);

	const listPath = path.join(dir, "feature_list.json");
	const after = fs.readFileSync(listPath, "utf8");
	assert.ok(after.endsWith("\n"), "trailing newline kept");
	const reparsed = JSON.parse(after);
	assert.equal(
		reparsed.features[0].learningWriteBack.reviewed,
		true,
		"data intact through the format",
	);

	// The repo's CI contract is prettier --check on JSON files; run it for real.
	const prettier = require("node:child_process").spawnSync(
		process.execPath,
		[require.resolve("prettier/bin/prettier.cjs"), "--check", listPath.split(path.sep).join("/")],
		{ encoding: "utf8", cwd: path.join(__dirname, "..", "..") },
	);
	assert.equal(
		prettier.status,
		0,
		`booked file must be Prettier-clean: ${prettier.stdout}${prettier.stderr}`,
	);
	fs.rmSync(dir, { recursive: true, force: true });
});
