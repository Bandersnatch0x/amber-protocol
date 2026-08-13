"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { resolveTarget, readJsonSafe } = require("./core/fs-utils");
const { REPO_ROOT } = require("./core/constants");
const { buildContext, inferNextStep } = require("./core/lifecycle");
const { buildGovernanceReport } = require("./core/governance-report");
const { loadRoutes } = require("./route-loader");
const {
	JOURNEYS,
	decideAdvisoryRouteJourney,
	tokenizeObjective,
} = require("./route-journey-decision");

// Route advisor (T5.8, ADR-0014): read-only keyword matching over route
// manifest objective/description metadata. Amber never executes or creates
// anything here — it only reads declarative manifests and prints advice.
// Objectives carrying any of these tokens are routed to a security/review pack
// (e.g. secure-code-review) regardless of generic token overlap, so money flows,
// credentials, and external surfaces get a review suggestion up front.
const SECURITY_KEYWORDS = [
	"payment",
	"payments",
	"money",
	"billing",
	"checkout",
	"charge",
	"payout",
	"credential",
	"credentials",
	"password",
	"token",
	"secret",
	"auth",
	"authentication",
	"pii",
	"privacy",
	"security",
	"external",
	"integration",
	"integrations",
	"upload",
	"download",
];

function loadWorkflowPacks(packsDir) {
	if (!fs.existsSync(packsDir)) {
		return [];
	}
	return fs
		.readdirSync(packsDir)
		.filter((name) => name.endsWith(".pack.json"))
		.sort()
		.map((name) => {
			const result = readJsonSafe(path.join(packsDir, name));
			return result.value && typeof result.value === "object" && !Array.isArray(result.value)
				? result.value
				: null;
		})
		.filter(Boolean);
}

function packMetadata(pack) {
	return [pack.id, pack.title, pack.description]
		.filter((value) => typeof value === "string")
		.join(" ")
		.toLowerCase();
}

function suggestWorkflowPack(tokens, objective, packsDir) {
	const packs = loadWorkflowPacks(packsDir);
	if (packs.length === 0) {
		return null;
	}
	const objectiveText = objective.toLowerCase();
	const securityTriggered = SECURITY_KEYWORDS.some((keyword) => objectiveText.includes(keyword));
	let candidates = packs;
	if (securityTriggered) {
		const securityPacks = packs.filter((pack) => /secure|security|review/.test(packMetadata(pack)));
		if (securityPacks.length > 0) {
			candidates = securityPacks;
		}
	}
	const best = candidates
		.map((pack) => ({
			pack,
			overlap: tokens.filter((token) => packMetadata(pack).includes(token)).length,
		}))
		.sort((a, b) => b.overlap - a.overlap || a.pack.id.localeCompare(b.pack.id))[0];
	if (!best) {
		return null;
	}
	if (securityTriggered || best.overlap >= 1) {
		return best.pack.id;
	}
	return null;
}

// Produce the read-only routing suggestion for a stated objective. When no
// route matches, degrades to "run the plan gate first" advice instead of
// guessing a route.
function decideRouting(objective, target = REPO_ROOT) {
	const targetRoot = resolveTarget(target);
	const { routes } = loadRoutes(path.join(targetRoot, "routes"));
	const decision = decideAdvisoryRouteJourney({ objective, routes, journeys: JOURNEYS });

	if (decision.route.status === "unmatched") {
		return {
			decision,
			suggestion: {
				provided: true,
				objective,
				matched: false,
				routeId: null,
				confidence: 0,
				workflowPackId: null,
				suggestion: `No matching route for objective "${objective}". Suggest running the plan gate first: amber plan --feature <id> --title "<objective>", then amber session start --route <id> --confirm once a route fits.`,
			},
		};
	}

	const routeId = decision.route.routeId;
	const confidence = decision.route.confidence;
	// D/F: tokenize once and reuse for both routing and workflow-pack suggestion.
	const tokens = tokenizeObjective(objective);
	const workflowPackId =
		suggestWorkflowPack(tokens, objective, path.join(targetRoot, "workflow-packs")) || null;
	return {
		decision,
		suggestion: {
			provided: true,
			objective,
			matched: true,
			routeId,
			confidence,
			workflowPackId,
			matches: decision.route.candidates,
		},
	};
}

function suggestRouting(objective, target = REPO_ROOT) {
	return decideRouting(objective, target).suggestion;
}

function focusLabel(focus) {
	if (focus.type === "session") return `session ${focus.id}`;
	if (focus.type === "feature") return `feature ${focus.id}`;
	return "project bootstrap";
}

function renderContext(focus) {
	const notes = [];
	if (focus.autoSelected) notes.push("auto-selected");
	if (focus.othersPending > 0) notes.push(`${focus.othersPending} other item(s) pending`);
	const suffix = notes.length > 0 ? ` (${notes.join("; ")})` : "";
	return `Context: ${focusLabel(focus)}${suffix}`;
}

function renderText(envelope) {
	const lines = [renderContext(envelope.focus)];
	if (envelope.complete || !envelope.nextStep) {
		lines.push("All lifecycle steps complete for this focus.");
	} else {
		const { label, why, remedy } = envelope.nextStep;
		lines.push(`Next step: ${label}`, `  Why: ${why}`, `  Run: ${remedy}`);
	}

	if (Array.isArray(envelope.governanceActions) && envelope.governanceActions.length > 0) {
		const action = envelope.governanceActions[0];
		lines.push("Governance action:");
		lines.push(`  [${action.severity}] ${action.id}: ${action.why}`);
		lines.push(`  Run: ${action.command}`);
	}

	if (envelope.routingSuggestion) {
		const suggestion = envelope.routingSuggestion;
		if (suggestion.matched) {
			lines.push(`Route suggestion: ${suggestion.routeId}`);
			if (suggestion.workflowPackId) {
				lines.push(`  Workflow pack: ${suggestion.workflowPackId}`);
			}
			lines.push(`  Confidence: ${suggestion.confidence}`);
		} else {
			lines.push(`Route suggestion: ${suggestion.suggestion}`);
		}
	}

	return lines.join("\n");
}

function inferNext(target, options = {}) {
	const targetRoot = resolveTarget(target);
	const targetDisplay = target || ".";
	const ctx = buildContext(targetRoot, { ...options, target: targetDisplay });
	const nextStep = inferNextStep(ctx);
	let governanceActions;
	try {
		governanceActions = buildGovernanceReport(targetRoot, { targetDisplay }).nextActions.slice(
			0,
			3,
		);
	} catch {
		governanceActions = [];
	}

	const envelope = {
		target,
		focus: {
			type: ctx.focus.type,
			id: ctx.focus.id,
			autoSelected: ctx.focus.autoSelected,
			othersPending: ctx.focus.othersPending,
		},
		nextStep: nextStep || null,
		governanceActions,
		complete: nextStep === null,
		errors: [],
		warnings: [],
	};
	// T5.8 / ADR-0014: routing advisor. Only present when --objective is given;
	// absent (not null) so the no-flag envelope is byte-identical to before.
	if (typeof options.objective === "string" && options.objective.trim() !== "") {
		const routing = decideRouting(options.objective.trim(), targetRoot);
		envelope.routingSuggestion = routing.suggestion;
		envelope.journeyId = routing.decision.journey.journeyId;
	}
	envelope.text = renderText(envelope);
	return envelope;
}

module.exports = { inferNext, renderText, renderContext, suggestRouting };
