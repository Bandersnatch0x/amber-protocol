"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { pathExists, readText, collectFilesBySuffix, toPortablePath } = require("./fs-utils");
const { REQUIRED_HARNESS_FILES } = require("./constants");
const { classifyTarget } = require("./target-classification");
const { shellQuote } = require("./text-utils");

// ── State gathering ──────────────────────────────────────────────────────────

function safeMtimeMs(filePath) {
	try {
		return fs.statSync(filePath).mtimeMs;
	} catch {
		return 0;
	}
}

function parsePlanFile(targetRoot, filePath) {
	let content;
	try {
		content = readText(filePath);
	} catch {
		content = "";
	}
	const featureMatch = content.match(/^Feature:\s*(\S+)/m);
	const confirmMatch = content.match(/^User Confirmation:\s*(\S+)/m);
	return {
		path: toPortablePath(path.relative(targetRoot, filePath)),
		featureId: featureMatch ? featureMatch[1] : null,
		confirmed: Boolean(confirmMatch && confirmMatch[1].toLowerCase() === "confirmed"),
		mtimeMs: safeMtimeMs(filePath),
	};
}

function gatherPlans(targetRoot) {
	const plansDir = path.join(targetRoot, "docs", "plans");
	return collectFilesBySuffix(plansDir, ".md").map((file) => parsePlanFile(targetRoot, file));
}

const EXISTING_PROJECT_MARKERS = [
	"package.json",
	"go.mod",
	"pyproject.toml",
	"Cargo.toml",
	"pom.xml",
	"src",
	"lib",
	"app",
	"docs",
	"README.md",
	"AGENTS.md",
	"CLAUDE.md",
];

function hasExistingProjectSignals(targetRoot) {
	return EXISTING_PROJECT_MARKERS.some((rel) => pathExists(path.join(targetRoot, rel)));
}

// Resolve the project's verification command from on-disk evidence (NOT a
// hardcoded default). package.json scripts.test wins as a confirmed command;
// otherwise fall back to an audit candidate (python/go/rust); otherwise null,
// which the verify remedy renders as an explicit placeholder. Amber never
// silently substitutes `npm test` for an unknown toolchain (#42).
function resolveVerifyCommand(targetRoot) {
	const { detectCommands, detectCandidateCommands, detectToolingEvidence } = require("./audit");
	const commands = detectCommands(targetRoot);
	if (commands.some((c) => c.source === "package.json" && c.name === "test")) {
		return "npm test";
	}
	const candidates = detectCandidateCommands(targetRoot, detectToolingEvidence(targetRoot));
	if (candidates.length > 0) return candidates[0].command;
	return null;
}

function gatherState(targetRoot) {
	// Readers are required lazily so that importing this module for remedyFor()
	// (e.g. from doctor.js) does not pull in the heavy session-commands graph.
	const { loadFeatures } = require("../feature-commands");
	const { findMostRecentSession } = require("../session-commands");

	const amberInstalled = REQUIRED_HARNESS_FILES.every((rel) =>
		pathExists(path.join(targetRoot, rel)),
	);
	// The product-repo IS the source-of-truth for the template set — it doesn't
	// need to install itself. Without this, `amber handoff`/`next` on Amber's own
	// tree recommends `amber init` as the terminal step, contradicting the
	// lifecycle it's meant to close (#65).
	const isProductRepo = classifyTarget(targetRoot).type === "product-repo";
	const featureData = loadFeatures(targetRoot);
	const features = Array.isArray(featureData.features) ? featureData.features.filter(Boolean) : [];
	// No try/catch around findMostRecentSession: it returns null when there are
	// no sessions and tolerates a missing state dir, so any throw here is a real
	// bug (e.g. an unexported function) that must surface, not be swallowed.
	const activeSessionId = findMostRecentSession(targetRoot, { excludeCompleted: true });

	return {
		targetRoot,
		amberInstalled: amberInstalled || isProductRepo,
		isProductRepo,
		featureCorrupt: Boolean(featureData._corrupt),
		features,
		plans: gatherPlans(targetRoot),
		activeSessionId,
		existingProject: hasExistingProjectSignals(targetRoot),
		verifyCommand: resolveVerifyCommand(targetRoot),
	};
}

