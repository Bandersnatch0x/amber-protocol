"use strict";

// Regression guard for the accept plan/session feature-mismatch check
// (command-dispatcher handleAccept). `accept --plan <F001-plan> --session
// <F002-session>` must refuse before acceptPlan mutates feature_list.json.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { dispatch } = require("../../scripts/lib/command-dispatcher");

function setup({ planFeature, sessionFeature }) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "amber-accept-guard-"));
	fs.writeFileSync(
		path.join(dir, "feature_list.json"),
		JSON.stringify({
			features: [
				{ id: "F001", title: "one", status: "in_progress", verification: ["x"], evidence: [] },
				{ id: "F002", title: "two", status: "in_progress", verification: ["x"], evidence: [] },
			],
		}),
	);
	const planRel = "docs/plans/p.md";
	fs.mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
	fs.writeFileSync(
		path.join(dir, planRel),
		[
			"# Plan: p",
			"",
			`Feature: ${planFeature}`,
			"User Confirmation: confirmed",
			"",
			"## High Level Design",
			"- x",
			"",
			"## Vertical Slices",
			"- [ ] x",
			"",
			"## Resume Checkpoint",
			"- Resume Point: x",
			"- Blockers: x",
			"- Next Action: x",
			"- Recovery Instructions: x",
			"",
			"## Acceptance Criteria",
			"- x",
			"",
			"## Verification",
			"- x",
			"",
			"## Evidence Schema",
			"- Command: x",
			"",
		].join("\n"),
	);
	const sid = "S1";
	const sdir = path.join(dir, ".amber", "sessions", sid);
	fs.mkdirSync(sdir, { recursive: true });
	fs.writeFileSync(
		path.join(sdir, "manifest.json"),
		JSON.stringify({ sessionId: sid, feature: sessionFeature, goal: "g", status: "created" }),
	);
	return { dir, planRel, sid };
}

test("accept blocks when the plan's feature does not match the session's feature", () => {
	const { dir, planRel, sid } = setup({ planFeature: "F001", sessionFeature: "F002" });
	const { result } = dispatch("accept", { target: dir, plan: planRel, session: sid });
	assert.equal(result.accepted, false);
	assert.ok(
		(result.errors || []).some((e) => /does not match session/.test(e)),
		"the mismatch is surfaced as an error",
	);
	// acceptPlan never ran: F001 must still be un-accepted.
	const fl = JSON.parse(fs.readFileSync(path.join(dir, "feature_list.json"), "utf8"));
	assert.equal(fl.features.find((f) => f.id === "F001").status, "in_progress");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("accept does not false-trigger the mismatch guard when plan feature == session feature", () => {
	const { dir, planRel, sid } = setup({ planFeature: "F001", sessionFeature: "F001" });
	const { result } = dispatch("accept", { target: dir, plan: planRel, session: sid });
	// Downstream may still block (F001 has no evidence), but it must NOT be the
	// plan/session mismatch error.
	assert.ok(
		!(result.errors || []).some((e) => /does not match session/.test(e)),
		"no false mismatch when features agree",
	);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("accept without --session is unaffected by the guard", () => {
	const { dir, planRel } = setup({ planFeature: "F001", sessionFeature: "F002" });
	const { result } = dispatch("accept", { target: dir, plan: planRel });
	assert.ok(
		!(result.errors || []).some((e) => /does not match session/.test(e)),
		"no session → no mismatch check",
	);
	fs.rmSync(dir, { recursive: true, force: true });
});
