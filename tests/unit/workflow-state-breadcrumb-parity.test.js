"use strict";

// Parity suite for the F022 per-turn workflow-state breadcrumb.
//
// The contract under test: every lifecycle step that the governance docs
// require must be visible through the per-turn injection channel, with the
// exact label and remedy the lifecycle advisor (`amber next`) would emit.
// The breadcrumb derives its Next step from buildContext + inferNextStep in
// scripts/lib/core/lifecycle.js, which read plain on-disk state — so the test
// builds one temp repo and walks it through the whole lifecycle by
// synthesizing each checkpoint's on-disk state, rendering the breadcrumb at
// every checkpoint, and asserting the expected step is what got rendered.

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { printBreadcrumb } = require("../../scripts/lib/hooks-command");
const { buildContext, inferNextStep, STEPS } = require("../../scripts/lib/core/lifecycle");
const { REQUIRED_HARNESS_FILES } = require("../../scripts/lib/core/constants");
const { appendSessionEvent } = require("../../scripts/lib/session-timeline");
const { installTargetRoutes } = require("../helpers/target-routes");

const BLOCK_OPEN = "<amber-workflow-state>";
const BLOCK_CLOSE = "</amber-workflow-state>";
const SESSION_ID = "9f0c1a2b-3c4d-5e6f-8a9b-0c1d2e3f4a5b";
const PLAN_REL = "docs/plans/F022-breadcrumb.md";

const roots = [];

function makeRoot(prefix) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	roots.push(dir);
	return dir;
}

after(() => {
	for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
});

// ── Fixture synthesis (each helper writes exactly what the lifecycle reads) ──

function writeFeatureList(root, features) {
	fs.writeFileSync(
		path.join(root, "feature_list.json"),
		`${JSON.stringify({ features }, null, 2)}\n`,
	);
}

// Install every REQUIRED_HARNESS_FILES entry so `init` counts as done, then
// repair the two entries that must carry real content: feature_list.json
// (parseable) and the route files (validatable, via the product templates).
function writeScaffold(root) {
	for (const rel of REQUIRED_HARNESS_FILES) {
		const abs = path.join(root, rel);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		if (!fs.existsSync(abs)) fs.writeFileSync(abs, "");
	}
	writeFeatureList(root, []);
	installTargetRoutes(root);
}

function writePlan(root, { confirmed = false, featureId = "F022" } = {}) {
	fs.mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
	const lines = [
		"# Plan: per-turn workflow-state breadcrumb",
		"",
		`Feature: ${featureId}`,
		...(confirmed ? ["User Confirmation: confirmed"] : []),
		"",
		"## Goal",
		"",
		"Surface the Amber focus and required next step on every agent turn.",
		"",
	];
	fs.writeFileSync(path.join(root, PLAN_REL), lines.join("\n"));
}

// A manifest the lifecycle readers accept: parseable JSON with the fields
// buildContext / resolvePendingGate / evaluateCompletion consume.
function writeSessionManifest(root, overrides = {}) {
	const manifest = {
		sessionId: SESSION_ID,
		schemaVersion: "1.0.0",
		createdAt: "2026-08-15T00:00:00.000Z",
		updatedAt: "2026-08-15T00:00:00.000Z",
		route: { id: "feature-standard" },
		goal: "Ship the per-turn workflow-state breadcrumb",
		status: "executing",
		completedStages: ["capture", "plan"],
		feature: "F022",
		...overrides,
	};
	const dir = path.join(root, ".amber", "sessions", SESSION_ID);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	return dir;
}

// session-handoff.md content that isLiveHandoff accepts: none of the scaffold
// fingerprints (no "scaffolded" banner, no "not run yet", no pending Result).
function writeLiveHandoff(root) {
	fs.writeFileSync(
		path.join(root, "session-handoff.md"),
		[
			"# Session Handoff (regenerated from live state)",
			"",
			"## Summary",
			"",
			"F022 verified, approved, and marked completed; continuity regenerated.",
			"",
			"## Verification Evidence",
			"",
			"- npm test — Result: pass (exit 0)",
			"",
			"## Next Actions",
			"",
			"- accept the F022 plan",
			"",
		].join("\n"),
	);
}

