"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	CANNED_OBJECTIVES,
	mkIsolatedTarget,
	routeFromAmberProven,
	buildJudgeContext,
	judgePassFail,
	isSilentSkip,
	SKIP_EXIT,
	PASS_EXIT,
	FAIL_EXIT,
} = require("../../scripts/demo/nightly-host-scenario");

// ── Constants ─────────────────────────────────────────────────

test("CANNED_OBJECTIVES defines at least one canned objective", () => {
	assert.ok(CANNED_OBJECTIVES.length >= 1);
	assert.ok(typeof CANNED_OBJECTIVES[0] === "string" && CANNED_OBJECTIVES[0].length > 0);
});

test("exit codes are distinct and explicit", () => {
	assert.equal(SKIP_EXIT, 42);
	assert.equal(PASS_EXIT, 0);
	assert.equal(FAIL_EXIT, 1);
	assert.notEqual(SKIP_EXIT, PASS_EXIT);
	assert.notEqual(SKIP_EXIT, FAIL_EXIT);
});

// ── Isolated target ───────────────────────────────────────────

test("mkIsolatedTarget creates an isolated git target", () => {
	const target = mkIsolatedTarget("unit");
	assert.ok(fs.existsSync(path.join(target, ".git")), "git repo");
	assert.ok(fs.existsSync(path.join(target, "package.json")), "package.json seeded");
	const src = fs.readFileSync(path.join(target, "package.json"), "utf8");
	assert.ok(JSON.parse(src).private === true, "private package");
});

// ── Judge context ─────────────────────────────────────────────

test("buildJudgeContext captures session artifacts and route provenance", () => {
	const target = mkIsolatedTarget("judge");
	const ctx = buildJudgeContext(target, { objective: "run canned objective" });
	assert.ok(ctx);
	assert.equal(ctx.objective, "run canned objective");
	assert.equal(typeof ctx.sessionEvidence, "object");
});

// ── Route provenance ──────────────────────────────────────────

function seedRouteRegistry(target) {
	fs.mkdirSync(path.join(target, "routes"), { recursive: true });
	// copy the product's real route file so it passes the route validator
	const src = path.resolve(__dirname, "..", "..", "routes", "feature-standard.route.json");
	fs.copyFileSync(src, path.join(target, "routes", "feature-standard.route.json"));
}

function writeSessionManifest(target, sid, manifest) {
	const dir = path.join(target, ".amber", "sessions", sid);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

function knownJourneyId() {
	const { JOURNEYS } = require("../../scripts/lib/route-journey-decision");
	return JOURNEYS[0].id;
}

test("routeFromAmberProven accepts an amber-chosen route with a known journey", () => {
	const target = mkIsolatedTarget("route-ok");
	seedRouteRegistry(target);
	const manifest = {
		route: { id: "feature-standard", version: "1.0.0" },
		journeyId: knownJourneyId(),
	};
	assert.equal(routeFromAmberProven(target, manifest), true);
});

test("routeFromAmberProven rejects an invented (unregistered) route id", () => {
	const target = mkIsolatedTarget("route-invented");
	seedRouteRegistry(target);
	const manifest = { route: { id: "my-made-up-journey", version: "9.9" } };
	assert.equal(routeFromAmberProven(target, manifest), false);
});

test("routeFromAmberProven rejects a string route (not the amber manifest shape)", () => {
	const target = mkIsolatedTarget("route-string");
	seedRouteRegistry(target);
	assert.equal(routeFromAmberProven(target, { route: "feature-standard" }), false);
	assert.equal(routeFromAmberProven(target, { journey: "invented" }), false);
	assert.equal(routeFromAmberProven(target, null), false);
});

test("routeFromAmberProven rejects an unknown journeyId", () => {
	const target = mkIsolatedTarget("route-journey");
	seedRouteRegistry(target);
	const manifest = { route: { id: "feature-standard" }, journeyId: "invented-journey" };
	assert.equal(routeFromAmberProven(target, manifest), false);
});

test("buildJudgeContext requires amber provenance on the session route", () => {
	const target = mkIsolatedTarget("judge-provenance");
	seedRouteRegistry(target);
	// invented route → routeFromAmber false → judge fails
	writeSessionManifest(target, "sess-1", {
		sessionId: "sess-1",
		route: { id: "not-a-real-route" },
		goal: "x",
	});
	const ctx = buildJudgeContext(target, { objective: "x" });
	assert.equal(ctx.sessionEvidence.routeFromAmber, false);
	const verdict = judgePassFail(ctx);
	assert.ok(verdict.reasons.some((r) => /route|journey|amber next/i.test(r)));
});

// ── Pass/fail judgment ────────────────────────────────────────

test("judgePassFail fails on missing session evidence", () => {
	const target = mkIsolatedTarget("no-evidence");
	const ctx = buildJudgeContext(target, { objective: "x" });
	const verdict = judgePassFail(ctx);
	assert.equal(verdict.ok, false);
	assert.ok(verdict.reasons.length > 0);
});

test("judgePassFail is evidence-based, not prose-based", () => {
	// a fabricated prose answer with no session evidence still fails
	const ctx = {
		objective: "x",
		sessionEvidence: {
			sessionDirExists: false,
			completeCheckPassed: false,
			evidenceCount: 0,
			routeFromAmber: false,
		},
		proseAnswer: "I did everything perfectly and it all worked great",
	};
	const verdict = judgePassFail(ctx);
	assert.equal(verdict.ok, false, "prose cannot pass; evidence decides");
	assert.ok(verdict.reasons.some((r) => /evidence|session|complete-check/i.test(r)));
});

test("judgePassFail fails when the route was invented (not from amber next)", () => {
	const ctx = {
		objective: "x",
		sessionEvidence: {
			sessionDirExists: true,
			completeCheckPassed: true,
			evidenceCount: 1,
			routeFromAmber: false, // agent invented the journey
		},
	};
	const verdict = judgePassFail(ctx);
	assert.equal(verdict.ok, false);
	assert.ok(verdict.reasons.some((r) => /route|journey|amber next/i.test(r)));
});

test("judgePassFail passes only with evidence + amber-sourced route", () => {
	const ctx = {
		objective: "x",
		sessionEvidence: {
			sessionDirExists: true,
			completeCheckPassed: true,
			evidenceCount: 1,
			routeFromAmber: true,
		},
	};
	const verdict = judgePassFail(ctx);
	assert.equal(verdict.ok, true);
	assert.deepEqual(verdict.reasons, []);
});

// ── Skip semantics ────────────────────────────────────────────

test("isSilentSkip detects an explicit skip", () => {
	assert.equal(isSilentSkip({ skip: true, reason: "host binary missing" }), true);
	assert.equal(isSilentSkip({ skip: false }), false);
	assert.equal(isSilentSkip({}), false);
});

test("missing host binary is an explicit skip, never a silent pass", () => {
	// simulate: host binary absent → the scenario reports skip, not pass
	const verdict = { skip: true, reason: "host binary not found on PATH", exitCode: SKIP_EXIT };
	assert.equal(isSilentSkip(verdict), true);
	assert.notEqual(verdict.exitCode, PASS_EXIT, "skip must never look like a pass");
});
