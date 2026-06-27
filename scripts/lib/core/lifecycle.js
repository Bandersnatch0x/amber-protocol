"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { pathExists, readText, collectFilesBySuffix } = require("./fs-utils");
const { REQUIRED_HARNESS_FILES } = require("./constants");

// ── State gathering ──────────────────────────────────────────────────────────

function safeMtimeMs(filePath) {
	try {
		return fs.statSync(filePath).mtimeMs;
	} catch {
		return 0;
	}
}

function parsePlanFile(targetRoot, filePath) {
	let content = "";
	try {
		content = readText(filePath);
	} catch {
		content = "";
	}
	const featureMatch = content.match(/^Feature:\s*(\S+)/m);
	const confirmMatch = content.match(/^User Confirmation:\s*(\S+)/m);
	return {
		path: path.relative(targetRoot, filePath).split(path.sep).join("/"),
		featureId: featureMatch ? featureMatch[1] : null,
		confirmed: Boolean(confirmMatch && confirmMatch[1].toLowerCase() === "confirmed"),
		mtimeMs: safeMtimeMs(filePath),
	};
}

function gatherPlans(targetRoot) {
	const plansDir = path.join(targetRoot, "docs", "plans");
	return collectFilesBySuffix(plansDir, ".md").map((file) =>
		parsePlanFile(targetRoot, file),
	);
}

function gatherState(targetRoot) {
	// Readers are required lazily so that importing this module for remedyFor()
	// (e.g. from doctor.js) does not pull in the heavy session-commands graph.
	const { loadFeatures } = require("../feature-commands");
	const { findMostRecentSession } = require("../session-commands");

	const amberInstalled = REQUIRED_HARNESS_FILES.every((rel) =>
		pathExists(path.join(targetRoot, rel)),
	);
	const featureData = loadFeatures(targetRoot);
	const features = Array.isArray(featureData.features)
		? featureData.features.filter(Boolean)
		: [];
	// No try/catch around findMostRecentSession: it returns null when there are
	// no sessions and tolerates a missing state dir, so any throw here is a real
	// bug (e.g. an unexported function) that must surface, not be swallowed.
	const activeSessionId = findMostRecentSession(targetRoot, { excludeCompleted: true });

	return {
		targetRoot,
		amberInstalled,
		featureCorrupt: Boolean(featureData._corrupt),
		features,
		plans: gatherPlans(targetRoot),
		activeSessionId,
	};
}

// ── State-derived helpers (operate on the context built below) ───────────────

function planFor(ctx) {
	if (ctx.focus.type !== "feature") return undefined;
	return ctx.state.plans
		.filter((p) => p.featureId === ctx.focus.id)
		.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
}

function featureHasEvidence(ctx) {
	const feature = ctx.state.features.find((f) => f.id === ctx.focus.id);
	return Boolean(feature && Array.isArray(feature.evidence) && feature.evidence.length > 0);
}

function acceptLogged(ctx) {
	const plan = planFor(ctx);
	if (!plan) return false;
	const evoPath = path.join(
		ctx.state.targetRoot,
		"docs",
		"wiki",
		"engineering",
		"harness-evolution.md",
	);
	if (!pathExists(evoPath)) return false;
	try {
		return readText(evoPath).includes(plan.path);
	} catch {
		return false;
	}
}

function sessionMissing(ctx) {
	return ctx.completion ? ctx.completion.missing : [];
}

// ── Declarative lifecycle steps (ordered) ────────────────────────────────────

