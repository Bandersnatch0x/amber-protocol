"use strict";

const MATCH_WEIGHT = 0.6;
const COVERAGE_WEIGHT = 0.4;
// D: max advisory metadata score used to normalize confidence to [0,1].
// scoreRouteMetadata can return up to 4 (textScore from 4 metadata fields +
// idBonus of 2 when routeId keyword matches), but in practice a route rarely
// matches all fields, so 4 keeps the confidence curve meaningful.
const ADVISORY_MAX_SCORE = 4;

// ── Journey registry (G: data and algorithm now co-located) ──────────────

const JOURNEYS = Object.freeze([
	{
		id: "amber-delivery",
		terms: [
			"implement",
			"build",
			"change",
			"fix",
			"plan",
			"verify",
			"approve",
			"accept",
			"handoff",
			"deliver",
		],
	},
	{
		id: "amber-diagnosis-adoption",
		terms: ["audit", "diagnose", "readiness", "adopt", "install", "initialize", "repair", "doctor"],
	},
	{
		id: "amber-context-continuity",
		terms: ["context", "knowledge", "distill", "loadout", "refresh", "continuity", "resume"],
	},
	{
		id: "amber-continuous-improvement",
		terms: ["improve", "continuous", "triage", "maintenance", "next slice", "wakeup", "loop"],
	},
]);

// Term-uniqueness invariant: fail fast at load if two journeys claim the same
// term (would silently skew scoring toward the first registrant).
const _seenTerms = new Map();
for (const _journey of JOURNEYS) {
	for (const _term of _journey.terms) {
		if (_seenTerms.has(_term)) {
			throw new Error(
				`Journey term "${_term}" is assigned to both ${_seenTerms.get(_term)} and ${_journey.id}`,
			);
		}
		_seenTerms.set(_term, _journey.id);
	}
}
// Frozen module constant; validateJourneyAffinity derives its known-id Set once.
const _JOURNEY_IDS = Object.freeze(new Set(JOURNEYS.map((j) => j.id)));

// ── Route scoring (regex goalPattern) ────────────────────────────────────

function compilePattern(route) {
	const pattern = route && route.trigger && route.trigger.goalPattern;
	if (typeof pattern !== "string" || pattern.length === 0) return null;
	try {
		return new RegExp(pattern, "i");
	} catch {
		return null;
	}
}

function scoreRoutes(objective, routes) {
	if (typeof objective !== "string") throw new TypeError("objective must be a string");
	if (!Array.isArray(routes)) throw new TypeError("routes must be an array");

	const scored = [];
	for (const route of routes) {
		const regex = compilePattern(route);
		if (!regex) continue;
		const match = objective.match(regex);
		if (!match) continue;
		const matchedText = match[0] || "";
		const coverage = objective.length > 0 ? matchedText.length / objective.length : 0;
		const bounded = Math.min(1, Math.max(0, coverage));
		const confidence =
			Math.round(Math.min(1, MATCH_WEIGHT + COVERAGE_WEIGHT * bounded) * 1000) / 1000;
		scored.push({
			routeId: route.routeId,
			displayName: route.displayName || route.routeId,
			confidence,
			patternLength: route.trigger.goalPattern.length,
		});
	}

	scored.sort((a, b) => {
		if (b.confidence !== a.confidence) return b.confidence - a.confidence;
		if (b.patternLength !== a.patternLength) return b.patternLength - a.patternLength;
		return a.routeId.localeCompare(b.routeId);
	});
	return scored;
}

function selectRoute(objective, routes) {
	const candidates = scoreRoutes(objective, routes);
	if (candidates.length === 0) {
		return { matched: false, routeId: null, displayName: null, confidence: 0, candidates: [] };
	}
	const best = candidates[0];
	return {
		matched: true,
		routeId: best.routeId,
		displayName: best.displayName,
		confidence: best.confidence,
		candidates,
	};
}

// ── Journey scoring (term overlap) ────────────────────────────────────────

function tokenize(text) {
	return String(text || "").toLowerCase();
}

