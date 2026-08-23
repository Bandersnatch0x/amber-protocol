"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const RUNNER = path.join(__dirname, "..", "..", "scripts", "demo", "e2e-governance-loop-verify.js");
const {
	exitCodeFromSummary,
	snapshotProduct,
	detectProductMutation,
	parseRunnerArgs,
} = require("../../scripts/demo/e2e-governance-loop-verify.js");

function passingSummary() {
	return {
		successClosed: true,
		rejections: {
			policyDeny: true,
			claimStrict: true,
			acceptNoEvidence: true,
			approveNeedsGate: true,
		},
		verifyFailRecovered: true,
		crossSessionHandoff: true,
		highFindings: [],
	};
}

test("requiring the runner does not spawn a governance loop", () => {
	assert.equal(typeof exitCodeFromSummary, "function");
	assert.equal(typeof snapshotProduct, "function");
	assert.equal(typeof detectProductMutation, "function");
	assert.equal(typeof parseRunnerArgs, "function");
});

test("exitCodeFromSummary is 0 only when every path closed with no high findings", () => {
	assert.equal(exitCodeFromSummary(passingSummary()), 0);
	assert.equal(exitCodeFromSummary({ ...passingSummary(), successClosed: false }), 1);
	assert.equal(
		exitCodeFromSummary({
			...passingSummary(),
			rejections: { ...passingSummary().rejections, policyDeny: false },
		}),
		1,
	);
	assert.equal(exitCodeFromSummary({ ...passingSummary(), verifyFailRecovered: false }), 1);
	assert.equal(exitCodeFromSummary({ ...passingSummary(), crossSessionHandoff: false }), 1);
	assert.equal(exitCodeFromSummary({ ...passingSummary(), highFindings: ["S1"] }), 1);
});

test("detectProductMutation reports leaked sessions and dirty product files", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "amber-e2e-iso-"));
	const sessions = path.join(root, ".amber", "sessions");
	fs.mkdirSync(sessions, { recursive: true });
	fs.mkdirSync(path.join(sessions, "already-there"));
	const snap = snapshotProduct(root);

	fs.mkdirSync(path.join(sessions, "leaked-sid"));
	fs.mkdirSync(path.join(root, "docs", "quality"), { recursive: true });
	fs.writeFileSync(path.join(root, "docs", "quality", "e2e-governance-loop-verify.json"), "{}");

	const delta = detectProductMutation(root, snap);
	assert.deepEqual(delta.leakedSessions, ["leaked-sid"]);
	assert.ok(
		delta.dirtyPaths.some((p) => p.replace(/\\/g, "/").includes("e2e-governance-loop-verify.json")),
	);
	fs.rmSync(root, { recursive: true, force: true });
});

test("parseRunnerArgs defaults output off the product tree", () => {
	const parsed = parseRunnerArgs([]);
	assert.equal(parsed.outputPath, null);
	const withOut = parseRunnerArgs(["--output", path.join(os.tmpdir(), "loop.json")]);
	assert.ok(withOut.outputPath.endsWith("loop.json"));
});

test("CLI --help does not write docs/quality/e2e-governance-loop-verify.json", () => {
	const product = path.resolve(__dirname, "..", "..");
	const committedLog = path.join(product, "docs", "quality", "e2e-governance-loop-verify.json");
	const before = fs.statSync(committedLog).mtimeMs;
	const r = spawnSync(process.execPath, [RUNNER, "--help"], {
		cwd: product,
		encoding: "utf8",
	});
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout + r.stderr, /test:governance-loop|e2e-governance-loop-verify|--output/);
	assert.equal(fs.statSync(committedLog).mtimeMs, before);
});