/** Resolve next unapproved gate id for a session (N2). */
function resolvePendingGate(targetRoot, sessionId) {
	const { loadSessionManifest } = require("../session-commands");
	const { readSessionEvents } = require("../session-timeline");
	const { loadTargetRoutes } = require("../route-loader");
	const loaded = loadSessionManifest(targetRoot, sessionId);
	if (!loaded || !loaded.manifest) {
		return { gates: [], pendingGateId: null, routeId: null, pendingCount: 0 };
	}
	const manifest = loaded.manifest;
	const routeId = (manifest.route && (manifest.route.id || manifest.route.routeId)) || null;
	const { routes } = loadTargetRoutes(targetRoot);
	const route = routes.find((r) => r.routeId === routeId);
	const gates = route && Array.isArray(route.gates) ? route.gates : [];
	const events = readSessionEvents(
		loaded.sessionDir || path.join(targetRoot, ".amber", "sessions", sessionId),
	);
	const passed = new Set(
		events
			.filter((e) => e && e.type === "gate_passed" && e.data)
			.map((e) => e.data.gateId || e.data.gate)
			.filter(Boolean),
	);
	const pending = gates.filter((g) => !passed.has(g.id));
	const pendingGateId = (pending[0] && pending[0].id) || (gates[0] && gates[0].id) || null;
	return { gates, pendingGateId, routeId, pendingCount: pending.length };
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
		return toPortablePath(readText(evoPath)).includes(toPortablePath(plan.path));
	} catch {
		return false;
	}
}

function sessionMissing(ctx) {
	return ctx.completion ? ctx.completion.missing : [];
}

function sessionVerifyDone(ctx) {
	return !sessionMissing(ctx).includes("verification");
}

function sessionApproveDone(ctx) {
	return !sessionMissing(ctx).includes("approval");
}

// ── Declarative lifecycle steps (ordered) ────────────────────────────────────