function scoreJourneys(objective, journeys) {
	if (!Array.isArray(journeys)) throw new TypeError("journeys must be an array");
	const text = tokenize(objective);
	return journeys
		.map((journey, index) => ({
			journey,
			index,
			score: Array.isArray(journey.terms)
				? journey.terms.filter((term) => text.includes(String(term).toLowerCase())).length
				: 0,
		}))
		.sort((a, b) => b.score - a.score || a.index - b.index);
}

function journeyAffinityIds(route) {
	const affinity = route && route.journeyAffinity;
	return Array.isArray(affinity) ? affinity : typeof affinity === "string" ? [affinity] : [];
}

function validateJourneyAffinity(route, journeys) {
	const affinityIds = journeyAffinityIds(route);
	// G/F: reuse the frozen module-level Set instead of rebuilding per call.
	// Callers may pass a non-default journeys array (tests do), so fall back
	// to a derived Set only when the registry is overridden.
	const known = journeys === JOURNEYS ? _JOURNEY_IDS : new Set(journeys.map((j) => j.id));
	const unknown = affinityIds.filter((journeyId) => !known.has(journeyId));
	if (unknown.length > 0) {
		throw new Error(`Route "${route.routeId}" has unknown Journey affinity: ${unknown.join(", ")}`);
	}
	return affinityIds;
}

function selectJourney(objective, journeys, route) {
	const affinityIds = validateJourneyAffinity(route, journeys);
	const candidates =
		affinityIds.length > 0
			? journeys.filter((journey) => affinityIds.includes(journey.id))
			: journeys;
	const ranked = scoreJourneys(objective, candidates);
	const best = ranked[0];
	if (best && best.score > 0) {
		return {
			status: "selected",
			journeyId: best.journey.id,
			score: best.score,
			affinity: affinityIds,
		};
	}
	if (affinityIds.length > 0 && candidates.length > 0) {
		return { status: "defaulted", journeyId: candidates[0].id, score: 0, affinity: affinityIds };
	}
	return {
		status: "defaulted",
		journeyId: journeys[0] ? journeys[0].id : null,
		score: 0,
		affinity: [],
	};
}

// ── Advisory metadata scoring (tokenized keyword overlap) ────────────────

function tokenizeObjective(text) {
	if (typeof text !== "string") return [];
	return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((token) => token.length >= 3);
}

function scoreRouteMetadata(route, tokens, objective) {
	const meta = [route.objective, route.description, route.displayName, route.routeId]
		.filter((value) => typeof value === "string")
		.join(" ")
		.toLowerCase();
	const textScore = tokens.reduce((count, token) => count + (meta.includes(token) ? 1 : 0), 0);
	const objectiveText = objective.toLowerCase();
	const idBonus = (route.routeId.split("-") || []).some((keyword) => {
		if (keyword.length < 3) return false;
		return (
			objectiveText.includes(keyword) ||
			tokens.some((token) => token.includes(keyword) || keyword.includes(token))
		);
	})
		? 2
		: 0;
	return textScore + idBonus;
}

