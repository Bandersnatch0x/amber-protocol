"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
	resolveSessionFeature,
	readPlanFeature,
} = require("../../scripts/lib/core/feature-attribution");
const { mkTarget, writeJson } = require("../helpers/harness");

test("readPlanFeature returns the feature named in the plan header", () => {
	const dir = mkTarget("plan-feature");
	writeJson(dir, "docs/plans/F002-slice.md", {});
	const plan = path.join(dir, "docs", "plans", "F002-slice.md");
	fs.writeFileSync(plan, "# Plan\n\nFeature: F002\n\n## High Level Design\n\n- x\n");
	assert.equal(readPlanFeature(dir, "docs/plans/F002-slice.md"), "F002");
});

test("readPlanFeature returns null for a missing plan or missing header", () => {
	const dir = mkTarget("plan-null");
	assert.equal(readPlanFeature(dir, "docs/plans/nope.md"), null);
	writeJson(dir, "docs/plans/F001-slice.md", {});
	fs.writeFileSync(
		path.join(dir, "docs", "plans", "F001-slice.md"),
		"# Plan\n\nNo feature header here.\n",
	);
	assert.equal(readPlanFeature(dir, "docs/plans/F001-slice.md"), null);
});

test("resolveSessionFeature returns the session manifest's feature", () => {
	const dir = mkTarget("session-feature");
	// sessions live under the amber state dir (session-manifest layout)
	const sessionsDir = path.join(dir, ".amber", "sessions", "sess-1");
	fs.mkdirSync(sessionsDir, { recursive: true });
	fs.writeFileSync(
		path.join(sessionsDir, "manifest.json"),
		JSON.stringify({
			sessionId: "sess-1",
			schemaVersion: "1.0.0",
			createdAt: "2026-08-01T00:00:00Z",
			updatedAt: "2026-08-01T00:00:00Z",
			route: { id: "feature-standard", version: "1.0.0" },
			goal: "x",
			feature: "F002",
			status: "created",
			completedStages: [],
		}),
	);
	assert.equal(resolveSessionFeature(dir, "sess-1"), "F002");
});

test("resolveSessionFeature returns null for an unknown session", () => {
	const dir = mkTarget("session-null");
	assert.equal(resolveSessionFeature(dir, "no-such-session"), null);
});

// Both readers ran before acceptPlan's own containment refusal, so an escaped
// path used to be read and its feature name surfaced in the mismatch error.
test("readPlanFeature refuses a plan path that escapes the target", () => {
	const dir = mkTarget("plan-escape");
	const outside = mkTarget("plan-escape-outside");
	fs.writeFileSync(
		path.join(outside, "leak.md"),
		"# Plan\n\nFeature: F999-LEAKED\n\n## High Level Design\n\n- x\n",
	);
	const rel = path.relative(dir, path.join(outside, "leak.md"));
	assert.equal(readPlanFeature(dir, rel), null, "an escaped plan must not be read");
});

test("resolveSessionFeature refuses a session id that resolves outside the state dir", () => {
	const dir = mkTarget("session-escape");
	const other = mkTarget("session-escape-other");
	const hijackDir = path.join(other, ".amber", "sessions", "hijack");
	fs.mkdirSync(hijackDir, { recursive: true });
	fs.writeFileSync(
		path.join(hijackDir, "manifest.json"),
		JSON.stringify({ sessionId: "hijack", feature: "F-HIJACKED", status: "created" }),
	);
	const rel = path.relative(path.join(dir, ".amber", "sessions"), hijackDir);
	assert.ok(rel.startsWith(".."), "fixture must actually escape the state dir");
	assert.equal(resolveSessionFeature(dir, rel), null, "a traversing id must not be read");
	assert.equal(resolveSessionFeature(dir, hijackDir), null, "an absolute id must not be read");
});