const STEPS = [
	// A1: audit is a read-only advisory for existing non-Amber repos. It NEVER
	// writes a target file (#43) and never blocks progression, so isDone is
	// always true — `amber next` advances straight to init. The step is kept so
	// evaluateLifecycle still surfaces audit as a recommended pre-install check.
	{
		id: "audit",
		label: "Audit existing repository (read-only advisory)",
		appliesTo: (ctx) =>
			ctx.focus.type !== "session" &&
			!ctx.state.amberInstalled &&
			Boolean(ctx.state.existingProject),
		isDone: () => true,
		why: () =>
			"this looks like an existing project — optionally inspect with audit (read-only) before install; for multi-repo adoption reviews also run amber adoption report.",
		remedy: (ctx) => `amber audit --target ${shellQuote(ctx.targetDisplay)}`,
	},
	{
		id: "init",
		label: "Install Amber",
		appliesTo: (ctx) => ctx.focus.type !== "session",
		isDone: (ctx) => ctx.state.amberInstalled,
		why: (ctx) =>
			ctx.state.existingProject
				? "Amber starter files are not all present (audit done or skipped) — safe next install is init."
				: "Amber starter files are not all present.",
		remedy: (ctx) => `amber init --target ${shellQuote(ctx.targetDisplay)}`,
	},
	{
		id: "feature",
		label: "Register a feature",
		appliesTo: (ctx) => ctx.focus.type !== "session",
		isDone: (ctx) => ctx.state.features.length >= 1,
		why: () => "no feature is registered in feature_list.json.",
		remedy: (ctx) =>
			`amber feature add --target ${shellQuote(ctx.targetDisplay)} --id F001 --title "..."`,
	},
	{
		id: "plan",
		label: "Create a plan",
		appliesTo: (ctx) => ctx.focus.type === "feature",
		isDone: (ctx) => Boolean(planFor(ctx)),
		why: (ctx) => `feature ${ctx.focus.id} has no plan yet.`,
		remedy: (ctx) =>
			`amber plan --target ${shellQuote(ctx.targetDisplay)} --feature ${ctx.focus.id} --title "..."`,
	},
	{
		id: "gate",
		label: "Confirm the plan",
		appliesTo: (ctx) => ctx.focus.type === "feature" && Boolean(planFor(ctx)),
		isDone: (ctx) => Boolean(planFor(ctx) && planFor(ctx).confirmed),
		why: () => 'the plan exists but User Confirmation is still "pending".',
		remedy: (ctx) =>
			`amber gate --confirm --target ${shellQuote(ctx.targetDisplay)} --plan ${shellQuote(planFor(ctx).path)}`,
	},
	{
		id: "feature-evidence",
		label: "Record feature verification evidence",
		appliesTo: (ctx) => ctx.focus.type === "feature" && Boolean(planFor(ctx)),
		isDone: (ctx) => featureHasEvidence(ctx),
		why: () => "no verification evidence is recorded for this feature yet.",
		remedy: (ctx) =>
			`amber session start --target ${shellQuote(ctx.targetDisplay)} --goal "..." --feature ${ctx.focus.id} --confirm`,
	},
	{
		id: "verify",
		label: "Record session verification",
		appliesTo: (ctx) => ctx.focus.type === "session",
		isDone: (ctx) => sessionVerifyDone(ctx),
		why: () => "the session has no verification evidence yet.",
		remedy: (ctx) => {
			// Use the project's confirmed/candidate verification command discovered
			// from disk; never silently fall back to `npm test` for an unknown
			// toolchain (#42). Unknown -> explicit placeholder.
			const cmd = ctx.state.verifyCommand || "<confirm-verification-command>";
			return `amber session verify --session ${ctx.focus.id} --execute --target ${shellQuote(ctx.targetDisplay)} --command ${shellQuote(cmd)} --confirm`;
		},
	},
	{
		id: "approve",
		label: "Approve the session",
		appliesTo: (ctx) => ctx.focus.type === "session",
		isDone: (ctx) => sessionApproveDone(ctx),
		why: (ctx) => {
			const pending = ctx.pendingGateId;
			const n = (ctx.sessionGates && ctx.sessionGates.length) || 0;
			if (n > 1 && pending) {
				return `the session has no approval evidence yet (next gate: ${pending}; ${n} gates on route).`;
			}
			return "the session has no approval evidence yet.";
		},
		remedy: (ctx) => {
			const gate = ctx.pendingGateId;
			const target = shellQuote(ctx.targetDisplay);
			if (gate) {
				return `amber session approve --session ${ctx.focus.id} --gate ${gate} --target ${target}`;
			}
			return `amber session approve --session ${ctx.focus.id} --gate <gate-id> --target ${target}`;
		},
	},
	// G1/G2: regenerate live handoff before complete-check so scaffold files
	// cannot satisfy the handoff gate (see completion-check.isLiveHandoff).
	{
		id: "handoff",
		label: "Regenerate session handoff",
		appliesTo: (ctx) => {
			if (ctx.focus.type === "session") {
				return sessionVerifyDone(ctx) && sessionApproveDone(ctx);
			}
			// After accept, ensure continuity artifact reflects accepted work.
			if (ctx.focus.type === "feature" && Boolean(planFor(ctx)) && acceptLogged(ctx)) {
				return true;
			}
			return false;
		},
		isDone: (ctx) => Boolean(ctx.liveHandoff),
		why: () =>
			"session-handoff.md is missing or still the init scaffold — regenerate from live state.",
		remedy: (ctx) => `amber handoff --target ${shellQuote(ctx.targetDisplay)}`,
	},
	{
		id: "complete-check",
		label: "Run completion check",
		appliesTo: (ctx) => ctx.focus.type === "session",
		isDone: (ctx) => Boolean(ctx.completion && ctx.completion.status === "pass"),
		why: (ctx) => {
			const missing = sessionMissing(ctx);
			if (missing.length > 0) {
				return `the session is not yet complete (missing: ${missing.join(", ")}).`;
			}
			return "the session is not yet complete (evidence still missing).";
		},
		remedy: (ctx) =>
			`amber session complete-check --session ${ctx.focus.id} --strict --target ${shellQuote(ctx.targetDisplay)}`,
	},
	{
		id: "session-complete",
		label: "Mark session completed",
		appliesTo: (ctx) =>
			ctx.focus.type === "session" && Boolean(ctx.completion && ctx.completion.status === "pass"),
		isDone: (ctx) => ctx.sessionStatus === "completed",
		why: () => "complete-check passed but the session is not marked completed yet.",
		remedy: (ctx) =>
			`amber session complete --session ${ctx.focus.id} --target ${shellQuote(ctx.targetDisplay)}`,
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
			return `amber accept --target ${shellQuote(ctx.targetDisplay)} --plan ${shellQuote(plan.path)}${sessionSuffix}`;
		},
	},
	// F023: accepted work that touched schema/contract/infra paths owes a
	// knowledge write-back review. Detection is pure path matching over the
	// feature's booked paths (cheap; learning-writeback.js is required lazily
	// so importing lifecycle for remedies stays light). When no category
	// matched, the step does not apply — no fake gate.
	{
		id: "learnings",
		label: "Review learning write-back",
		appliesTo: (ctx) => {
			if (ctx.focus.type !== "feature" || !planFor(ctx) || !acceptLogged(ctx)) return false;
			const feature = ctx.state.features.find((f) => f && f.id === ctx.focus.id);
			const paths = feature && Array.isArray(feature.paths) ? feature.paths : [];
			const { detectWriteBackTriggers } = require("./learning-writeback");
			return detectWriteBackTriggers(paths).matchedCategories.length > 0;
		},
		isDone: (ctx) => {
			const feature = ctx.state.features.find((f) => f && f.id === ctx.focus.id);
			return Boolean(
				feature && feature.learningWriteBack && feature.learningWriteBack.reviewed === true,
			);
		},
		why: (ctx) => {
			const feature = ctx.state.features.find((f) => f && f.id === ctx.focus.id);
			const paths = feature && Array.isArray(feature.paths) ? feature.paths : [];
			const { detectWriteBackTriggers } = require("./learning-writeback");
			const categories = detectWriteBackTriggers(paths).matchedCategories;
			return `accepted work touched ${categories.join("/")} paths — the knowledge write-back review is not booked yet (book it with amber learnings --reviewed).`;
		},
		remedy: (ctx) =>
			`amber learnings --target ${shellQuote(ctx.targetDisplay)} --feature ${ctx.focus.id}`,
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
		return {
			type: "feature",
			id: options.feature,
			autoSelected: false,
			othersPending: countOthers(state, options.feature),
		};
	}
	if (state.activeSessionId) {
		return { type: "session", id: state.activeSessionId, autoSelected: true, othersPending: 0 };
	}
	const recentPlan = [...state.plans]
		.filter((p) => p.featureId)
		.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
	if (recentPlan) {
		return {
			type: "feature",
			id: recentPlan.featureId,
			autoSelected: true,
			othersPending: countOthers(state, recentPlan.featureId),
		};
	}
	const feature =
		state.features.find((f) => (f.status || "not_started") === "not_started") || state.features[0];
	if (feature) {
		return {
			type: "feature",
			id: feature.id,
			autoSelected: true,
			othersPending: countOthers(state, feature.id),
		};
	}
	return { type: "bootstrap", id: null, autoSelected: true, othersPending: 0 };
}