const STEPS = [
	{
		id: "init",
		label: "Install Amber",
		appliesTo: (ctx) => ctx.focus.type !== "session",
		isDone: (ctx) => ctx.state.amberInstalled,
		why: () => "Amber starter files are not all present.",
		remedy: (ctx) => `amber init --target ${ctx.targetDisplay}`,
	},
	{
		id: "feature",
		label: "Register a feature",
		appliesTo: (ctx) => ctx.focus.type !== "session",
		isDone: (ctx) => ctx.state.features.length >= 1,
		why: () => "no feature is registered in feature_list.json.",
		remedy: (ctx) => `amber feature add --target ${ctx.targetDisplay} --id F001 --title "..."`,
	},
	{
		id: "plan",
		label: "Create a plan",
		appliesTo: (ctx) => ctx.focus.type === "feature",
		isDone: (ctx) => Boolean(planFor(ctx)),
		why: (ctx) => `feature ${ctx.focus.id} has no plan yet.`,
		remedy: (ctx) =>
			`amber plan --target ${ctx.targetDisplay} --feature ${ctx.focus.id} --title "..."`,
	},
	{
		id: "gate",
		label: "Confirm the plan",
		appliesTo: (ctx) => ctx.focus.type === "feature" && Boolean(planFor(ctx)),
		isDone: (ctx) => Boolean(planFor(ctx) && planFor(ctx).confirmed),
		why: () => 'the plan exists but User Confirmation is still "pending".',
		remedy: (ctx) =>
			`amber gate --confirm --target ${ctx.targetDisplay} --plan ${planFor(ctx).path}`,
	},
	{
		id: "feature-evidence",
		label: "Record feature verification evidence",
		appliesTo: (ctx) => ctx.focus.type === "feature" && Boolean(planFor(ctx)),
		isDone: (ctx) => featureHasEvidence(ctx),
		why: () => "no verification evidence is recorded for this feature yet.",
		remedy: (ctx) =>
			`amber feature verify --target ${ctx.targetDisplay} --feature ${ctx.focus.id} --command "..." --result "..."`,
	},
	{
		id: "verify",
		label: "Record session verification",
		appliesTo: (ctx) => ctx.focus.type === "session",
		isDone: (ctx) => !sessionMissing(ctx).includes("verification"),
		why: () => "the session has no verification evidence yet.",
		remedy: (ctx) => `amber session verify --session ${ctx.focus.id}`,
	},
	{
		id: "approve",
		label: "Approve the session",
		appliesTo: (ctx) => ctx.focus.type === "session",
		isDone: (ctx) => !sessionMissing(ctx).includes("approval"),
		why: () => "the session has no approval evidence yet.",
		remedy: (ctx) => `amber session approve --session ${ctx.focus.id}`,
	},
	{
		id: "complete-check",
		label: "Run completion check",
		appliesTo: (ctx) => ctx.focus.type === "session",
		isDone: (ctx) => Boolean(ctx.completion && ctx.completion.status === "pass"),
		why: () => "the session is not yet complete (evidence still missing).",
		remedy: (ctx) => `amber session complete-check --session ${ctx.focus.id} --strict`,
	},
	{
		id: "accept",
		label: "Accept the plan",
		appliesTo: (ctx) => ctx.focus.type === "feature" && Boolean(planFor(ctx)),
		isDone: (ctx) => acceptLogged(ctx),
		why: () => "the plan is ready to accept and append to the evolution log.",
		remedy: (ctx) => {
			const plan = planFor(ctx);
			const sessionSuffix = ctx.state.activeSessionId
				? ` --session ${ctx.state.activeSessionId}`
				: "";
			return `amber accept --target ${ctx.targetDisplay} --plan ${plan.path}${sessionSuffix}`;
		},
	},
];

// ── Focus resolution ─────────────────────────────────────────────────────────

function countOthers(state, focusedId) {
	return state.features.filter((f) => f.id !== focusedId).length;
}

function resolveFocus(state, options) {
	if (options.session) {
		return { type: "session", id: options.session, autoSelected: false, othersPending: 0 };
	}
	if (options.feature) {
		return { type: "feature", id: options.feature, autoSelected: false, othersPending: countOthers(state, options.feature) };
	}
	if (state.activeSessionId) {
		return { type: "session", id: state.activeSessionId, autoSelected: true, othersPending: 0 };
	}
	const recentPlan = [...state.plans]
		.filter((p) => p.featureId)
		.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
	if (recentPlan) {
		return { type: "feature", id: recentPlan.featureId, autoSelected: true, othersPending: countOthers(state, recentPlan.featureId) };
	}
	const feature =
		state.features.find((f) => (f.status || "not_started") === "not_started") ||
		state.features[0];
	if (feature) {
		return { type: "feature", id: feature.id, autoSelected: true, othersPending: countOthers(state, feature.id) };
	}
	return { type: "bootstrap", id: null, autoSelected: true, othersPending: 0 };
}

// ── Public inference API ─────────────────────────────────────────────────────

function buildContext(targetRoot, options = {}) {
	const state = gatherState(targetRoot);
	const focus = resolveFocus(state, options);
	let completion = null;
	if (focus.type === "session") {
		const { evaluateCompletion } = require("../completion-check");
		completion = evaluateCompletion(targetRoot, focus.id);
	}
	return { state, focus, completion, targetDisplay: options.target || "." };
}

function describeStep(step, ctx) {
	return { id: step.id, label: step.label, why: step.why(ctx), remedy: step.remedy(ctx) };
}

function inferNextStep(ctx) {
	const step = STEPS.find((s) => s.appliesTo(ctx) && !s.isDone(ctx));
	return step ? describeStep(step, ctx) : null;
}

function evaluateLifecycle(ctx) {
	return STEPS.filter((s) => s.appliesTo(ctx)).map((s) => ({
		id: s.id,
		label: s.label,
		done: s.isDone(ctx),
	}));
}

// Single source for lifecycle-coincident remedies. The init/feature remedies
// depend only on ctx.targetDisplay, so callers (e.g. doctor) may pass a minimal
// { targetDisplay } context.
function remedyFor(stepId, ctx) {
	const step = STEPS.find((s) => s.id === stepId);
	return step ? step.remedy(ctx) : null;
}

module.exports = {
	gatherState,
	gatherPlans,
	parsePlanFile,
	buildContext,
	inferNextStep,
	evaluateLifecycle,
	remedyFor,
	STEPS,
};