function writeEvolutionLog(root) {
	const evoDir = path.join(root, "docs", "wiki", "engineering");
	fs.mkdirSync(evoDir, { recursive: true });
	fs.writeFileSync(
		path.join(evoDir, "harness-evolution.md"),
		`# Harness Evolution\n\n- accepted ${PLAN_REL} on 2026-08-15\n`,
	);
}

// ── Eligible-step derivation ─────────────────────────────────────────────────
//
// A step can only be advised by inferNextStep if some context leaves its
// isDone false. Probe three deliberately distinct contexts (empty bootstrap,
// maximally-advanced feature, mid-flight session): a step whose isDone returns
// true for ALL probes is constant-true — advisory-only, never the next step
// (today exactly `audit`, per its comment in lifecycle.js).
//
// GUARD: adding a new lifecycle step requires extending the walk below — add a
// checkpoint that reaches it, or consciously document it as advisory here.
// The final coverage assertion fails otherwise.

function probeContexts() {
	const plan = {
		path: PLAN_REL,
		featureId: "F022",
		confirmed: true,
		mtimeMs: 1,
	};
	const feature = {
		id: "F022",
		status: "passing",
		evidence: [{ date: "2026-08-15", command: "npm test", result: "pass" }],
	};
	const state = (over = {}) => ({
		targetRoot: "/probe-root",
		amberInstalled: false,
		isProductRepo: false,
		featureCorrupt: false,
		features: [],
		plans: [],
		activeSessionId: null,
		existingProject: false,
		verifyCommand: null,
		...over,
	});
	return [
		{
			// Empty repo, no focus target.
			state: state(),
			focus: { type: "bootstrap", id: null, autoSelected: true, othersPending: 0 },
			completion: null,
			sessionStatus: null,
			liveHandoff: false,
			pendingGateId: null,
			sessionGates: [],
			targetDisplay: ".",
		},
		{
			// Feature focus with every feature-side artefact present.
			state: state({
				amberInstalled: true,
				features: [feature],
				plans: [plan],
				activeSessionId: SESSION_ID,
				existingProject: true,
			}),
			focus: { type: "feature", id: "F022", autoSelected: true, othersPending: 0 },
			completion: null,
			sessionStatus: null,
			liveHandoff: true,
			pendingGateId: null,
			sessionGates: [],
			targetDisplay: ".",
		},
		{
			// Session focus mid-flight: verification/approval/handoff missing.
			state: state({
				amberInstalled: true,
				features: [feature],
				plans: [plan],
				activeSessionId: SESSION_ID,
			}),
			focus: { type: "session", id: SESSION_ID, autoSelected: true, othersPending: 0 },
			completion: { status: "fail", reasons: [], missing: ["verification", "approval", "handoff"] },
			sessionStatus: "executing",
			liveHandoff: false,
			pendingGateId: "user-approval-plan",
			sessionGates: [{ id: "user-approval-plan" }, { id: "user-approval-implement" }],
			targetDisplay: ".",
		},
	];
}

const ELIGIBLE_STEP_IDS = STEPS.filter(
	(step) => !probeContexts().every((ctx) => step.isDone(ctx) === true),
).map((step) => step.id);

// Every checkpoint recorded by the walk; the closing test asserts this equals
// the eligible set exactly. Populated in test-declaration order (node:test runs
// the tests in this file sequentially).
const covered = new Set();

// ── Checkpoint renderer ──────────────────────────────────────────────────────

// Render the breadcrumb at one checkpoint and prove three things at once:
//  1. the advisor (amber-next inference, computed independently here) says
//     `expectedId` is next — the fixture is the checkpoint we think it is;
//  2. the breadcrumb emits that step's label and remedy command verbatim;
//  3. the exit shape is clean (a context hook never blocks a turn).
function expectStep(root, expectedId) {
	// Same inputs as the renderer: printBreadcrumb threads the operator's
	// --target into buildContext, so the advisor is computed identically.
	const ctx = buildContext(root, { target: root });
	const advisor = inferNextStep(ctx);
	assert.ok(advisor, `advisor should still advise a step (wanted "${expectedId}")`);
	assert.equal(
		advisor.id,
		expectedId,
		`fixture should sit at checkpoint "${expectedId}" before rendering`,
	);
	const r = printBreadcrumb(root, { format: "text" });
	assert.deepEqual(r.errors, [], `breadcrumb print must not error at "${expectedId}"`);
	assert.deepEqual(r.warnings, []);
	const block = r.text;
	assert.ok(block.startsWith(BLOCK_OPEN), "text format emits the bare block");
	assert.ok(block.endsWith(BLOCK_CLOSE), "block is closed");
	assert.ok(
		block.includes(`Next step: ${advisor.label}`),
		`block shows the advisor's label for "${expectedId}"`,
	);
	assert.ok(
		block.includes(`Run: ${advisor.remedy}`),
		`block shows the advisor's remedy for "${expectedId}"`,
	);
	covered.add(expectedId);
	return { block, advisor };
}

