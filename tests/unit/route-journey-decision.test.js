"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { JOURNEYS } = require("../../scripts/lib/journey-router");
const { loadRoutes } = require("../../scripts/lib/route-loader");
const { decideRouteJourney } = require("../../scripts/lib/route-journey-decision");

const routes = loadRoutes(require("node:path").join(__dirname, "../../routes")).routes;

test("Route/Journey Decision keeps route and journey coherent", () => {
	const decision = decideRouteJourney({
		objective: "fix the login bug",
		routes,
		journeys: JOURNEYS,
	});
	assert.equal(decision.status, "selected");
	assert.equal(decision.route.routeId, "bugfix-quick");
	assert.equal(decision.journey.journeyId, "amber-delivery");
	assert.equal(decision.decisionEvidence.reason, "matched");
});

test("explicit Route wins and exposes mismatch evidence", () => {
	const decision = decideRouteJourney({
		objective: "fix the login bug",
		explicitRouteId: "refactor-safe",
		routes,
		journeys: JOURNEYS,
	});
	assert.equal(decision.route.routeId, "refactor-safe");
	assert.equal(decision.decisionEvidence.reason, "explicit");
	assert.equal(decision.decisionEvidence.explicitRouteMatched, false);
	assert.equal(decision.warnings.length, 1);
});

test("missing objective preserves explicit default reason", () => {
	const decision = decideRouteJourney({ objective: "", routes, journeys: JOURNEYS });
	assert.equal(decision.route.routeId, "feature-standard");
	assert.equal(decision.route.status, "defaulted");
	assert.equal(decision.decisionEvidence.reason, "default");
});

test("unknown Journey affinity fails closed against the Journey registry", () => {
	assert.throws(
		() =>
			decideRouteJourney({
				objective: "implement a feature",
				routes: [
					{
						routeId: "feature-standard",
						trigger: { goalPattern: "^implement" },
						journeyAffinity: ["missing-journey"],
					},
				],
				journeys: JOURNEYS,
			}),
		/unknown Journey affinity.*missing-journey/i,
	);
});
