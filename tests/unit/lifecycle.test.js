"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	gatherState,
	buildContext,
	inferNextStep,
	remedyFor,
} = require("../../scripts/lib/core/lifecycle");

function tmpRepo() {
	return fs.mkdtempSync(path.join(os.tmpdir(), "amber-lifecycle-"));
}

function writeFeatureList(dir, features) {
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({ features }, null, 2) + "\n",
	);
}

function writePlan(dir, name, body) {
	const plansDir = path.join(dir, "docs", "plans");
	fs.mkdirSync(plansDir, { recursive: true });
	fs.writeFileSync(path.join(plansDir, name), body);
}

describe("gatherState", () => {
	it("returns empty, non-installed state for a bare directory", () => {
		const dir = tmpRepo();
		const state = gatherState(dir);
		assert.equal(state.amberInstalled, false);
		assert.deepEqual(state.features, []);
		assert.deepEqual(state.plans, []);
		assert.equal(state.activeSessionId, null);
	});

	it("reads features and parses plan Feature + User Confirmation lines", () => {
		const dir = tmpRepo();
		writeFeatureList(dir, [{ id: "F001", title: "Login", status: "not_started", evidence: [] }]);
		writePlan(dir, "F001-login.md", "Feature: F001\nStatus: implementation-ready\nUser Confirmation: confirmed\n");
		const state = gatherState(dir);
		assert.equal(state.features.length, 1);
		assert.equal(state.plans.length, 1);
		assert.equal(state.plans[0].featureId, "F001");
		assert.equal(state.plans[0].confirmed, true);
	});

	it("treats a pending plan as not confirmed", () => {
		const dir = tmpRepo();
		writePlan(dir, "F002-charge.md", "Feature: F002\nUser Confirmation: pending\n");
		const state = gatherState(dir);
		assert.equal(state.plans[0].featureId, "F002");
		assert.equal(state.plans[0].confirmed, false);
	});

	it("tolerates a corrupt feature_list.json without throwing", () => {
		const dir = tmpRepo();
		fs.writeFileSync(path.join(dir, "feature_list.json"), "{ not json");
		const state = gatherState(dir);
		assert.equal(state.featureCorrupt, true);
		assert.deepEqual(state.features, []);
	});

	it("detects an active session (regression guard for the findMostRecentSession export)", () => {
		const dir = tmpRepo();
		const sessDir = path.join(dir, ".amber", "sessions", "sess-1");
		fs.mkdirSync(sessDir, { recursive: true });
		fs.writeFileSync(
			path.join(sessDir, "manifest.json"),
			JSON.stringify({
				sessionId: "sess-1",
				status: "active",
				goal: "demo",
				route: { id: "feature-standard" },
				created: "2026-06-27T00:00:00.000Z",
			}),
		);
		const state = gatherState(dir);
		assert.equal(state.activeSessionId, "sess-1");
	});
});

// Build a synthetic context so step logic is tested deterministically without
// touching disk for the 17 required-harness files.
function ctxOf(stateOverrides, focusOverrides) {
	return {
		state: {
			targetRoot: ".",
			amberInstalled: true,
			featureCorrupt: false,
			features: [],
			plans: [],
			activeSessionId: null,
			...stateOverrides,
		},
		focus: { type: "feature", id: "F001", autoSelected: false, othersPending: 0, ...focusOverrides },
		completion: null,
		sessionStatus: null,
		// Default true so feature-path accept tests are not blocked by handoff step.
		liveHandoff: true,
		targetDisplay: ".",
	};
}