// The same parity in the JSON (hook envelope) format: the additionalContext
// block carries the same Next step line the text format renders.
function expectJsonStep(root, expectedLine) {
	const r = printBreadcrumb(root, { format: "json" });
	assert.deepEqual(r.errors, []);
	const envelope = JSON.parse(r.text);
	assert.equal(envelope.hookSpecificOutput.hookEventName, "UserPromptSubmit");
	const context = envelope.hookSpecificOutput.additionalContext;
	assert.ok(context.includes(BLOCK_OPEN) && context.includes(BLOCK_CLOSE));
	assert.ok(
		context.includes(expectedLine),
		`JSON envelope's additionalContext carries the same line: ${expectedLine}`,
	);
}

// ── The walk ─────────────────────────────────────────────────────────────────

describe("workflow-state breadcrumb lifecycle parity (F022)", () => {
	it("walks one repo through the lifecycle; every checkpoint renders through the per-turn channel", () => {
		const root = makeRoot("amber-crumb-walk-");

		// 1. Bare existing project → init.
		fs.writeFileSync(path.join(root, "README.md"), "# target\n");
		const cp1 = expectStep(root, "init");
		assert.match(cp1.block, /Focus: project bootstrap/);
		expectJsonStep(root, `Next step: ${cp1.advisor.label}`);

		// 2. Scaffold + one registered feature, no plan yet → plan.
		writeScaffold(root);
		writeFeatureList(root, [
			{ id: "F022", title: "Breadcrumb", status: "not_started", evidence: [] },
		]);
		expectStep(root, "plan");

		// 3. Plan drafted, unconfirmed → gate.
		writePlan(root);
		expectStep(root, "gate");

		// 4. Plan confirmed, no verification evidence yet → feature-evidence.
		writePlan(root, { confirmed: true });
		expectStep(root, "feature-evidence");

		// 5. Session active (manifest + timeline, nothing executed) → verify.
		const sessionDir = writeSessionManifest(root);
		appendSessionEvent(sessionDir, {
			type: "session_created",
			data: { routeId: "feature-standard" },
		});
		const cp5 = expectStep(root, "verify");
		assert.match(
			cp5.block,
			new RegExp(`Focus: session ${SESSION_ID.slice(0, 8)} \\(auto-selected\\)`),
		);
		assert.match(cp5.block, /Session: executing \| route feature-standard/);
		assert.match(cp5.block, /Stages done: capture, plan/);
		assert.match(cp5.block, /Pending gates: 2 \(next: user-approval-plan\)/);

		// 6. Verification evidence executed (strict) + feature evidence → approve;
		//    the pending gate id must be visible in the emitted block.
		appendSessionEvent(sessionDir, {
			type: "stage_completed",
			stage: "verify",
			data: { executed: true, command: "npm test", exitCode: 0 },
		});
		writeFeatureList(root, [
			{
				id: "F022",
				title: "Breadcrumb",
				status: "passing",
				evidence: [{ date: "2026-08-15", command: "npm test", result: "pass" }],
			},
		]);
		const cp6 = expectStep(root, "approve");
		assert.match(cp6.block, /Pending gates: 2 \(next: user-approval-plan\)/);
		assert.match(cp6.advisor.remedy, /--gate user-approval-plan/);
		assert.ok(cp6.block.includes("user-approval-plan"), "gate id appears in the block");
		expectJsonStep(root, `Next step: ${cp6.advisor.label}`);

		// 7. All route gates passed in the timeline, handoff still the scaffold,
		//    plus an open blocker so completion cannot pass yet → handoff.
		for (const gateId of ["user-approval-plan", "user-approval-implement"]) {
			appendSessionEvent(sessionDir, { type: "gate_passed", data: { gateId } });
		}
		writeSessionManifest(root, {
			blockers: [{ id: "B1", description: "operator review pending", status: "open" }],
		});
		expectStep(root, "handoff");

		// 8. Live (non-scaffold) handoff, blocker still open → complete-check.
		//    (resolvePendingGate names gates[0] as "next" even with none pending.)
		writeLiveHandoff(root);
		const cp8 = expectStep(root, "complete-check");
		assert.match(cp8.block, /Pending gates: 0/);

		// 9. Blocker resolved → completion passes → session-complete.
		writeSessionManifest(root, {
			blockers: [{ id: "B1", description: "operator review pending", status: "resolved" }],
		});
		expectStep(root, "session-complete");

		// 10. Manifest marked completed → focus falls back to the feature → accept.
		writeSessionManifest(root, { status: "completed" });
		const cp10 = expectStep(root, "accept");
		assert.match(cp10.block, /Focus: feature F022 \(auto-selected\)/);

		// 11. Accept logged in the evolution log, and the accepted feature's booked
		//     paths include a docs/specs/** contract doc → the F023 post-accept
		//     learning write-back checkpoint renders through the per-turn channel.
		writeEvolutionLog(root);
		writeFeatureList(root, [
			{
				id: "F022",
				title: "Breadcrumb",
				status: "passing",
				evidence: [{ date: "2026-08-15", command: "npm test", result: "pass" }],
				paths: ["docs/specs/2026-08-15-workflow-state-breadcrumb.md"],
			},
		]);
		const cp11 = expectStep(root, "learnings");
		assert.match(cp11.advisor.remedy, /--feature F022/);
		assert.match(cp11.advisor.why, /contract/);

		// 12. Learning review booked on the feature entry (learningWriteBack written
		//     into feature_list.json directly, exactly what `amber learnings
		//     --reviewed` records) → terminal state: the channel renders "all
		//     lifecycle steps complete" instead of a next step.
		writeFeatureList(root, [
			{
				id: "F022",
				title: "Breadcrumb",
				status: "passing",
				evidence: [{ date: "2026-08-15", command: "npm test", result: "pass" }],
				paths: ["docs/specs/2026-08-15-workflow-state-breadcrumb.md"],
				learningWriteBack: {
					reviewed: true,
					date: "2026-08-15",
					surfaces: ["docs/specs/2026-08-15-workflow-state-breadcrumb.md"],
				},
			},
		]);
		const advisor = inferNextStep(buildContext(root));
		assert.equal(advisor, null, "advisor has nothing left to require");
		const r = printBreadcrumb(root, { format: "text" });
		assert.deepEqual(r.errors, []);
		assert.deepEqual(r.warnings, []);
		assert.match(r.text, /Next step: none — all lifecycle steps complete for this focus\./);
		expectJsonStep(root, "Next step: none — all lifecycle steps complete for this focus.");
	});

	it("reaches the 'feature' step: a plan naming an unregistered feature id", () => {
		const root = makeRoot("amber-crumb-feature-");
		// Scaffold with an EMPTY feature list, but a plan on disk naming F777 —
		// resolveFocus follows the plan, and with zero registered features the
		// advisor must demand feature registration through the channel.
		writeScaffold(root);
		writePlan(root, { featureId: "F777" });
		const cp = expectStep(root, "feature");
		assert.match(cp.block, /Focus: feature F777 \(auto-selected\)/);
	});

	it("covers exactly the eligible lifecycle steps (guard: a new STEPS entry must extend the walk)", () => {
		assert.deepEqual(
			[...covered].sort(),
			[...ELIGIBLE_STEP_IDS].sort(),
			`walk covered [${[...covered].sort().join(", ")}] but eligible steps are ` +
				`[${ELIGIBLE_STEP_IDS.sort().join(", ")}] — extend the walk (or document the ` +
				`step as advisory) when adding a lifecycle step`,
		);
		// The only excluded id must be the advisory one(s): constant-true isDone.
		const excluded = STEPS.map((s) => s.id).filter((id) => !ELIGIBLE_STEP_IDS.includes(id));
		assert.deepEqual(excluded, ["audit"], "only the advisory audit step may be unreachable");
	});
});