// ── Public inference API ─────────────────────────────────────────────────────

function buildContext(targetRoot, options = {}) {
	const state = gatherState(targetRoot);
	const focus = resolveFocus(state, options);
	const { isLiveHandoff, evaluateCompletion } = require("../completion-check");
	const liveHandoff = isLiveHandoff(targetRoot);
	let completion = null;
	let sessionStatus = null;
	let pendingGateId = null;
	let sessionGates = [];
	if (focus.type === "session") {
		// Default strict so `amber next` aligns with `session complete-check --strict`
		// and `session complete` (G1 last-mile). Callers may pass strict:false.
		const strict = options.strict !== false;
		completion = evaluateCompletion(targetRoot, focus.id, { strict });
		try {
			const { loadSessionManifest } = require("../session-commands");
			const loaded = loadSessionManifest(targetRoot, focus.id);
			if (loaded && loaded.manifest) {
				sessionStatus = loaded.manifest.status || null;
			}
		} catch {
			sessionStatus = null;
		}
		const gateInfo = resolvePendingGate(targetRoot, focus.id);
		pendingGateId = gateInfo.pendingGateId;
		sessionGates = gateInfo.gates;
	}
	return {
		state,
		focus,
		completion,
		sessionStatus,
		liveHandoff,
		pendingGateId,
		sessionGates,
		targetDisplay: options.target || ".",
	};
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
	resolvePendingGate,
	hasExistingProjectSignals,
	planFor,
	acceptLogged,
	STEPS,
};
