"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
	JOURNEYS,
	routeJourney,
	nextObjectiveCommand,
} = require("../../scripts/lib/journey-router");

test("intent router maps representative intents to four deep journeys", () => {
	assert.equal(JOURNEYS.length, 4);
	assert.equal(routeJourney("implement and verify checkout"), "amber-delivery");
	assert.equal(routeJourney("prepare a handoff"), "amber-delivery");
	assert.equal(routeJourney("audit readiness before adoption"), "amber-diagnosis-adoption");
	assert.equal(routeJourney("refresh context loadout"), "amber-context-continuity");
	assert.equal(
		routeJourney("select next continuous improvement slice"),
		"amber-continuous-improvement",
	);
});

test("route selection command always delegates to deterministic amber next", () => {
	assert.deepEqual(nextObjectiveCommand("fix login", "repo"), [
		"node",
		"scripts/amber.js",
		"next",
		"--objective",
		"fix login",
		"--target",
		"repo",
	]);
});

test("next objective exposes the shared journey decision", () => {
	const { inferNext } = require("../../scripts/lib/next-command");
	const result = inferNext(".", { objective: "refresh context loadout" });
	assert.equal(result.journeyId, "amber-context-continuity");
});

test("every deep journey defines ordered stages, evidence, recovery, and governance gates", () => {
	for (const journey of JOURNEYS) {
		const skill = fs.readFileSync(
			path.resolve(__dirname, "../../skills", journey.id, "SKILL.md"),
			"utf8",
		);
		assert.match(skill, /^1\. /m, `${journey.id}: ordered stages`);
		assert.match(skill, /^Evidence order:/m, `${journey.id}: evidence order`);
		assert.match(skill, /^On failure,/m, `${journey.id}: failure recovery`);
		assert.match(skill, /approval/i, `${journey.id}: approval boundary`);
		assert.match(skill, /isolation/i, `${journey.id}: isolation boundary`);
		assert.match(skill, /ledger/i, `${journey.id}: ledger boundary`);
	}
});
