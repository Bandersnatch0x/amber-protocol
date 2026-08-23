"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const {
	matchGolden,
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

test("reportFixtureCoverage loads the family and reports no mismatches for a matching summary", () => {
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
	const report = reportFixtureCoverage(runtime);
	assert.equal(report.errors.length, 0);
	assert.ok(report.familySize >= 5, `expected at least 5 fixtures, got ${report.familySize}`);
	// Canonical fixtures should all match a fully-passing runtime summary.
	// The adversarial fixture (exitCode 1) should mismatch on a passing summary.
	for (const m of report.mismatches) {
		assert.ok(m.fixtureId.includes("adversarial"), `unexpected mismatch on ${m.fixtureId}`);
	}
});

test("the committed fixture family has exactly 5 fixtures covering all 4 paths", () => {
	const { fixtures } = loadFamily();
	assert.equal(fixtures.length, 5);
	const paths = new Set(fixtures.map((f) => f.fixture.path));
	assert.ok(paths.has("success"));
	assert.ok(paths.has("rejection"));
	assert.ok(paths.has("verify-fail-recover"));
	assert.ok(paths.has("cross-session-handoff"));
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
