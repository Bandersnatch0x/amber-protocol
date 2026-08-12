"use strict";

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

const seenTerms = new Map();
for (const journey of JOURNEYS) {
	for (const term of journey.terms) {
		if (seenTerms.has(term)) {
			throw new Error(
				`Journey term "${term}" is assigned to both ${seenTerms.get(term)} and ${journey.id}`,
			);
		}
		seenTerms.set(term, journey.id);
	}
}

function routeJourney(intent) {
	const text = String(intent || "").toLowerCase();
	const ranked = JOURNEYS.map((journey, index) => ({
		journey,
		index,
		score: journey.terms.filter((term) => text.includes(term)).length,
	})).sort((a, b) => b.score - a.score || a.index - b.index);
	return ranked[0].score > 0 ? ranked[0].journey.id : "amber-delivery";
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

module.exports = { JOURNEYS, routeJourney, nextObjectiveCommand };
