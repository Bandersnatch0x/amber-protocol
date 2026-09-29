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

// accept rewrites feature_list.json to record the status. It must edit that entry
// and leave every other byte alone: JSON.stringify expands every array and cannot
// know the file's own indentation, so recording one status used to rewrite the
// whole file — 3,200 lines in this repository — and fail `npm run format:check`.
test("accept edits the accepted entry without reformatting feature_list.json", () => {
	const { dir, planRel } = setup({ planFeature: "F001", sessionFeature: "F001" });
	const file = path.join(dir, "feature_list.json");
	// The setup plan is intentionally minimal; acceptance needs the full shape.
	fs.writeFileSync(
		path.join(dir, planRel),
		[
			"# Plan: p",
			"",
			"Feature: F001",
			"User Confirmation: confirmed",
			"",
			"## High Level Design",
			"- approach",
			"",
			"## Context manifests",
			"- implement: docs/specs/contract.md",
			"- review: docs/adr/0001.md",
			"",
			"## Vertical Slices",
			"- [ ] slice 1",
			"",
			"## Resume Checkpoint",
			"- Resume Point: ready.",
			"- Blockers: none.",
			"- Next Action: verify.",
			"- Recovery Instructions: reopen the plan.",
			"",
			"## Acceptance Criteria",
			"- Guardrails: no new execution authority; the phase boundary is unchanged.",
			"",
			"## Verification",
			"- npm test",
			"",
			"## Evidence Schema",
			"- Command: npm test",
			"- Result: pass",
			"- Date: 2026-09-29",
			"",
		].join("\n"),
	);
	// Context manifest entries must resolve inside the target repository.
	fs.mkdirSync(path.join(dir, "docs", "specs"), { recursive: true });
	fs.mkdirSync(path.join(dir, "docs", "adr"), { recursive: true });
	fs.writeFileSync(path.join(dir, "docs", "specs", "contract.md"), "# contract\n");
	fs.writeFileSync(path.join(dir, "docs", "adr", "0001.md"), "# adr\n");
	// The authored layout: tabs, short arrays inline, one feature per line.
	const authored = [
		"{",
		'\t"features": [',
		'\t\t{ "id": "F001", "title": "one", "status": "passing", "verification": ["x"], "evidence": ["npm test: green"], "notes": ["a", "b"] },',
		'\t\t{ "id": "F002", "title": "two", "status": "passing", "verification": ["y"], "evidence": ["npm test: green"] }',
		"\t]",
		"}",
		"",
	].join("\n");
	fs.writeFileSync(file, authored);

	const { result } = dispatch("accept", { target: dir, plan: planRel });
	assert.equal(result.accepted, true, (result.errors || []).join("; "));

	const after = fs.readFileSync(file, "utf8");
	assert.match(after, /"status": "accepted"/, "the status is recorded");
	assert.match(
		after,
		/"id": "F002", "title": "two", "status": "passing", "verification": \["y"\]/,
		"an unrelated entry keeps its single-line, inline-array layout",
	);
	assert.match(after, /"notes": \["a", "b"\]/, "a short array is not expanded");
	assert.equal(
		after.split("\n").length,
		authored.split("\n").length,
		"the document keeps its shape",
	);
	fs.rmSync(dir, { recursive: true, force: true });
});