describe("inferNextStep (synthetic ctx)", () => {
	it("recommends init when amber is not installed on a bare bootstrap", () => {
		const step = inferNextStep(
			ctxOf(
				{ amberInstalled: false, existingProject: false, auditSeen: false },
				{ type: "bootstrap", id: null },
			),
		);
		assert.equal(step.id, "init");
		assert.match(step.remedy, /^amber init --target \./);
	});

	it("recommends audit before init on an existing unharnessed project (A1)", () => {
		const step = inferNextStep(
			ctxOf(
				{ amberInstalled: false, existingProject: true, auditSeen: false },
				{ type: "bootstrap", id: null },
			),
		);
		assert.equal(step.id, "audit");
		assert.match(step.remedy, /^amber audit --target \./);
	});

	it("recommends init after audit stamp on an existing project (A1)", () => {
		const step = inferNextStep(
			ctxOf(
				{ amberInstalled: false, existingProject: true, auditSeen: true },
				{ type: "bootstrap", id: null },
			),
		);
		assert.equal(step.id, "init");
	});

	it("approve remedy uses concrete pending gate id (N2)", () => {
		const base = {
			...ctxOf({}, { type: "session", id: "sess-1" }),
			liveHandoff: false,
			sessionStatus: "executing",
			pendingGateId: "user-approval-implement",
			sessionGates: [
				{ id: "user-approval-plan" },
				{ id: "user-approval-implement" },
			],
			completion: { status: "fail", missing: ["approval", "handoff"] },
		};
		const step = inferNextStep(base);
		assert.equal(step.id, "approve");
		assert.match(step.remedy, /--gate user-approval-implement/);
		assert.doesNotMatch(step.remedy, /<gate-id>/);
	});

	it("recommends feature when installed but no features", () => {
		const step = inferNextStep(ctxOf({ features: [] }, { type: "bootstrap", id: null }));
		assert.equal(step.id, "feature");
		assert.match(step.remedy, /^amber feature add --target \. --id F001/);
	});

	it("recommends plan when a feature exists but has no plan", () => {
		const step = inferNextStep(
			ctxOf({ features: [{ id: "F001", status: "not_started", evidence: [] }], plans: [] }),
		);
		assert.equal(step.id, "plan");
		assert.match(step.remedy, /amber plan --target \. --feature F001/);
	});

	it("recommends gate when the plan is pending", () => {
		const step = inferNextStep(
			ctxOf({
				features: [{ id: "F001", status: "not_started", evidence: [] }],
				plans: [{ path: "docs/plans/F001-login.md", featureId: "F001", confirmed: false, mtimeMs: 1 }],
			}),
		);
		assert.equal(step.id, "gate");
		assert.match(step.remedy, /amber gate --confirm .* --plan docs\/plans\/F001-login\.md/);
	});

	it("recommends feature-evidence when plan confirmed and no evidence", () => {
		const step = inferNextStep(
			ctxOf({
				features: [{ id: "F001", status: "not_started", evidence: [] }],
				plans: [{ path: "docs/plans/F001-login.md", featureId: "F001", confirmed: true, mtimeMs: 1 }],
			}),
		);
		assert.equal(step.id, "feature-evidence");
	});

	it("recommends accept when plan confirmed and evidence recorded", () => {
		const step = inferNextStep(
			ctxOf({
				features: [{ id: "F001", status: "passing", evidence: [{ command: "x", result: "y", date: "2026-06-27" }] }],
				plans: [{ path: "docs/plans/F001-login.md", featureId: "F001", confirmed: true, mtimeMs: 1 }],
			}),
		);
		assert.equal(step.id, "accept");
		assert.match(step.remedy, /amber accept .* --plan docs\/plans\/F001-login\.md/);
	});

	it("walks session focus through verify → approve → handoff → complete-check → session-complete", () => {
		const base = {
			...ctxOf({}, { type: "session", id: "sess-1" }),
			liveHandoff: false,
			sessionStatus: "executing",
		};
		assert.equal(
			inferNextStep({
				...base,
				completion: { status: "fail", missing: ["verification", "approval", "handoff"] },
			}).id,
			"verify",
		);
		assert.equal(
			inferNextStep({
				...base,
				completion: { status: "fail", missing: ["approval", "handoff"] },
			}).id,
			"approve",
		);
		// After verify+approve, scaffold handoff must be regenerated before complete-check (G1/G2).
		assert.equal(
			inferNextStep({
				...base,
				completion: { status: "fail", missing: ["handoff"] },
			}).id,
			"handoff",
		);
		assert.equal(
			inferNextStep({
				...base,
				liveHandoff: true,
				completion: { status: "fail", missing: ["work"] },
			}).id,
			"complete-check",
		);
		assert.equal(
			inferNextStep({
				...base,
				liveHandoff: true,
				completion: { status: "pass", missing: [] },
				sessionStatus: "executing",
			}).id,
			"session-complete",
		);
		assert.equal(
			inferNextStep({
				...base,
				liveHandoff: true,
				completion: { status: "pass", missing: [] },
				sessionStatus: "completed",
			}),
			null,
		);
	});

	it("does not propose feature/init for a session focus on a feature-less repo", () => {
		const step = inferNextStep(
			ctxOf({ features: [] }, { type: "session", id: "sess-1" }),
		);
		// init/feature are guarded to non-session focus, so verify wins (no completion → missing []).
		assert.notEqual(step && step.id, "feature");
		assert.notEqual(step && step.id, "init");
	});
});

describe("acceptLogged via synthetic ctx + real evolution log", () => {
	it("reports complete (null next) once accept has been logged", () => {
		const dir = tmpRepo();
		const evoDir = path.join(dir, "docs", "wiki", "engineering");
		fs.mkdirSync(evoDir, { recursive: true });
		fs.writeFileSync(path.join(evoDir, "harness-evolution.md"), "## 2026-06-27 docs/plans/F001-login.md\n");
		const ctx = ctxOf(
			{
				targetRoot: dir,
				features: [{ id: "F001", status: "passing", evidence: [{ command: "x", result: "y", date: "2026-06-27" }] }],
				plans: [{ path: "docs/plans/F001-login.md", featureId: "F001", confirmed: true, mtimeMs: 1 }],
			},
			{ type: "feature", id: "F001" },
		);
		assert.equal(inferNextStep(ctx), null);
	});
});

describe("focus auto-selection", () => {
	it("states the auto-selected feature context (feature of most-recent plan)", () => {
		const dir = tmpRepo();
		writeFeatureList(dir, [
			{ id: "F001", title: "A", status: "not_started", evidence: [] },
			{ id: "F002", title: "B", status: "not_started", evidence: [] },
		]);
		writePlan(dir, "F002-b.md", "Feature: F002\nUser Confirmation: pending\n");
		const ctx = buildContext(dir, {});
		assert.equal(ctx.focus.type, "feature");
		assert.equal(ctx.focus.autoSelected, true);
		assert.equal(ctx.focus.id, "F002");
		assert.equal(ctx.focus.othersPending, 1);
	});

	it("remedyFor returns the feature add command from a minimal ctx", () => {
		assert.match(remedyFor("feature", { targetDisplay: "." }), /^amber feature add --target \. --id F001/);
	});
});
