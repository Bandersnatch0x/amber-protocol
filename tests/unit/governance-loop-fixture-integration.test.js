"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const {
	matchGolden,
	runtimeSummaryForFixture,
	reportFixtureCoverage,
	parseRunnerArgs,
} = require("../../scripts/demo/e2e-governance-loop-verify.js");
const { loadFamily } = require("../../scripts/lib/core/fixture-family");

const RUNNER = path.join(__dirname, "..", "..", "scripts", "demo", "e2e-governance-loop-verify.js");

test("parseRunnerArgs parses --fixture-family flag", () => {
	const parsed = parseRunnerArgs(["--fixture-family"]);
	assert.equal(parsed.fixtureFamily, true);
	assert.equal(parseRunnerArgs([]).fixtureFamily, false);
});

test("matchGolden returns no mismatches when the runtime summary matches the golden", () => {
	const golden = {
		exitCode: 0,
		summary: { successClosed: true, highFindings: [] },
	};
	const runtime = {
		successClosed: true,
		highFindings: [],
		rejections: {
			policyDeny: true,
			claimStrict: true,
			acceptNoEvidence: true,
			approveNeedsGate: true,
		},
		verifyFailRecovered: true,
		crossSessionHandoff: true,
	};
	assert.deepEqual(matchGolden(runtime, golden), []);
});

test("matchGolden detects a successClosed mismatch", () => {
	const golden = { exitCode: 0, summary: { successClosed: true, highFindings: [] } };
	const runtime = {
		successClosed: false,
		highFindings: [],
		rejections: {},
		verifyFailRecovered: true,
		crossSessionHandoff: true,
	};
	const diffs = matchGolden(runtime, golden);
	assert.ok(diffs.some((d) => d.includes("successClosed")));
});

test("matchGolden detects a rejection sub-field mismatch", () => {
	const golden = {
		exitCode: 0,
		summary: {
			rejections: {
				policyDeny: true,
				claimStrict: true,
				acceptNoEvidence: true,
				approveNeedsGate: true,
			},
			highFindings: [],
		},
	};
	const runtime = {
		successClosed: true,
		highFindings: [],
		rejections: {
			policyDeny: false,
			claimStrict: true,
			acceptNoEvidence: true,
			approveNeedsGate: true,
		},
		verifyFailRecovered: true,
		crossSessionHandoff: true,
	};
	const diffs = matchGolden(runtime, golden);
	assert.ok(diffs.some((d) => d.includes("rejections.policyDeny")));
});

test("matchGolden detects a highFindings mismatch", () => {
	const golden = { exitCode: 0, summary: { successClosed: true, highFindings: [] } };
	const runtime = {
		successClosed: true,
		highFindings: ["S1"],
		rejections: {
			policyDeny: true,
			claimStrict: true,
			acceptNoEvidence: true,
			approveNeedsGate: true,
		},
		verifyFailRecovered: true,
		crossSessionHandoff: true,
	};
	const diffs = matchGolden(runtime, golden);
	assert.ok(diffs.some((d) => d.includes("highFindings")));
});

function healthyPathResults() {
	return {
		success: {
			"personal-node": { closed: true },
			"team-hub": { closed: true },
			organization: { closed: true },
		},
		successAdversarial: { acceptBlocked: true },
		rejections: {
			policyDenyWorks: true,
			claimOnlyStrictFails: true,
			acceptWithoutEvidenceBlocked: true,
			approveRequiresGateId: true,
		},
		verifyFailRecover: { recovered: true },
		crossSessionHandoff: {
			handoffUseful: true,
			session2Started: true,
			refuseResurrectCompleted: true,
		},
	};
}

test("reportFixtureCoverage is green on a healthy run (canonical goldens match, refusal proven)", () => {
	const report = reportFixtureCoverage(healthyPathResults());
	assert.equal(report.errors.length, 0);
	assert.ok(report.familySize >= 7, `expected at least 7 fixtures, got ${report.familySize}`);
	assert.deepEqual(report.mismatches, []);
	assert.equal(report.matches.length, report.familySize);
});

test("reportFixtureCoverage fails when a canonical golden drifts from its path result", () => {
	const paths = healthyPathResults();
	paths.success["personal-node"].closed = false; // personal-node success no longer closes
	const report = reportFixtureCoverage(paths);
	const failure = report.mismatches.find((m) => m.fixtureId === "success-minimal");
	assert.ok(failure, "success-minimal golden must mismatch an unclosed success path");
	assert.ok(failure.diffs.some((d) => d.includes("successClosed") || d.includes("exitCode")));
	// team-hub/organization runs still closed → their fixtures still match
	const teamHub = report.mismatches.find((m) => m.fixtureId === "success-team-hub");
	assert.equal(teamHub, undefined, "team-hub fixture bound to its own profile run");
});

test("reportFixtureCoverage fails when the adversarial refusal is NOT proven", () => {
	const paths = healthyPathResults();
	paths.successAdversarial.acceptBlocked = false; // gate failed to block
	const report = reportFixtureCoverage(paths);
	const failure = report.mismatches.find((m) => m.fixtureId === "success-adversarial-no-evidence");
	assert.ok(failure, "adversarial golden must mismatch when the refusal is not proven");
});

test("runtimeSummaryForFixture maps each fixture to its own path's result", () => {
	const paths = healthyPathResults();
	const { fixtures } = loadFamily();
	for (const { fixture } of fixtures) {
		const summary = runtimeSummaryForFixture(fixture, paths);
		assert.ok(summary, `fixture ${fixture.fixtureId} maps to a runtime result`);
	}
	// adversarial summary encodes the refusal state
	const adversarial = fixtures.find((f) => f.fixture.variant === "adversarial");
	const advSummary = runtimeSummaryForFixture(adversarial.fixture, paths);
	assert.equal(advSummary.successClosed, false);
	assert.deepEqual(advSummary.highFindings, ["R3"]);
	assert.equal(advSummary.exitCode, 1);
});

test("the committed fixture family has at least 7 fixtures covering all 4 paths and 3 profiles", () => {
	const { fixtures } = loadFamily();
	assert.ok(fixtures.length >= 7, `expected at least 7 fixtures, got ${fixtures.length}`);
	const paths = new Set(fixtures.map((f) => f.fixture.path));
	assert.ok(paths.has("success"));
	assert.ok(paths.has("rejection"));
	assert.ok(paths.has("verify-fail-recover"));
	assert.ok(paths.has("cross-session-handoff"));
	const profiles = new Set(fixtures.map((f) => f.fixture.deploymentProfile));
	assert.ok(profiles.has("personal-node"));
	assert.ok(profiles.has("team-hub"));
	assert.ok(profiles.has("organization"));
});

test("the family includes at least one adversarial variant", () => {
	const { fixtures } = loadFamily();
	const adversarial = fixtures.filter((f) => f.fixture.variant === "adversarial");
	assert.ok(adversarial.length >= 1, "expected at least one adversarial fixture");
});

test("--help output mentions --fixture-family", () => {
	const r = spawnSync(process.execPath, [RUNNER, "--help"], { encoding: "utf8" });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /--fixture-family/);
});
