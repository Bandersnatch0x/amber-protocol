"use strict";

const MATCH_WEIGHT = 0.6;
const COVERAGE_WEIGHT = 0.4;

function compilePattern(route) {
	const pattern = route && route.trigger && route.trigger.goalPattern;
	if (typeof pattern !== "string" || pattern.length === 0) {
		return null;
	}
	try {
		return new RegExp(pattern, "i");
	} catch {
		return null;
	}
}

function confidenceFor(goal, regex, match) {
	const matchedText = match[0] || "";
	const coverage = goal.length > 0 ? matchedText.length / goal.length : 0;
	const bounded = Math.min(1, Math.max(0, coverage));
	const score = MATCH_WEIGHT + COVERAGE_WEIGHT * bounded;
	return Math.round(Math.min(1, score) * 1000) / 1000;
}

function scoreRoutes(goal, routes) {
	if (typeof goal !== "string") {
		throw new TypeError("goal must be a string");
	}
	if (!Array.isArray(routes)) {
		throw new TypeError("routes must be an array");
	}

	const scored = [];
	for (const route of routes) {
		const regex = compilePattern(route);
		if (!regex) {
			continue;
		}
		const match = goal.match(regex);
		if (!match) {
			continue;
		}
		scored.push({
			routeId: route.routeId,
			displayName: route.displayName || route.routeId,
			confidence: confidenceFor(goal, regex, match),
			patternLength: route.trigger.goalPattern.length,
		});
	}

	scored.sort((a, b) => {
		if (b.confidence !== a.confidence) {
			return b.confidence - a.confidence;
		}
		if (b.patternLength !== a.patternLength) {
			return b.patternLength - a.patternLength;
		}
		return a.routeId < b.routeId ? -1 : a.routeId > b.routeId ? 1 : 0;
	});

	return scored;
}

function selectRoute(goal, routes) {
	const scored = scoreRoutes(goal, routes);
	if (scored.length === 0) {
		return {
			matched: false,
			routeId: null,
			displayName: null,
			confidence: 0,
			candidates: [],
		};
	}
	const best = scored[0];
	return {
		matched: true,
		routeId: best.routeId,
		displayName: best.displayName,
		confidence: best.confidence,
		candidates: scored,
	};
}

module.exports = { selectRoute, scoreRoutes };