function suggestRouteMetadata(objective, routes) {
	if (typeof objective !== "string") throw new TypeError("objective must be a string");
	if (!Array.isArray(routes)) throw new TypeError("routes must be an array");
	const tokens = tokenizeObjective(objective);
	return routes
		.map((route) => ({ route, score: scoreRouteMetadata(route, tokens, objective) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.route.routeId.localeCompare(b.route.routeId));
}

// ── Decision composers ───────────────────────────────────────────────────

function decideAdvisoryRouteJourney({ objective = "", routes, journeys }) {
	if (!Array.isArray(routes)) throw new TypeError("routes must be an array");
	if (!Array.isArray(journeys)) throw new TypeError("journeys must be an array");
	const text = String(objective || "").trim();
	// D/F: tokenize once and return tokens so callers (e.g. decideRouting)
	// can reuse them for workflow-pack suggestion without re-tokenizing.
	const tokens = tokenizeObjective(text);
	const scored = suggestRouteMetadata(text, routes);
	const best = scored[0] || null;
	const route = best ? best.route : null;
	const routeDecision = best
		? {
				status: "selected",
				routeId: route.routeId,
				displayName: route.displayName || route.routeId,
				confidence: Math.min(1, Math.round((best.score / ADVISORY_MAX_SCORE) * 100) / 100),
				candidates: scored.map((entry) => ({
					routeId: entry.route.routeId,
					score: entry.score,
				})),
			}
		: {
				status: "unmatched",
				routeId: null,
				displayName: null,
				confidence: 0,
				candidates: [],
			};
	const journeyDecision = selectJourney(text, journeys, route);
	return {
		status: best ? "selected" : "unmatched",
		route: routeDecision,
		journey: journeyDecision,
		decisionEvidence: {
			reason: best ? "metadata-match" : "no-metadata-match",
			objective: text,
			explicitRouteId: null,
			explicitRouteMatched: null,
			routeCandidates: routeDecision.candidates,
			journeyScore: journeyDecision.score,
			journeyAffinity: journeyDecision.affinity,
		},
		warnings: [],
		tokens,
	};
}

function decideRouteJourney({ objective = "", explicitRouteId = null, routes, journeys }) {
	if (!Array.isArray(routes)) throw new TypeError("routes must be an array");
	if (!Array.isArray(journeys)) throw new TypeError("journeys must be an array");
	const text = String(objective || "").trim();
	let route;
	let routeDecision;
	let reason;
	let warnings = [];

	if (explicitRouteId) {
		route = routes.find((candidate) => candidate.routeId === explicitRouteId);
		if (!route) {
			return {
				status: "invalid",
				route: { status: "invalid", routeId: explicitRouteId },
				journey: { status: "unmatched", journeyId: null },
				decisionEvidence: {
					reason: "invalid-explicit-route",
					objective: text,
					explicitRouteId,
					explicitRouteMatched: null,
				},
				warnings: [],
			};
		}
		const match = text
			? selectRoute(text, [route])
			: { matched: true, confidence: 0, candidates: [] };
		routeDecision = {
			status: "selected",
			routeId: route.routeId,
			displayName: route.displayName || route.routeId,
			confidence: match.confidence || 0,
			candidates: match.candidates || [],
		};
		reason = "explicit";
		if (text && !match.matched) {
			warnings = [`Goal "${text}" does not match the explicit Route "${route.routeId}".`];
		}
	} else {
		const match = selectRoute(text, routes);
		if (match.matched) {
			// F: selectRoute already returned the winning routeId; recover the
			// route object once instead of re-scanning routes.
			route = routes.find((candidate) => candidate.routeId === match.routeId);
			routeDecision = { ...match, status: "selected" };
			reason = "matched";
		} else {
			route = routes.find((candidate) => candidate.routeId === "feature-standard");
			if (!route) {
				return {
					status: "invalid",
					route: { status: "invalid", routeId: null },
					journey: { status: "unmatched", journeyId: null },
					decisionEvidence: { reason: "default-route-missing", objective: text },
					warnings: [],
				};
			}
			routeDecision = {
				status: "defaulted",
				routeId: route.routeId,
				displayName: route.displayName || route.routeId,
				confidence: 0,
				candidates: [],
			};
			reason = text ? "no-match" : "default";
		}
	}

	const journeyDecision = selectJourney(text, journeys, route);
	return {
		status: "selected",
		route: routeDecision,
		journey: journeyDecision,
		decisionEvidence: {
			reason,
			objective: text,
			explicitRouteId: explicitRouteId || null,
			explicitRouteMatched: explicitRouteId && text ? routeDecision.candidates.length > 0 : null,
			routeCandidates: routeDecision.candidates,
			journeyScore: journeyDecision.score,
			journeyAffinity: journeyDecision.affinity,
		},
		warnings,
	};
}

// ── Convenience entry points (moved from journey-router.js) ───────────────

function routeJourney(intent, journeys = JOURNEYS) {
	return selectJourney(intent, journeys, null).journeyId || "amber-delivery";
}

function nextObjectiveCommand(objective, target = ".") {
	return [
		"node",
		"scripts/amber.js",
		"next",
		"--objective",
		String(objective),
		"--target",
		String(target),
	];
}

module.exports = {
	JOURNEYS,
	decideRouteJourney,
	decideAdvisoryRouteJourney,
	scoreRoutes,
	selectRoute,
	scoreJourneys,
	selectJourney,
	suggestRouteMetadata,
	tokenizeObjective,
	routeJourney,
	nextObjectiveCommand,
};
